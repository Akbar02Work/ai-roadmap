// ============================================================
// callLLM() — Unified LLM interface
//
// Flow: rate-limit → usage check → primary (3 retries) → fallback (1 try)
// Structured outputs validated via Zod; retry on parse/validation failure.
// Every call logged to ai_logs.
// ============================================================

import { z } from "zod/v4";
import { prisma } from "@/lib/db";
import { callProvider } from "./providers";
import { checkUsageLimit, consumeUsage } from "./usage";
import { checkRateLimit } from "./rate-limit";
import type {
    CallLLMInput,
    CallLLMResult,
    LLMCallMeta,
    RawLLMResponse,
    ModelConfig,
    LLMMessage,
} from "./types";
import { MODEL_ROUTING } from "./types";

const PRIMARY_RETRIES = 3;

// ---- helpers -------------------------------------------------

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * Try to parse the raw LLM content as JSON and validate with schema.
 * Throws if parsing or validation fails.
 */
function parseAndValidate<T>(content: string, schema: z.ZodType<T>): T {
    // Try to extract JSON from markdown code fences (```json ... ```)
    const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = fenceMatch ? fenceMatch[1].trim() : content.trim();

    const parsed = JSON.parse(jsonStr); // throws on invalid JSON
    return schema.parse(parsed);        // throws on validation failure
}

// ---- single provider attempt ---------------------------------

async function tryCall(
    config: ModelConfig,
    messages: LLMMessage[],
    jsonMode: boolean
): Promise<RawLLMResponse> {
    return callProvider(config, messages, jsonMode);
}

// ---- ai_logs persistence -------------------------------------

async function logToAiLogs(
    input: CallLLMInput,
    raw: RawLLMResponse | null,
    status: "success" | "error",
    errorMessage?: string
): Promise<void> {
    try {
        await prisma.aiLog.create({
            data: {
                userId: input.userId ?? null,
                taskType: input.task,
                model: raw?.model ?? "unknown",
                promptVersion: input.promptVersion,
                inputTokens: raw?.inputTokens ?? 0,
                outputTokens: raw?.outputTokens ?? 0,
                latencyMs: raw?.latencyMs ?? 0,
                status,
                errorMessage: errorMessage?.slice(0, 2000) ?? null,
            },
        });
    } catch (e) {
        // Logging must never crash the main flow
        console.error("[ai_logs] Failed to persist log:", e);
    }
}

// ---- build meta object ---------------------------------------

function buildMeta(
    raw: RawLLMResponse,
    promptVersion: string,
    attempts: number,
    usedFallback: boolean
): LLMCallMeta {
    return {
        model: raw.model,
        provider: raw.provider,
        inputTokens: raw.inputTokens,
        outputTokens: raw.outputTokens,
        latencyMs: raw.latencyMs,
        promptVersion,
        attempts,
        usedFallback,
    };
}

// ---- success handler -----------------------------------------

async function onSuccess(
    input: CallLLMInput,
    raw: RawLLMResponse
): Promise<void> {
    if (input.userId) {
        const consumed = await consumeUsage(
            input.userId,
            raw.inputTokens + raw.outputTokens,
            1
        );
        if (!consumed.allowed) {
            await logToAiLogs(input, raw, "error", consumed.reason ?? "Usage limit exceeded.");
            throw new LLMError(consumed.reason ?? "Usage limit exceeded.", 403, input.task);
        }
    }
    await logToAiLogs(input, raw, "success");
}

// ---- main function: plain string output ----------------------

export async function callLLM(
    input: CallLLMInput
): Promise<CallLLMResult<string>> {
    return callLLMInternal(input, null);
}

// ---- main function: structured output with Zod schema --------

export async function callLLMStructured<T>(
    input: CallLLMInput,
    schema: z.ZodType<T>
): Promise<CallLLMResult<T>> {
    return callLLMInternal(input, schema);
}

// ---- internal implementation ---------------------------------

async function callLLMInternal<T>(
    input: CallLLMInput,
    schema: z.ZodType<T> | null
): Promise<CallLLMResult<T>> {
    const routing = MODEL_ROUTING[input.task];
    const jsonMode = schema !== null;
    let totalAttempts = 0;

    // 1. Rate limiting (uses userId or "anon")
    const rlResult = await checkRateLimit(input.userId ?? "anon");
    if (!rlResult.allowed) {
        throw new LLMError("Rate limit exceeded. Please slow down.", 429, input.task);
    }

    // 2. Usage limit check (only for authenticated users)
    if (input.userId) {
        const usageResult = await checkUsageLimit(input.userId);
        if (!usageResult.allowed) {
            throw new LLMError(usageResult.reason ?? "Usage limit exceeded.", 403, input.task);
        }
    }

    // 3. Primary model: up to PRIMARY_RETRIES attempts
    let lastError: Error | null = null;
    let lastRaw: RawLLMResponse | null = null;

    for (let attempt = 1; attempt <= PRIMARY_RETRIES; attempt++) {
        totalAttempts++;
        try {
            const raw = await tryCall(routing.primary, input.messages, jsonMode);
            lastRaw = raw;

            if (schema) {
                const data = parseAndValidate(raw.content, schema);
                await onSuccess(input, raw);
                return { data, meta: buildMeta(raw, input.promptVersion, totalAttempts, false) };
            }

            // No schema — return raw content
            await onSuccess(input, raw);
            return {
                data: raw.content as T,
                meta: buildMeta(raw, input.promptVersion, totalAttempts, false),
            };
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            if (lastError instanceof LLMError && lastError.httpStatus === 403) {
                throw lastError;
            }
            console.error(
                `[LLM] Primary ${routing.primary.model} attempt ${attempt}/${PRIMARY_RETRIES}:`,
                lastError.message
            );
            await logToAiLogs(input, lastRaw, "error", lastError.message);

            if (attempt < PRIMARY_RETRIES) {
                await sleep(Math.pow(2, attempt) * 500);
            }
        }
    }

    // 4. Fallback model: 1 attempt
    totalAttempts++;
    console.warn(`[LLM] Falling back to ${routing.fallback.model}`);

    try {
        const raw = await tryCall(routing.fallback, input.messages, jsonMode);
        lastRaw = raw;

        if (schema) {
            const data = parseAndValidate(raw.content, schema);
            await onSuccess(input, raw);
            return { data, meta: buildMeta(raw, input.promptVersion, totalAttempts, true) };
        }

        await onSuccess(input, raw);
        return {
            data: raw.content as T,
            meta: buildMeta(raw, input.promptVersion, totalAttempts, true),
        };
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        if (err instanceof LLMError && err.httpStatus === 403) {
            throw err;
        }
        await logToAiLogs(input, lastRaw, "error", err.message);

        throw new LLMError(
            `All LLM providers failed for "${input.task}" after ${totalAttempts} attempts. Last error: ${err.message}`,
            503,
            input.task
        );
    }
}

// ---- custom error class --------------------------------------

export class LLMError extends Error {
    constructor(
        message: string,
        public readonly httpStatus: number,
        public readonly task: string
    ) {
        super(message);
        this.name = "LLMError";
    }
}
