// ============================================================
// LLM Service Layer — Types
// ============================================================

export type LLMTask =
    | "onboarding_chat"
    | "level_assessment"
    | "roadmap_generation"
    | "roadmap_adaptation"
    | "quiz_generation"
    | "artifact_grading"
    | "quality_check";

export type LLMProvider = "openai" | "anthropic";

export interface ModelConfig {
    provider: LLMProvider;
    model: string;
    maxTokens?: number;
    temperature?: number;
}

export interface TaskRouting {
    primary: ModelConfig;
    fallback: ModelConfig;
}

export interface LLMRequest {
    task: LLMTask;
    messages: LLMMessage[];
    locale: string;
    structuredOutput?: object; // Zod schema or JSON schema
}

export interface LLMMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

export interface LLMResponse {
    content: string;
    model: string;
    provider: LLMProvider;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    promptVersion?: string;
}

// ============================================================
// Model Routing Configuration
// Cheap tasks → GPT-5-mini, Expensive tasks → GPT-5.2
// Fallback → Claude Sonnet
// ============================================================
export const MODEL_ROUTING: Record<LLMTask, TaskRouting> = {
    onboarding_chat: {
        primary: { provider: "openai", model: "gpt-5-mini", temperature: 0.7 },
        fallback: { provider: "anthropic", model: "claude-sonnet-4-20250514", temperature: 0.7 },
    },
    level_assessment: {
        primary: { provider: "openai", model: "gpt-5-mini", temperature: 0.3 },
        fallback: { provider: "anthropic", model: "claude-sonnet-4-20250514", temperature: 0.3 },
    },
    roadmap_generation: {
        primary: { provider: "openai", model: "gpt-5.2", temperature: 0.5 },
        fallback: { provider: "anthropic", model: "claude-sonnet-4-20250514", temperature: 0.5 },
    },
    roadmap_adaptation: {
        primary: { provider: "openai", model: "gpt-5.2", temperature: 0.5 },
        fallback: { provider: "anthropic", model: "claude-sonnet-4-20250514", temperature: 0.5 },
    },
    quiz_generation: {
        primary: { provider: "openai", model: "gpt-5-mini", temperature: 0.5 },
        fallback: { provider: "anthropic", model: "claude-sonnet-4-20250514", temperature: 0.5 },
    },
    artifact_grading: {
        primary: { provider: "openai", model: "gpt-5-mini", temperature: 0.2 },
        fallback: { provider: "anthropic", model: "claude-sonnet-4-20250514", temperature: 0.2 },
    },
    quality_check: {
        primary: { provider: "anthropic", model: "claude-sonnet-4-20250514", temperature: 0.2 },
        fallback: { provider: "openai", model: "gpt-5.2", temperature: 0.2 },
    },
};
