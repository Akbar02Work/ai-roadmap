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
export type Locale = "en" | "ru";

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

// ============================================================
// callLLM() — unified input/output
// ============================================================

export interface CallLLMInput {
    task: LLMTask;
    locale: Locale;
    userId?: string;
    promptVersion: string;
    messages: LLMMessage[];
}

export interface CallLLMResult<T = string> {
    data: T;
    meta: LLMCallMeta;
}

export interface LLMCallMeta {
    model: string;
    provider: LLMProvider;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    promptVersion: string;
    attempts: number;
    usedFallback: boolean;
}

export interface LLMMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

/** Raw response from a provider call */
export interface RawLLMResponse {
    content: string;
    model: string;
    provider: LLMProvider;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
}

// ============================================================
// Model Routing Configuration
// Cheap tasks → gpt-4.1-mini, Expensive tasks → gpt-4.1
// Fallback → Claude Sonnet
// ============================================================
export const MODEL_ROUTING: Record<LLMTask, TaskRouting> = {
    onboarding_chat: {
        primary: { provider: "openai", model: "gpt-4.1-mini", temperature: 0.7 },
        fallback: { provider: "anthropic", model: "claude-sonnet-4-20250514", temperature: 0.7 },
    },
    level_assessment: {
        primary: { provider: "openai", model: "gpt-4.1-mini", temperature: 0.3 },
        fallback: { provider: "anthropic", model: "claude-sonnet-4-20250514", temperature: 0.3 },
    },
    roadmap_generation: {
        primary: { provider: "openai", model: "gpt-4.1", temperature: 0.5 },
        fallback: { provider: "anthropic", model: "claude-sonnet-4-20250514", temperature: 0.5 },
    },
    roadmap_adaptation: {
        primary: { provider: "openai", model: "gpt-4.1", temperature: 0.5 },
        fallback: { provider: "anthropic", model: "claude-sonnet-4-20250514", temperature: 0.5 },
    },
    quiz_generation: {
        primary: { provider: "openai", model: "gpt-4.1-mini", temperature: 0.5 },
        fallback: { provider: "anthropic", model: "claude-sonnet-4-20250514", temperature: 0.5 },
    },
    artifact_grading: {
        primary: { provider: "openai", model: "gpt-4.1-mini", temperature: 0.2 },
        fallback: { provider: "anthropic", model: "claude-sonnet-4-20250514", temperature: 0.2 },
    },
    quality_check: {
        primary: { provider: "anthropic", model: "claude-sonnet-4-20250514", temperature: 0.2 },
        fallback: { provider: "openai", model: "gpt-4.1", temperature: 0.2 },
    },
};

// ============================================================
// Usage limits per plan
// ============================================================
export type Plan = "free" | "starter" | "pro" | "unlimited";

export interface PlanLimits {
    aiMessagesPerDay: number;
    tokensPerDay: number;
    roadmapsPerMonth: number;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
    free: { aiMessagesPerDay: 10, tokensPerDay: 20_000, roadmapsPerMonth: 1 },
    starter: { aiMessagesPerDay: 50, tokensPerDay: 100_000, roadmapsPerMonth: 3 },
    pro: { aiMessagesPerDay: 200, tokensPerDay: 500_000, roadmapsPerMonth: 10 },
    unlimited: { aiMessagesPerDay: Infinity, tokensPerDay: Infinity, roadmapsPerMonth: Infinity },
};
