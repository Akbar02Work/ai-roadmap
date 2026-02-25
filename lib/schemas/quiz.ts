// ============================================================
// Zod schema for quiz generation output
// Used by callLLM() to validate structured LLM responses.
// ============================================================

import { z } from "zod/v4";

export const QuizQuestionSchema = z.object({
    prompt: z.string(),
    options: z.array(z.string()).length(4),
    correctIndex: z.number().int().min(0).max(3),
    explanation: z.string(),
});

export const QuizOutputSchema = z.object({
    questions: z.array(QuizQuestionSchema).min(3).max(6),
});

export type QuizOutput = z.infer<typeof QuizOutputSchema>;
export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;
