// ============================================================
// Zod schemas for other structured outputs
// ============================================================

import { z } from "zod/v4";

// --- Level Assessment -----------------------------------------

export const LevelAssessmentQuestionSchema = z.object({
    question: z.string(),
    type: z.enum(["multiple_choice", "translation", "fill_blank"]),
    options: z.array(z.string()).nullable(),
    cefrTarget: z.enum(["A1", "A2", "B1", "B2", "C1"]),
});

export const LevelAssessmentOutputSchema = z.object({
    language: z.string(),
    questions: z.array(LevelAssessmentQuestionSchema).min(1),
    instructions: z.string(),
});

export type LevelAssessmentOutput = z.infer<typeof LevelAssessmentOutputSchema>;

// --- Roadmap Generation ---------------------------------------

export const RoadmapNodeSchema = z.object({
    sortOrder: z.number().int(),
    title: z.string(),
    description: z.string(),
    nodeType: z.enum(["lesson", "quiz", "practice", "review"]),
    estMinutes: z.number().int().min(1),
    skills: z.array(z.string()),
});

export const RoadmapOutputSchema = z.object({
    title: z.string(),
    estimatedWeeks: z.number(),
    nodes: z.array(RoadmapNodeSchema).min(1),
});

export type RoadmapOutput = z.infer<typeof RoadmapOutputSchema>;

// --- Grading Rubric -------------------------------------------

export const GradingOutputSchema = z.object({
    score: z.number().min(0).max(1),
    passed: z.boolean(),
    feedback: z.string(),
    strengths: z.array(z.string()),
    improvements: z.array(z.string()),
    rationale: z.string(),
});

export type GradingOutput = z.infer<typeof GradingOutputSchema>;
