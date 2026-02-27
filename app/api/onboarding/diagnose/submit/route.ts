// ============================================================
// POST /api/onboarding/diagnose/submit
// Score user answers, determine CEFR level, save to goal.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { requireAuth, AuthError } from "@/lib/auth";
import { trackEvent, generateRequestId } from "@/lib/observability/track-event";
import { callLLMStructured, LLMError } from "@/lib/llm";
import {
    safeErrorResponse,
    safeLLMErrorResponse,
    safeAuthErrorResponse,
} from "@/lib/api/safe-error";
import { DiagnoseResultSchema } from "@/lib/schemas/onboarding";
import {
    buildScorePrompt,
    PROMPT_VERSION,
} from "@/lib/prompts/level-assessment.v1";
import type { Locale } from "@/lib/llm/types";

const DiagnoseSubmitQuestionSchema = z.object({
    question: z.string().min(1),
    type: z.enum(["multiple_choice", "translation", "fill_blank"]),
    cefrTarget: z.enum(["A1", "A2", "B1", "B2", "C1"]),
    options: z.array(z.string()).nullable(),
});

const RequestBodySchema = z.object({
    goalId: z.string().uuid(),
    sessionId: z.string().uuid(),
    questions: z.array(DiagnoseSubmitQuestionSchema).min(1).max(10),
    answers: z.array(z.string()),
}).superRefine((value, ctx) => {
    if (value.answers.length !== value.questions.length) {
        ctx.addIssue({
            code: "custom",
            message: "answers length must match questions length",
            path: ["answers"],
        });
    }
});

export async function POST(request: NextRequest) {
    try {
        const { userId, supabase } = await requireAuth();
        const requestId = generateRequestId();

        const raw = await request.json();
        const body = RequestBodySchema.parse(raw);

        // Verify session ownership via onboarding_sessions -> goals(user_id)
        const { data: session, error: sessionError } = await supabase
            .from("onboarding_sessions")
            .select("id, goal_id, goals!inner(user_id)")
            .eq("id", body.sessionId)
            .eq("goals.user_id", userId)
            .maybeSingle();

        if (sessionError) {
            console.error(
                "[onboarding/diagnose/submit] session ownership query error:",
                sessionError
            );
            return NextResponse.json(
                { error: "Failed to verify session" },
                { status: 500 }
            );
        }

        if (!session || session.goal_id !== body.goalId) {
            return NextResponse.json(
                { error: "Session not found" },
                { status: 404 }
            );
        }

        // Fetch goal (RLS ensures ownership)
        const { data: goal, error: goalError } = await supabase
            .from("goals")
            .select("id, diagnosis")
            .eq("id", body.goalId)
            .single();

        if (goalError || !goal) {
            return NextResponse.json(
                { error: "Goal not found" },
                { status: 404 }
            );
        }

        const diagnosis = (goal.diagnosis as Record<string, unknown>) ?? {};
        const language = (diagnosis.language as string) ?? "English";

        // Detect locale
        const acceptLang = request.headers.get("accept-language") ?? "";
        const locale: Locale = acceptLang.includes("ru") ? "ru" : "en";

        // Build score prompt and call LLM
        const messages = buildScorePrompt(locale, {
            language,
            questions: body.questions,
            answers: body.answers,
        });

        const result = await callLLMStructured(
            {
                task: "level_assessment",
                locale,
                userId,
                promptVersion: PROMPT_VERSION,
                messages,
            },
            DiagnoseResultSchema,
            { userId, supabase, requestId }
        );

        const { cefrLevel, explanation } = result.data;

        // Update goal with CEFR level
        const mergedDiagnosis = {
            ...diagnosis,
            cefrLevel,
            assessmentExplanation: explanation,
        };

        const { error: goalUpdateError } = await supabase
            .from("goals")
            .update({
                cefr_level: cefrLevel,
                diagnosis: mergedDiagnosis,
            })
            .eq("id", body.goalId);

        if (goalUpdateError) {
            console.error(
                "[onboarding/diagnose/submit] goal update error:",
                goalUpdateError
            );
            return NextResponse.json(
                { error: "Failed to update goal" },
                { status: 500 }
            );
        }

        // Mark session as completed
        const { data: updatedSessions, error: sessionUpdateError } =
            await supabase
                .from("onboarding_sessions")
                .update({ status: "completed" })
                .eq("id", body.sessionId)
                .select("id");

        if (sessionUpdateError) {
            console.error(
                "[onboarding/diagnose/submit] session update error:",
                sessionUpdateError
            );
            return NextResponse.json(
                { error: "Failed to update session" },
                { status: 500 }
            );
        }

        if (!updatedSessions || updatedSessions.length !== 1) {
            return NextResponse.json(
                { error: "Session not found" },
                { status: 404 }
            );
        }

        await trackEvent({
            supabase,
            userId,
            eventType: "onboarding_completed",
            payload: { goalId: body.goalId, cefrLevel },
            requestId,
        });

        return NextResponse.json({ cefrLevel, explanation });
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
        console.error("[onboarding/diagnose/submit] unexpected error:", err);
        return safeErrorResponse(500, "INTERNAL_ERROR", "Internal server error");
    }
}
