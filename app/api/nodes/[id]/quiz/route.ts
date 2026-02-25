// ============================================================
// POST /api/nodes/[id]/quiz
// Generates a quiz for a node via LLM, saves to node.content.quiz
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";
import { callLLMStructured, LLMError } from "@/lib/llm";
import { QuizOutputSchema } from "@/lib/schemas/quiz";
import { buildPrompt, PROMPT_VERSION } from "@/lib/prompts/quiz-generation.v1";
import type { Locale } from "@/lib/llm/types";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { userId, supabase } = await requireAuth();
        const { id } = await params;

        // 1. Load node (RLS enforced)
        const { data: node, error: nodeError } = await supabase
            .from("roadmap_nodes")
            .select("id, roadmap_id, title, description, skills, content")
            .eq("id", id)
            .single();

        if (nodeError || !node) {
            return NextResponse.json(
                { error: "Node not found" },
                { status: 404 }
            );
        }

        // Check if quiz already exists
        const content = (node.content as Record<string, unknown>) ?? {};
        if (content.quiz) {
            return NextResponse.json({ quiz: content.quiz });
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
            { userId, supabase }
        );

        // 4. Save quiz to node.content.quiz
        const updatedContent = { ...content, quiz: llmResult.data };
        const { error: updateError } = await supabase
            .from("roadmap_nodes")
            .update({ content: updatedContent })
            .eq("id", id);

        if (updateError) {
            console.error("[nodes/[id]/quiz] update error:", updateError);
            // Still return the quiz even if save failed
        }

        return NextResponse.json({ quiz: llmResult.data }, { status: 201 });
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json(
                { error: err.message },
                { status: err.status }
            );
        }
        if (err instanceof LLMError) {
            const status = err.httpStatus;
            const safeMessage =
                status === 429
                    ? "Rate limit exceeded. Please try again later."
                    : status === 403
                        ? "Usage limit exceeded."
                        : "LLM provider unavailable. Please try again later.";
            return NextResponse.json({ error: safeMessage }, { status });
        }
        console.error("[nodes/[id]/quiz] unexpected error:", err);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
