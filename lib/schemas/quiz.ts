// ============================================================
// Zod schema for quiz generation output
// Used by callLLM() to validate structured LLM responses.
// ============================================================

import { z } from "zod/v4";

export const QuizQuestionSchema = z.object({
    question: z.string(),
    options: z.array(z.string()).min(2).max(6),
    correctIndex: z.number().int().min(0),
    explanation: z.string(),
});

export const QuizOutputSchema = z.object({
    topic: z.string(),
    level: z.string(),
    questions: z.array(QuizQuestionSchema).min(1).max(20),
});

export type QuizOutput = z.infer<typeof QuizOutputSchema>;
export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;
