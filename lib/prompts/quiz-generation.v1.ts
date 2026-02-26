// ============================================================
// Prompt: Quiz Generation v1
// Generates MCQ questions for a roadmap node.
// ============================================================

import type { LLMMessage, Locale } from "@/lib/llm/types";

export const PROMPT_VERSION = "quiz-generation.v1";

interface QuizGenContext {
    nodeTitle: string;
    nodeDescription: string;
    skills: string[];
    cefrLevel: string;
    language: string;
}

export function buildPrompt(
    locale: Locale,
    ctx: QuizGenContext
): LLMMessage[] {
    const lang = locale === "ru" ? "Russian" : "English";

    return [
        {
            role: "system",
            content: [
                `You are an expert quiz creator for personalized learning.`,
                `Create a short multiple-choice quiz in ${lang}.`,
                ``,
                `Respond ONLY with valid JSON matching this exact schema:`,
                `{`,
                `  "questions": [`,
                `    {`,
                `      "prompt": "<question text>",`,
                `      "options": ["<option A>", "<option B>", "<option C>", "<option D>"],`,
                `      "correctIndex": <0-3>,`,
                `      "explanation": "<why this answer is correct>"`,
                `    }`,
                `  ]`,
                `}`,
                ``,
                `Rules:`,
                `- Create 4-5 questions.`,
                `- Each question must have exactly 4 options.`,
                `- correctIndex is 0-based (0=first option).`,
                `- Questions should test the skills listed below at the appropriate level.`,
                `- Mix difficulty: 2 easy, 2 medium, 1 harder.`,
                `- Explanations should be brief but educational.`,
                `- Do NOT include markdown code fences or any text outside the JSON.`,
            ].join("\n"),
        },
        {
            role: "user",
            content: [
                `Create a quiz for this learning node:`,
                `- Topic: ${ctx.nodeTitle}`,
                `- Description: ${ctx.nodeDescription}`,
                `- Skills: ${ctx.skills.join(", ")}`,
                `- Student level: ${ctx.cefrLevel}`,
                `- Subject: ${ctx.language}`,
            ].join("\n"),
        },
    ];
}
