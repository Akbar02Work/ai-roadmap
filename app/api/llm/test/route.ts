// ============================================================
// POST /api/llm/test — Smoke-test endpoint for LLM infra
//
// Calls callLLM with quiz_generation task, validates output
// with Zod schema, logs to ai_logs, and increments usage.
//
// Body: { topic: string, level?: string, locale?: string }
// Returns: { data: QuizOutput, meta: LLMCallMeta }
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { requireAuth, AuthError } from "@/lib/auth";
import { callLLMStructured, LLMError, checkRateLimit } from "@/lib/llm";
import { QuizOutputSchema } from "@/lib/schemas/quiz";
import {
    buildPrompt,
    PROMPT_VERSION,
} from "@/lib/prompts/quiz-generation.v1";

const RequestBodySchema = z.object({
    topic: z.string().min(1).max(200),
    level: z.string().max(10).optional(),
    locale: z.enum(["en", "ru"]).optional(),
});

export async function POST(request: NextRequest) {
    try {
        const { userId, supabase } = await requireAuth();

        // 0. Strict rate limit on this endpoint (expensive)
        const rl = await checkRateLimit(userId, /* strict */ true);
        if (!rl.allowed) {
            const status = rl.statusCode ?? 429;
            if (status === 503) {
                return NextResponse.json(
                    { error: rl.reason ?? "Rate limit backend misconfigured." },
                    { status: 503 }
                );
            }
            return NextResponse.json(
                {
                    error: rl.reason ?? "Rate limit exceeded. Try again later.",
                    retryAfterMs: rl.resetMs,
                },
                { status }
            );
        }

        // 1. Parse request body
        const raw = await request.json();
        const body = RequestBodySchema.parse(raw);

        const locale = body.locale ?? "en";

        // 2. Build prompt
        const messages = buildPrompt(locale, {
            topic: body.topic,
            level: body.level,
            numQuestions: 3,
        });

        // 3. Call LLM with structured output
        const result = await callLLMStructured(
            {
                task: "quiz_generation",
                locale,
                userId,
                promptVersion: PROMPT_VERSION,
                messages,
            },
            QuizOutputSchema,
            { userId, supabase }
        );

        return NextResponse.json(result, { status: 200 });
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
                { error: err.message, task: err.task },
                { status: err.httpStatus }
            );
        }

        // API key missing or other server error
        const message =
            err instanceof Error ? err.message : "Internal server error";
        const isKeyMissing =
            message.includes("API_KEY") || message.includes("is not set");

        return NextResponse.json(
            {
                error: isKeyMissing
                    ? "LLM provider API key not configured. Set OPENAI_API_KEY and/or ANTHROPIC_API_KEY."
                    : message,
            },
            { status: isKeyMissing ? 503 : 500 }
        );
    }
}
