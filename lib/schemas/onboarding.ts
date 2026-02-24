// ============================================================
// Zod schemas for onboarding chat & diagnostics
// ============================================================

import { z } from "zod/v4";

// --- Onboarding Chat structured output ---

export const OnboardingCollectedSchema = z.object({
    language: z.string().nullable(),
    targetLevel: z
        .enum(["A1", "A2", "B1", "B2", "C1", "C2"])
        .nullable(),
    minutesPerDay: z.number().int().min(1).nullable(),
    daysPerWeek: z.number().int().min(1).max(7).nullable(),
    deadline: z.string().nullable(),
    motivation: z.string().nullable(),
});

export const OnboardingChatOutputSchema = z.object({
    assistantMessage: z.string(),
    collected: OnboardingCollectedSchema,
    nextAction: z.enum(["ask_more", "start_diagnostic"]),
});

export type OnboardingChatOutput = z.infer<typeof OnboardingChatOutputSchema>;
export type OnboardingCollected = z.infer<typeof OnboardingCollectedSchema>;

// --- CEFR Diagnostic: question generation ---

export const DiagnoseQuestionSchema = z.object({
    question: z.string(),
    type: z.enum(["multiple_choice", "translation", "fill_blank"]),
    options: z.array(z.string()).nullable(),
    cefrTarget: z.enum(["A1", "A2", "B1", "B2", "C1"]),
});

export const DiagnoseQuestionsOutputSchema = z.object({
    language: z.string(),
    questions: z.array(DiagnoseQuestionSchema).min(3).max(10),
    instructions: z.string(),
});

export type DiagnoseQuestionsOutput = z.infer<
    typeof DiagnoseQuestionsOutputSchema
>;

// --- CEFR Diagnostic: scoring result ---

export const DiagnoseResultSchema = z.object({
    cefrLevel: z.enum(["A0", "A1", "A2", "B1", "B2", "C1", "C2"]),
    explanation: z.string(),
});

export type DiagnoseResult = z.infer<typeof DiagnoseResultSchema>;
