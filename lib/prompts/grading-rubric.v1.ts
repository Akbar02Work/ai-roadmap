// ============================================================
// Prompt: Grading Rubric v1
// Grades user-submitted artifacts/reports against a rubric.
// ============================================================

import type { LLMMessage, Locale } from "@/lib/llm/types";

export const PROMPT_VERSION = "grading-rubric.v1";

interface GradingContext {
    nodeTitle: string;
    nodeDescription: string;
    skills: string[];
    userReport: string;
    artifactUrl?: string;
}

export function buildPrompt(
    locale: Locale,
    ctx: GradingContext
): LLMMessage[] {
    const lang = locale === "ru" ? "Russian" : "English";

    return [
        {
            role: "system",
            content: [
                `You are a fair and constructive learning assessor.`,
                `Evaluate the student's submission against the task requirements.`,
                `Respond in ${lang}.`,
                ``,
                `Respond ONLY with valid JSON:`,
                `{`,
                `  "score": <0.0-1.0>,`,
                `  "passed": <boolean>,`,
                `  "feedback": "<constructive feedback string>",`,
                `  "strengths": ["<string>", ...],`,
                `  "improvements": ["<string>", ...],`,
                `  "rationale": "<why this score>"`,
                `}`,
                `Pass threshold: score >= 0.7`,
            ].join("\n"),
        },
        {
            role: "user",
            content: [
                `Task: "${ctx.nodeTitle}"`,
                `Description: ${ctx.nodeDescription}`,
                `Required skills: ${ctx.skills.join(", ")}`,
                ``,
                `Student's report:`,
                ctx.userReport,
                ctx.artifactUrl ? `\nArtifact URL: ${ctx.artifactUrl}` : "",
            ].join("\n"),
        },
    ];
}
