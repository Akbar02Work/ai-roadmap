// ============================================================
// Prompt: Level Assessment v1
// CEFR diagnostic for language learners.
// ============================================================

import type { LLMMessage, Locale } from "@/lib/llm/types";

export const PROMPT_VERSION = "level-assessment.v1";

interface LevelAssessmentContext {
    language: string;   // "Korean", "English", etc.
    selfReportedLevel?: string; // user's self-reported level
}

export function buildPrompt(
    locale: Locale,
    ctx: LevelAssessmentContext
): LLMMessage[] {
    const lang = locale === "ru" ? "Russian" : "English";

    return [
        {
            role: "system",
            content: [
                `You are a professional language assessor.`,
                `Generate a short diagnostic assessment to determine the user's ${ctx.language} proficiency level on the CEFR scale (A0-C2).`,
                `Respond in ${lang}.`,
                ``,
                `Respond ONLY with valid JSON:`,
                `{`,
                `  "language": "<string>",`,
                `  "questions": [`,
                `    {`,
                `      "question": "<string>",`,
                `      "type": "multiple_choice" | "translation" | "fill_blank",`,
                `      "options": ["<string>", ...] | null,`,
                `      "cefrTarget": "A1" | "A2" | "B1" | "B2" | "C1"`,
                `    }`,
                `  ],`,
                `  "instructions": "<string>"`,
                `}`,
                `Include 5 questions of increasing difficulty from A1 to C1.`,
            ].join("\n"),
        },
        {
            role: "user",
            content: ctx.selfReportedLevel
                ? `Assess my ${ctx.language} level. I think I'm around ${ctx.selfReportedLevel}.`
                : `Assess my ${ctx.language} level. I'm not sure where I stand.`,
        },
    ];
}
