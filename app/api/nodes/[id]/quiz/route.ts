// ============================================================
// POST /api/nodes/[id]/quiz
// Generates a quiz for a node via LLM, saves to node.content.quiz
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";
import { callLLMStructured, LLMError } from "@/lib/llm";
import { safeErrorResponse, safeAuthErrorResponse } from "@/lib/api/safe-error";
import { generateRequestId } from "@/lib/observability/track-event";
import {
    QuizOutputSchema,
    QuizPublicOutputSchema,
    toQuizPublic,
} from "@/lib/schemas/quiz";
import { buildPrompt, PROMPT_VERSION } from "@/lib/prompts/quiz-generation.v1";
import type { Locale } from "@/lib/llm/types";

const USAGE_MIGRATION_MISSING_REASON =
    "Usage enforcement migration not applied (0002_usage_rpc.sql).";

function extractQuizFull(
    content: Record<string, unknown>
): ReturnType<typeof QuizOutputSchema.parse> | null {
    const candidate = content.quiz_full ?? content.quiz;
    const parsed = QuizOutputSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
}

function extractQuizPublic(content: Record<string, unknown>) {
    const publicCandidate = content.quiz_public ?? content.quiz;
    const publicParsed = QuizPublicOutputSchema.safeParse(publicCandidate);
    if (publicParsed.success) {
        return publicParsed.data;
    }
    const full = extractQuizFull(content);
    return full ? toQuizPublic(full) : null;
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { userId, supabase } = await requireAuth();
        const requestId = generateRequestId();
        const { id } = await params;

        // 1. Load node (RLS enforced)
        const { data: node, error: nodeError } = await supabase
            .from("roadmap_nodes")
            .select("id, roadmap_id, title, description, skills, content")
            .eq("id", id)
            .single();

        if (nodeError || !node) {
            return safeErrorResponse(404, "NOT_FOUND", "Node not found");
        }

        // Check if quiz already exists
        const content = (node.content as Record<string, unknown>) ?? {};
        const existingQuizFull = extractQuizFull(content);
        if (existingQuizFull) {
            return NextResponse.json({
                quiz: extractQuizPublic(content) ?? toQuizPublic(existingQuizFull),
            });
        }

        // 2. Get goal context via roadmap chain
        const { data: roadmap } = await supabase
            .from("roadmaps")
            .select("goal_id")
            .eq("id", node.roadmap_id)
            .single();

        let cefrLevel = "unknown";
        let language = "General";

        if (roadmap) {
            const { data: goal } = await supabase
                .from("goals")
                .select("category, cefr_level, diagnosis")
                .eq("id", roadmap.goal_id)
                .single();

            if (goal) {
                cefrLevel = (goal.cefr_level as string) ?? "unknown";
                const diagnosis = (goal.diagnosis as Record<string, unknown>) ?? {};
                language = (diagnosis.language as string) ?? goal.category ?? "General";
            }
        }

        // Detect locale
        const acceptLang = request.headers.get("accept-language") ?? "";
        const locale: Locale = acceptLang.includes("ru") ? "ru" : "en";

        // 3. Generate quiz via LLM
        const messages = buildPrompt(locale, {
            nodeTitle: node.title,
            nodeDescription: node.description ?? "",
            skills: (node.skills as string[]) ?? [],
            cefrLevel,
            language,
        });

        const llmResult = await callLLMStructured(
            {
                task: "quiz_generation",
                locale,
                userId,
                promptVersion: PROMPT_VERSION,
                messages,
            },
            QuizOutputSchema,
            { userId, supabase, requestId }
        );

        // 4. Save full quiz on server; return only sanitized public quiz.
        const quizPublic = toQuizPublic(llmResult.data);
        const updatedContent = {
            ...content,
            quiz_full: llmResult.data,
            quiz_public: quizPublic,
        } as Record<string, unknown>;
        delete updatedContent.quiz;

        const { error: updateError } = await supabase
            .from("roadmap_nodes")
            .update({ content: updatedContent })
            .eq("id", id);

        if (updateError) {
            console.error("[nodes/[id]/quiz] update error:", updateError);
            // Still return the quiz even if save failed
        }

        return NextResponse.json({ quiz: quizPublic }, { status: 201 });
    } catch (err) {
        if (err instanceof AuthError) {
            return safeAuthErrorResponse(err);
        }
        if (err instanceof LLMError) {
            const status = err.httpStatus;
            const safeMessage =
                status === 429
                    ? "Rate limit exceeded. Please try again later."
                    : status === 403
                        ? "Usage limit exceeded."
                        : status === 503 &&
                            err.message.includes("0002_usage_rpc.sql")
                            ? USAGE_MIGRATION_MISSING_REASON
                            : "LLM provider unavailable. Please try again later.";
            const code =
                status === 429
                    ? "LLM_RATE_LIMIT" as const
                    : status === 403
                        ? "LLM_USAGE_LIMIT" as const
                        : status === 503 && err.message.includes("0002_usage_rpc.sql")
                            ? "LLM_MIGRATION_MISSING" as const
                            : "LLM_UNAVAILABLE" as const;
            return safeErrorResponse(status, code, safeMessage);
        }
        console.error("[nodes/[id]/quiz] unexpected error:", err);
        return safeErrorResponse(500, "INTERNAL_ERROR", "Internal server error");
    }
}
