// ============================================================
// Prompt: Roadmap Generation v1
// Generates a structured learning roadmap from goal + diagnosis.
// Returns JSON matching RoadmapOutputSchema.
// ============================================================

import type { LLMMessage, Locale } from "@/lib/llm/types";

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
    locale: Locale,
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
                `Respond ONLY with valid JSON matching this exact schema:`,
                `{`,
                `  "roadmapTitle": "<string>",`,
                `  "summary": "<1-2 sentence overview of the roadmap>",`,
                `  "nodes": [`,
                `    {`,
                `      "title": "<string>",`,
                `      "description": "<string>",`,
                `      "nodeType": "lesson" | "practice" | "review" | "quiz",`,
                `      "estMinutes": <number 5-120>,`,
                `      "skills": ["<string>", ...],`,
                `      "passRules": { "minScore": <0-1>, "requireReport": <boolean> }`,
                `    }`,
                `  ]`,
                `}`,
                ``,
                `Rules:`,
                `- Create 8-15 nodes. Mix lessons (60%), practice (20%), quizzes (15%), and reviews (5%).`,
                `- Ensure a natural progression from the user's current level to their target.`,
                `- For quizzes: set minScore to 0.7 and requireReport to false.`,
                `- For lessons: set minScore to 0 and requireReport to false.`,
                `- For practice: set minScore to 0.5 and requireReport to true.`,
                `- Adapt time per node to the user's available schedule.`,
                `- Each skill tag should be concise (e.g. "vocabulary", "grammar basics", "reading comprehension").`,
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
