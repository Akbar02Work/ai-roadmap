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
    // 0. Strict rate limit on this endpoint (expensive)
    const ip =
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        "unknown-ip";
    const rl = await checkRateLimit(ip, /* strict */ true);
    if (!rl.allowed) {
        return NextResponse.json(
            { error: "Rate limit exceeded. Try again later.", retryAfterMs: rl.resetMs },
            { status: 429 }
        );
    }

    // 1. Parse request body
    let body: z.infer<typeof RequestBodySchema>;
    try {
        const raw = await request.json();
        body = RequestBodySchema.parse(raw);
    } catch (err) {
        const message =
            err instanceof z.ZodError
                ? `Validation error: ${err.issues.map((i) => i.message).join(", ")}`
                : "Invalid JSON body";
        return NextResponse.json({ error: message }, { status: 400 });
    }

    const locale = body.locale ?? "en";

    // 2. Build prompt
    const messages = buildPrompt(locale, {
        topic: body.topic,
        level: body.level,
        numQuestions: 3,
    });

    // 3. Call LLM with structured output
    try {
        const result = await callLLMStructured(
            {
                task: "quiz_generation",
                locale,
                promptVersion: PROMPT_VERSION,
                messages,
                // No userId — this is a test endpoint (anonymous)
            },
            QuizOutputSchema
        );

        return NextResponse.json(result, { status: 200 });
    } catch (err) {
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
