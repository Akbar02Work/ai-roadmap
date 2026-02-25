// ============================================================
// Zod schemas for roadmap generation LLM output
// ============================================================

import { z } from "zod/v4";

export const RoadmapNodeOutputSchema = z.object({
    title: z.string(),
    description: z.string(),
    nodeType: z.enum(["lesson", "practice", "review", "quiz"]),
    estMinutes: z.number().int().min(5).max(120),
    skills: z.array(z.string()),
    passRules: z.object({
        minScore: z.number().min(0).max(1),
        requireReport: z.boolean(),
    }),
});

export const RoadmapOutputSchema = z.object({
    roadmapTitle: z.string(),
    summary: z.string(),
    nodes: z.array(RoadmapNodeOutputSchema).min(5).max(20),
});

export type RoadmapOutput = z.infer<typeof RoadmapOutputSchema>;
export type RoadmapNodeOutput = z.infer<typeof RoadmapNodeOutputSchema>;
