// ============================================================
// POST /api/llm/test — Smoke-test endpoint for LLM infra
//
// Calls callLLM with quiz_generation task, validates output
// with Zod schema, logs to ai_logs, and increments usage.
//
// Production: disabled by default, enable via
//   ENABLE_LLM_TEST_ENDPOINT=true
//
// Body: { topic: string, level?: string, locale?: string }
// Returns: { data: QuizOutput, meta: LLMCallMeta }
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { requireAuth } from "@/lib/auth";
import { callLLMStructured, LLMError, checkRateLimit } from "@/lib/llm";
import { generateRequestId } from "@/lib/observability/track-event";
import { QuizOutputSchema } from "@/lib/schemas/quiz";
import {
    buildPrompt,
    PROMPT_VERSION,
} from "@/lib/prompts/quiz-generation.v1";
import {
    safeErrorResponse,
    safeLLMErrorResponse,
    safeAuthErrorResponse,
} from "@/lib/api/safe-error";
import { AuthError } from "@/lib/auth";

const RequestBodySchema = z.object({
    topic: z.string().min(1).max(200),
    level: z.string().max(10).optional(),
    locale: z.enum(["en", "ru"]).optional(),
});

export async function POST(request: NextRequest) {
    // Production guard: disabled unless explicitly opted in
    if (
        process.env.NODE_ENV === "production" &&
        process.env.ENABLE_LLM_TEST_ENDPOINT !== "true"
    ) {
        return safeErrorResponse(404, "NOT_FOUND", "Not found");
    }

    try {
        const { userId, supabase } = await requireAuth();
        const requestId = generateRequestId();

        // 0. Strict rate limit on this endpoint (expensive)
        const rl = await checkRateLimit(userId, /* strict */ true);
        if (!rl.allowed) {
            const status = rl.statusCode ?? 429;
            if (status === 503) {
                return safeErrorResponse(
                    503,
                    "SERVICE_UNAVAILABLE",
                    rl.reason ?? "Rate limit backend misconfigured."
                );
            }
            return safeErrorResponse(status, "LLM_RATE_LIMIT", rl.reason ?? "Rate limit exceeded. Try again later.");
        }

        // 1. Parse request body
        const raw = await request.json();
        const body = RequestBodySchema.parse(raw);

        const locale = body.locale ?? "en";

        // 2. Build prompt
        const messages = buildPrompt(locale, {
            nodeTitle: body.topic,
            nodeDescription: body.topic,
            skills: [],
            cefrLevel: body.level ?? "B1",
            language: "English",
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
            { userId, supabase, requestId }
        );

        return NextResponse.json(result, { status: 200 });
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

        const message = err instanceof Error ? err.message : String(err);
        const isProviderConfigError =
            message.includes("API_KEY") || message.includes("is not set");
        console.error("[llm/test] unexpected error:", message);

        return safeErrorResponse(
            isProviderConfigError ? 503 : 500,
            isProviderConfigError ? "SERVICE_UNAVAILABLE" : "INTERNAL_ERROR",
            isProviderConfigError
                ? "LLM provider configuration unavailable."
                : "LLM test request failed."
        );
    }
}
