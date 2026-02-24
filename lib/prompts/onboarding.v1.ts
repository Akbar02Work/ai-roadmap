// ============================================================
// Prompt: Onboarding Chat v1
// Structured JSON output — collects learning goal details.
// ============================================================

import type { LLMMessage, Locale } from "@/lib/llm/types";

export const PROMPT_VERSION = "onboarding.v1";

interface OnboardingPromptContext {
    userMessage: string;
    conversationHistory?: LLMMessage[];
    currentCollected?: Record<string, unknown>;
}

export function buildPrompt(
    locale: Locale,
    ctx: OnboardingPromptContext
): LLMMessage[] {
    const lang = locale === "ru" ? "Russian" : "English";

    const collectedStr = ctx.currentCollected
        ? `\nAlready collected data: ${JSON.stringify(ctx.currentCollected)}`
        : "";

    const systemMsg: LLMMessage = {
        role: "system",
        content: [
            `You are a friendly onboarding assistant for an AI learning roadmap app.`,
            `Speak in ${lang}.`,
            `Your goal is to understand the user's learning objective by gathering:`,
            `1. language — what language they want to learn`,
            `2. targetLevel — desired CEFR level (A1-C2)`,
            `3. minutesPerDay — how many minutes per day they can study`,
            `4. daysPerWeek — how many days per week`,
            `5. deadline — target date or timeframe (optional)`,
            `6. motivation — why they want to learn (career, travel, hobby, etc.)`,
            ``,
            `Ask ONE question at a time. Be encouraging and concise.`,
            `Do NOT repeat questions about data you already have.`,
            collectedStr,
            ``,
            `You MUST respond with valid JSON matching this exact schema:`,
            `{`,
            `  "assistantMessage": "<your message to the user>",`,
            `  "collected": {`,
            `    "language": "<string or null>",`,
            `    "targetLevel": "<A1|A2|B1|B2|C1|C2 or null>",`,
            `    "minutesPerDay": <number or null>,`,
            `    "daysPerWeek": <number or null>,`,
            `    "deadline": "<string or null>",`,
            `    "motivation": "<string or null>"`,
            `  },`,
            `  "nextAction": "<ask_more or start_diagnostic>"`,
            `}`,
            ``,
            `Set nextAction to "start_diagnostic" only when you have collected at least:`,
            `language, minutesPerDay, daysPerWeek, and motivation.`,
            `Otherwise set it to "ask_more".`,
        ].join("\n"),
    };

    const messages: LLMMessage[] = [systemMsg];

    if (ctx.conversationHistory?.length) {
        messages.push(...ctx.conversationHistory);
    }

    messages.push({ role: "user", content: ctx.userMessage });

    return messages;
}
