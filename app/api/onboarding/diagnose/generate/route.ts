// ============================================================
// POST /api/onboarding/diagnose/generate
// Generate CEFR diagnostic questions for the user's target language.
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
import { DiagnoseQuestionsOutputSchema } from "@/lib/schemas/onboarding";
import {
    buildPrompt,
    PROMPT_VERSION,
} from "@/lib/prompts/level-assessment.v1";
import type { Locale } from "@/lib/llm/types";

const RequestBodySchema = z.object({
    goalId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
    try {
        const { userId, supabase } = await requireAuth();
        const requestId = generateRequestId();

        const raw = await request.json();
        const body = RequestBodySchema.parse(raw);

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
        const selfReportedLevel = diagnosis.targetLevel as string | undefined;

        // Detect locale
        const acceptLang = request.headers.get("accept-language") ?? "";
        const locale: Locale = acceptLang.includes("ru") ? "ru" : "en";

        // Build prompt and call LLM
        const messages = buildPrompt(locale, {
            language,
            selfReportedLevel,
        });

        const result = await callLLMStructured(
            {
                task: "level_assessment",
                locale,
                userId,
                promptVersion: PROMPT_VERSION,
                messages,
            },
            DiagnoseQuestionsOutputSchema,
            { userId, supabase, requestId }
        );

        return NextResponse.json({
            questions: result.data.questions,
            instructions: result.data.instructions,
            language: result.data.language,
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
        console.error("[onboarding/diagnose/generate] unexpected error:", err);
        return safeErrorResponse(500, "INTERNAL_ERROR", "Internal server error");
    }
}
