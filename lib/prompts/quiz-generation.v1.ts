// ============================================================
// Prompt: Quiz Generation v1
// Generates a multiple-choice quiz on a given topic.
// ============================================================

import type { LLMMessage } from "@/lib/llm/types";

export const PROMPT_VERSION = "quiz-generation.v1";

interface QuizPromptContext {
    topic: string;
    level?: string; // e.g. 'A1', 'B2', 'beginner'
    numQuestions?: number;
}

export function buildPrompt(
    locale: string,
    ctx: QuizPromptContext
): LLMMessage[] {
    const lang = locale === "ru" ? "Russian" : "English";
    const numQ = ctx.numQuestions ?? 3;
    const levelHint = ctx.level ? ` at ${ctx.level} level` : "";

    return [
        {
            role: "system",
            content: [
                `You are an expert quiz creator for language learners.`,
                `Generate quizzes in ${lang}.`,
                `IMPORTANT: respond ONLY with valid JSON matching this exact structure:`,
                `{`,
                `  "topic": "<string>",`,
                `  "level": "<string>",`,
                `  "questions": [`,
                `    {`,
                `      "question": "<string>",`,
                `      "options": ["<string>", "<string>", "<string>", "<string>"],`,
                `      "correctIndex": <0|1|2|3>,`,
                `      "explanation": "<string>"`,
                `    }`,
                `  ]`,
                `}`,
                `Do NOT include markdown code fences or any text outside the JSON object.`,
            ].join("\n"),
        },
        {
            role: "user",
            content: `Create a ${numQ}-question multiple-choice quiz on "${ctx.topic}"${levelHint}.`,
        },
    ];
}
