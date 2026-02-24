// ============================================================
// Prompt: Onboarding Chat v1
// Initial onboarding conversation to gather goal details.
// ============================================================

import type { LLMMessage, Locale } from "@/lib/llm/types";

export const PROMPT_VERSION = "onboarding.v1";

interface OnboardingPromptContext {
    userMessage: string;
    conversationHistory?: LLMMessage[];
    category?: string;
}

export function buildPrompt(
    locale: Locale,
    ctx: OnboardingPromptContext
): LLMMessage[] {
    const lang = locale === "ru" ? "Russian" : "English";

    const systemMsg: LLMMessage = {
        role: "system",
        content: [
            `You are a friendly onboarding assistant for an AI learning roadmap app.`,
            `Speak in ${lang}.`,
            `Your goal is to understand the user's learning objective by asking about:`,
            `1. What they want to learn (topic/language)`,
            `2. Their current level (for languages: A0-C2 CEFR)`,
            `3. Their motivation (career, travel, hobby)`,
            `4. Time constraints (minutes per day, days per week)`,
            `5. Target level or deadline`,
            ``,
            `Ask ONE question at a time. Be encouraging and concise.`,
            `When you have enough information, respond with JSON:`,
            `{ "ready": true, "summary": { "category": "...", "target": "...", "currentLevel": "...", "motivation": "...", "minutesPerDay": N, "daysPerWeek": N } }`,
            `Until then, respond with plain text (no JSON).`,
        ].join("\n"),
    };

    const messages: LLMMessage[] = [systemMsg];

    // Append conversation history if available
    if (ctx.conversationHistory?.length) {
        messages.push(...ctx.conversationHistory);
    }

    messages.push({ role: "user", content: ctx.userMessage });

    return messages;
}
