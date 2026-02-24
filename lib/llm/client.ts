// ============================================================
// LLM Service — Multi-provider client with retry + fallback
// ============================================================

import OpenAI from "openai";
import {
    type LLMTask,
    type LLMRequest,
    type LLMResponse,
    type ModelConfig,
    MODEL_ROUTING,
} from "./types";

// Lazy-initialized clients
let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
    if (!openaiClient) {
        openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return openaiClient;
}

async function callOpenAI(
    config: ModelConfig,
    request: LLMRequest
): Promise<LLMResponse> {
    const client = getOpenAIClient();
    const start = Date.now();

    const completion = await client.chat.completions.create({
        model: config.model,
        messages: request.messages,
        temperature: config.temperature ?? 0.5,
        max_tokens: config.maxTokens ?? 4096,
        ...(request.structuredOutput
            ? { response_format: { type: "json_object" } }
            : {}),
    });

    const latencyMs = Date.now() - start;

    return {
        content: completion.choices[0]?.message?.content ?? "",
        model: config.model,
        provider: "openai",
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
        latencyMs,
    };
}

async function callAnthropic(
    config: ModelConfig,
    request: LLMRequest
): Promise<LLMResponse> {
    // Using Anthropic REST API directly (no SDK needed for MVP)
    const start = Date.now();

    const systemMessage = request.messages.find((m) => m.role === "system");
    const otherMessages = request.messages.filter((m) => m.role !== "system");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": process.env.ANTHROPIC_API_KEY!,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
            model: config.model,
            max_tokens: config.maxTokens ?? 4096,
            temperature: config.temperature ?? 0.5,
            ...(systemMessage ? { system: systemMessage.content } : {}),
            messages: otherMessages.map((m) => ({
                role: m.role,
                content: m.content,
            })),
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Anthropic API error: ${response.status} ${error}`);
    }

    const data = await response.json();
    const latencyMs = Date.now() - start;

    return {
        content: data.content?.[0]?.text ?? "",
        model: config.model,
        provider: "anthropic",
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
        latencyMs,
    };
}

async function callProvider(
    config: ModelConfig,
    request: LLMRequest
): Promise<LLMResponse> {
    switch (config.provider) {
        case "openai":
            return callOpenAI(config, request);
        case "anthropic":
            return callAnthropic(config, request);
        default:
            throw new Error(`Unknown provider: ${config.provider}`);
    }
}

// ============================================================
// Main entry point — generate() with retry + fallback
// ============================================================
const MAX_RETRIES = 3;

export async function generate(request: LLMRequest): Promise<LLMResponse> {
    const routing = MODEL_ROUTING[request.task];

    // Try primary model with retries
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await callProvider(routing.primary, request);
        } catch (error) {
            console.error(
                `[LLM] Primary ${routing.primary.model} attempt ${attempt}/${MAX_RETRIES} failed:`,
                error
            );
            if (attempt < MAX_RETRIES) {
                // Exponential backoff
                await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500));
            }
        }
    }

    // Fallback to secondary model
    console.warn(
        `[LLM] Falling back to ${routing.fallback.model} for task ${request.task}`
    );
    try {
        return await callProvider(routing.fallback, request);
    } catch (error) {
        console.error(`[LLM] Fallback ${routing.fallback.model} also failed:`, error);
        throw new Error(
            `All LLM providers failed for task "${request.task}". Please try again later.`
        );
    }
}

// Re-export types for convenience
export type { LLMTask, LLMRequest, LLMResponse } from "./types";
