// ============================================================
// POST /api/onboarding/chat
// Save user message → call LLM → save assistant message →
// merge collected data into goal.diagnosis
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { requireAuth, AuthError } from "@/lib/auth";
import { callLLMStructured, LLMError } from "@/lib/llm";
import {
    safeErrorResponse,
    safeLLMErrorResponse,
    safeAuthErrorResponse,
} from "@/lib/api/safe-error";
import { generateRequestId } from "@/lib/observability/track-event";
import { OnboardingChatOutputSchema } from "@/lib/schemas/onboarding";
import {
    buildPrompt,
    PROMPT_VERSION,
} from "@/lib/prompts/onboarding.v1";
import type { LLMMessage, Locale } from "@/lib/llm/types";

const RequestBodySchema = z.object({
    sessionId: z.string().uuid(),
    message: z.string().min(1).max(2000),
});

export async function POST(request: NextRequest) {
    try {
        const { userId, supabase } = await requireAuth();
        const requestId = generateRequestId();

        // 1. Parse request body
        const raw = await request.json();
        const body = RequestBodySchema.parse(raw);

        // 2. Fetch session (RLS ensures ownership through goal)
        const { data: session, error: sessionError } = await supabase
            .from("onboarding_sessions")
            .select("id, goal_id, status")
            .eq("id", body.sessionId)
            .single();

        if (sessionError || !session) {
            return NextResponse.json(
                { error: "Session not found" },
                { status: 404 }
            );
        }

        if (session.status === "completed") {
            return NextResponse.json(
                { error: "Session already completed" },
                { status: 400 }
            );
        }

        // 3. Fetch existing messages for conversation history
        const { data: existingMessages } = await supabase
            .from("chat_messages")
            .select("role, content")
            .eq("session_id", session.id)
            .order("created_at", { ascending: true });

        // 4. Fetch current goal diagnosis for context
        const { data: goal } = await supabase
            .from("goals")
            .select("diagnosis")
            .eq("id", session.goal_id)
            .single();

        const currentCollected =
            (goal?.diagnosis as Record<string, unknown>) ?? {};

        // 5. Save user message
        const { error: userMsgError } = await supabase
            .from("chat_messages")
            .insert({
                session_id: session.id,
                role: "user",
                content: body.message,
                metadata: {},
            });

        if (userMsgError) {
            console.error(
                "[onboarding/chat] user message insert error:",
                userMsgError
            );
            return NextResponse.json(
                { error: "Failed to save message" },
                { status: 500 }
            );
        }

        // 6. Build conversation history for LLM
        const conversationHistory: LLMMessage[] = (existingMessages ?? []).map(
            (m: { role: string; content: string }) => ({
                role: m.role as "user" | "assistant",
                content: m.content,
            })
        );

        // Detect locale from request header
        const acceptLang = request.headers.get("accept-language") ?? "";
        const locale: Locale = acceptLang.includes("ru") ? "ru" : "en";

        // 7. Build prompt and call LLM
        const messages = buildPrompt(locale, {
            userMessage: body.message,
            conversationHistory,
            currentCollected,
        });

        const llmResult = await callLLMStructured(
            {
                task: "onboarding_chat",
                locale,
                userId,
                promptVersion: PROMPT_VERSION,
                messages,
            },
            OnboardingChatOutputSchema,
            { userId, supabase, requestId }
        );

        const { assistantMessage, collected, nextAction } = llmResult.data;

        // 8. Save assistant message
        const { error: assistantMsgError } = await supabase
            .from("chat_messages")
            .insert({
                session_id: session.id,
                role: "assistant",
                content: assistantMessage,
                metadata: { collected, nextAction },
            });

        if (assistantMsgError) {
            console.error(
                "[onboarding/chat] assistant message insert error:",
                assistantMsgError
            );
        }

        // 9. Merge collected data into goal.diagnosis + update goal fields
        const mergedDiagnosis = { ...currentCollected };
        for (const [key, value] of Object.entries(collected)) {
            if (value !== null && value !== undefined) {
                mergedDiagnosis[key] = value;
            }
        }

        const goalUpdate: Record<string, unknown> = {
            diagnosis: mergedDiagnosis,
        };

        // Map collected fields to goal columns where appropriate
        if (collected.motivation) {
            goalUpdate.motivation = collected.motivation;
        }
        if (collected.language) {
            goalUpdate.title = `Learn ${collected.language}`;
        }
        if (collected.targetLevel) {
            goalUpdate.target_description = `Reach CEFR ${collected.targetLevel}`;
        }

        await supabase
            .from("goals")
            .update(goalUpdate)
            .eq("id", session.goal_id);

        // 10. Fetch updated messages
        const { data: updatedMessages } = await supabase
            .from("chat_messages")
            .select("id, role, content, metadata, created_at")
            .eq("session_id", session.id)
            .order("created_at", { ascending: true });

        return NextResponse.json({
            messages: updatedMessages ?? [],
            collected,
            nextAction,
        });
    } catch (err) {
        if (err instanceof AuthError) {
            return safeAuthErrorResponse(err);
        }
        if (err instanceof z.ZodError) {
            return safeErrorResponse(
                400,
                "VALIDATION_ERROR",
                `Validation error: ${err.issues.map((i) => i.message).join(", ")}`
            );
        }
        if (err instanceof LLMError) {
            return safeLLMErrorResponse(err);
        }
        console.error("[onboarding/chat] unexpected error:", err);
        return safeErrorResponse(500, "INTERNAL_ERROR", "Internal server error");
    }
}
