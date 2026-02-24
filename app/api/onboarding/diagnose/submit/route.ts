// ============================================================
// POST /api/onboarding/diagnose/submit
// Score user answers, determine CEFR level, save to goal.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { requireAuth, AuthError } from "@/lib/auth";
import { callLLMStructured, LLMError } from "@/lib/llm";
import { DiagnoseResultSchema } from "@/lib/schemas/onboarding";
import {
    buildScorePrompt,
    PROMPT_VERSION,
} from "@/lib/prompts/level-assessment.v1";
import type { Locale } from "@/lib/llm/types";

const RequestBodySchema = z.object({
    goalId: z.string().uuid(),
    sessionId: z.string().uuid(),
    questions: z.array(
        z.object({
            question: z.string(),
            type: z.string(),
            cefrTarget: z.string(),
            options: z.array(z.string()).nullable().optional(),
        })
    ),
    answers: z.array(z.string()),
});

export async function POST(request: NextRequest) {
    try {
        const { userId, supabase } = await requireAuth();

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
            DiagnoseResultSchema
        );

        const { cefrLevel, explanation } = result.data;

        // Update goal with CEFR level
        const mergedDiagnosis = {
            ...diagnosis,
            cefrLevel,
            assessmentExplanation: explanation,
        };

        await supabase
            .from("goals")
            .update({
                cefr_level: cefrLevel,
                diagnosis: mergedDiagnosis,
            })
            .eq("id", body.goalId);

        // Mark session as completed
        await supabase
            .from("onboarding_sessions")
            .update({ status: "completed" })
            .eq("id", body.sessionId);

        return NextResponse.json({ cefrLevel, explanation });
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json(
                { error: err.message },
                { status: err.status }
            );
        }
        if (err instanceof z.ZodError) {
            return NextResponse.json(
                {
                    error: `Validation error: ${err.issues.map((i) => i.message).join(", ")}`,
                },
                { status: 400 }
            );
        }
        if (err instanceof LLMError) {
            return NextResponse.json(
                { error: err.message },
                { status: err.httpStatus }
            );
        }
        console.error("[onboarding/diagnose/submit] unexpected error:", err);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
