// ============================================================
// POST /api/roadmap/generate
// Generates a roadmap from goal data using LLM, persists via Supabase (RLS).
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { requireAuth, AuthError } from "@/lib/auth";
import { callLLMStructured, LLMError } from "@/lib/llm";
import { RoadmapOutputSchema } from "@/lib/schemas/roadmap";
import {
    buildPrompt,
    PROMPT_VERSION,
} from "@/lib/prompts/roadmap-generation.v1";
import type { Locale } from "@/lib/llm/types";

const RequestBodySchema = z.object({
    goalId: z.string().uuid(),
    regenerationReason: z.string().optional(),
});

export async function POST(request: NextRequest) {
    try {
        const { userId, supabase } = await requireAuth();

        const raw = await request.json();
        const body = RequestBodySchema.parse(raw);

        // 1. Load goal (RLS ensures ownership)
        const { data: goal, error: goalError } = await supabase
            .from("goals")
            .select("id, title, category, target_description, motivation, constraints, diagnosis, cefr_level, status")
            .eq("id", body.goalId)
            .single();

        if (goalError || !goal) {
            return NextResponse.json(
                { error: "Goal not found" },
                { status: 404 }
            );
        }

        // Extract context from goal diagnosis
        const diagnosis = (goal.diagnosis as Record<string, unknown>) ?? {};
        const constraints = (goal.constraints as Record<string, unknown>) ?? {};

        const language = (diagnosis.language as string) ?? goal.category ?? "General";
        const currentLevel = (goal.cefr_level as string) ?? (diagnosis.cefrLevel as string) ?? "unknown";
        const targetLevel = (diagnosis.targetLevel as string) ?? undefined;
        const motivation = (goal.motivation as string) ?? (diagnosis.motivation as string) ?? "personal growth";
        const minutesPerDay = (diagnosis.minutesPerDay as number) ?? (constraints.minutesPerDay as number) ?? 30;
        const daysPerWeek = (diagnosis.daysPerWeek as number) ?? (constraints.daysPerWeek as number) ?? 5;
        const deadline = (diagnosis.deadline as string) ?? undefined;

        // Detect locale
        const acceptLang = request.headers.get("accept-language") ?? "";
        const locale: Locale = acceptLang.includes("ru") ? "ru" : "en";

        // 2. Build prompt and call LLM
        const messages = buildPrompt(locale, {
            category: goal.category,
            target: goal.target_description ?? `Learn ${language}`,
            currentLevel,
            targetLevel,
            motivation,
            minutesPerDay,
            daysPerWeek,
            deadline,
        });

        const llmResult = await callLLMStructured(
            {
                task: "roadmap_generation",
                locale,
                userId,
                promptVersion: PROMPT_VERSION,
                messages,
            },
            RoadmapOutputSchema,
            { userId, supabase }
        );

        const { roadmapTitle, summary, nodes } = llmResult.data;

        // 3. Determine next version
        const { data: existingRoadmaps } = await supabase
            .from("roadmaps")
            .select("id, version, status")
            .eq("goal_id", body.goalId)
            .order("version", { ascending: false })
            .limit(1);

        const nextVersion = existingRoadmaps?.length
            ? (existingRoadmaps[0].version as number) + 1
            : 1;

        // 4. Supersede previous active roadmap
        if (existingRoadmaps?.length && existingRoadmaps[0].status === "active") {
            await supabase
                .from("roadmaps")
                .update({ status: "superseded" })
                .eq("id", existingRoadmaps[0].id);
        }

        // 5. Insert new roadmap
        const { data: roadmap, error: roadmapError } = await supabase
            .from("roadmaps")
            .insert({
                goal_id: body.goalId,
                version: nextVersion,
                status: "active",
                generated_by: llmResult.meta.model,
                regeneration_reason: body.regenerationReason ?? null,
                roadmap_meta: {
                    nodeCount: nodes.length,
                    roadmapTitle,
                    summary,
                    promptVersion: PROMPT_VERSION,
                },
            })
            .select("id")
            .single();

        if (roadmapError || !roadmap) {
            console.error("[roadmap/generate] roadmap insert error:", roadmapError);
            return NextResponse.json(
                { error: "Failed to create roadmap" },
                { status: 500 }
            );
        }

        // 6. Insert roadmap nodes
        const nodeRows = nodes.map((node, index) => ({
            roadmap_id: roadmap.id,
            sort_order: index + 1,
            title: node.title,
            description: node.description,
            node_type: node.nodeType,
            est_minutes: node.estMinutes,
            skills: node.skills,
            pass_rules: node.passRules,
            content: {},
            prerequisites: [],
            status: index === 0 ? "active" : "locked",
        }));

        const { error: nodesError } = await supabase
            .from("roadmap_nodes")
            .insert(nodeRows);

        if (nodesError) {
            console.error("[roadmap/generate] nodes insert error:", nodesError);
            // Clean up the roadmap if nodes failed
            await supabase.from("roadmaps").delete().eq("id", roadmap.id);
            return NextResponse.json(
                { error: "Failed to create roadmap nodes" },
                { status: 500 }
            );
        }

        return NextResponse.json(
            { roadmapId: roadmap.id },
            { status: 201 }
        );
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json(
                { error: err.message },
                { status: err.status }
            );
        }
        if (err instanceof z.ZodError) {
            return NextResponse.json(
                { error: `Validation error: ${err.issues.map((i) => i.message).join(", ")}` },
                { status: 400 }
            );
        }
        if (err instanceof LLMError) {
            // Map LLM errors to safe external messages
            const status = err.httpStatus;
            const safeMessage =
                status === 429
                    ? "Rate limit exceeded. Please try again later."
                    : status === 403
                        ? "Usage limit exceeded."
                        : "LLM provider unavailable. Please try again later.";
            return NextResponse.json(
                { error: safeMessage },
                { status }
            );
        }
        console.error("[roadmap/generate] unexpected error:", err);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
