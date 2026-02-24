// ============================================================
// LLM Provider Clients — OpenAI + Anthropic raw callers
// ============================================================

import "server-only";
import OpenAI from "openai";
import type { ModelConfig, LLMMessage, RawLLMResponse } from "./types";

// ---- OpenAI --------------------------------------------------

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
    if (!openaiClient) {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error("OPENAI_API_KEY is not set");
        }
        openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return openaiClient;
}

export async function callOpenAI(
    config: ModelConfig,
    messages: LLMMessage[],
    jsonMode: boolean
): Promise<RawLLMResponse> {
    const client = getOpenAI();
    const start = Date.now();

    const completion = await client.chat.completions.create({
        model: config.model,
        messages,
        temperature: config.temperature ?? 0.5,
        max_tokens: config.maxTokens ?? 4096,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    });

    return {
        content: completion.choices[0]?.message?.content ?? "",
        model: config.model,
        provider: "openai",
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
        latencyMs: Date.now() - start,
    };
}

// ---- Anthropic -----------------------------------------------

export async function callAnthropic(
    config: ModelConfig,
    messages: LLMMessage[]
): Promise<RawLLMResponse> {
    if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error("ANTHROPIC_API_KEY is not set");
    }

    const start = Date.now();
    const systemMessage = messages.find((m) => m.role === "system");
    const otherMessages = messages.filter((m) => m.role !== "system");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": process.env.ANTHROPIC_API_KEY,
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
        const body = await response.text();
        throw new Error(`Anthropic ${response.status}: ${body}`);
    }

    const data = await response.json();

    return {
        content: data.content?.[0]?.text ?? "",
        model: config.model,
        provider: "anthropic",
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
        latencyMs: Date.now() - start,
    };
}

// ---- OpenRouter -----------------------------------------------

const OPENROUTER_DEFAULT_MODEL = "google/gemini-2.5-flash";

let openrouterClient: OpenAI | null = null;

function getOpenRouter(): OpenAI {
    if (!openrouterClient) {
        if (!process.env.OPENROUTER_API_KEY) {
            throw new Error("OPENROUTER_API_KEY is not set");
        }
        openrouterClient = new OpenAI({
            apiKey: process.env.OPENROUTER_API_KEY,
            baseURL: "https://openrouter.ai/api/v1",
            defaultHeaders: {
                "HTTP-Referer": "https://ai-roadmap.app",
                "X-Title": "AI Roadmap",
            },
        });
    }
    return openrouterClient;
}

export async function callOpenRouter(
    config: ModelConfig,
    messages: LLMMessage[],
    jsonMode: boolean
): Promise<RawLLMResponse> {
    const client = getOpenRouter();
    const start = Date.now();

    // Resolve model: if placeholder, use env or default
    const model =
        config.model === "__OPENROUTER_MODEL__"
            ? process.env.OPENROUTER_MODEL ?? OPENROUTER_DEFAULT_MODEL
            : config.model;

    try {
        const completion = await client.chat.completions.create({
            model,
            messages,
            temperature: config.temperature ?? 0.5,
            max_tokens: config.maxTokens ?? 4096,
            ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        });

        return {
            content: completion.choices[0]?.message?.content ?? "",
            model,
            provider: "openrouter",
            inputTokens: completion.usage?.prompt_tokens ?? 0,
            outputTokens: completion.usage?.completion_tokens ?? 0,
            latencyMs: Date.now() - start,
        };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(`OpenRouter (${model}) failed: ${msg}`);
    }
}

// ---- Dispatcher ----------------------------------------------

export async function callProvider(
    config: ModelConfig,
    messages: LLMMessage[],
    jsonMode: boolean
): Promise<RawLLMResponse> {
    switch (config.provider) {
        case "openai":
            return callOpenAI(config, messages, jsonMode);
        case "anthropic":
            return callAnthropic(config, messages);
        case "openrouter":
            return callOpenRouter(config, messages, jsonMode);
        default:
            throw new Error(`Unknown provider: ${config.provider}`);
    }
}

