// ============================================================
// Prompt: Roadmap Generation v1
// Generates a structured learning roadmap from goal + diagnosis.
// ============================================================

import type { LLMMessage } from "@/lib/llm/types";

export const PROMPT_VERSION = "roadmap-generation.v1";

interface RoadmapGenContext {
    category: string;
    target: string;
    currentLevel: string;
    targetLevel?: string;
    motivation: string;
    minutesPerDay: number;
    daysPerWeek: number;
    deadline?: string;
}

export function buildPrompt(
    locale: string,
    ctx: RoadmapGenContext
): LLMMessage[] {
    const lang = locale === "ru" ? "Russian" : "English";

    return [
        {
            role: "system",
            content: [
                `You are an expert curriculum designer for personalized learning.`,
                `Create a step-by-step learning roadmap in ${lang}.`,
                ``,
                `Respond ONLY with valid JSON:`,
                `{`,
                `  "title": "<string>",`,
                `  "estimatedWeeks": <number>,`,
                `  "nodes": [`,
                `    {`,
                `      "sortOrder": <number>,`,
                `      "title": "<string>",`,
                `      "description": "<string>",`,
                `      "nodeType": "lesson" | "quiz" | "practice" | "review",`,
                `      "estMinutes": <number>,`,
                `      "skills": ["<string>", ...]`,
                `    }`,
                `  ]`,
                `}`,
                `Create 8-15 nodes. Mix lessons, quizzes, and practice sessions.`,
                `Ensure progression from current level to target.`,
            ].join("\n"),
        },
        {
            role: "user",
            content: [
                `Create a roadmap:`,
                `- Category: ${ctx.category}`,
                `- Goal: ${ctx.target}`,
                `- Current level: ${ctx.currentLevel}`,
                ctx.targetLevel ? `- Target level: ${ctx.targetLevel}` : "",
                `- Motivation: ${ctx.motivation}`,
                `- Available: ${ctx.minutesPerDay} min/day, ${ctx.daysPerWeek} days/week`,
                ctx.deadline ? `- Deadline: ${ctx.deadline}` : "",
            ]
                .filter(Boolean)
                .join("\n"),
        },
    ];
}
