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

const USAGE_MIGRATION_MISSING_REASON =
    "Usage enforcement migration not applied (0002_usage_rpc.sql).";
const ROADMAP_MIGRATION_MISSING_REASON =
    "Roadmap generation migration not applied (0004_roadmap_atomic.sql).";

interface SupabaseRpcErrorLike {
    code?: string | null;
    message?: string | null;
    details?: string | null;
    hint?: string | null;
}

function isMissingGenerateRoadmapRpc(error: SupabaseRpcErrorLike): boolean {
    const message =
        `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
    if (error.code === "42883") {
        return true;
    }
    return message.includes("generate_roadmap_v1") && message.includes("does not exist");
}

function extractRoadmapIdFromRpc(data: unknown): string | null {
    if (typeof data === "string") {
        return data;
    }

    if (Array.isArray(data) && data.length > 0) {
        const first = data[0];
        if (typeof first === "string") {
            return first;
        }
        if (first && typeof first === "object") {
            const firstValue = Object.values(first as Record<string, unknown>)[0];
            return typeof firstValue === "string" ? firstValue : null;
        }
    }

    if (data && typeof data === "object") {
        const firstValue = Object.values(data as Record<string, unknown>)[0];
        return typeof firstValue === "string" ? firstValue : null;
    }

    return null;
}

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

        // 3. Persist atomically inside DB transaction (roadmap + nodes + status transitions)
        const { data: rpcData, error: rpcError } = await supabase.rpc(
            "generate_roadmap_v1",
            {
                p_goal_id: body.goalId,
                p_regeneration_reason: body.regenerationReason ?? null,
                p_generated_by: llmResult.meta.model,
                p_roadmap_meta: {
                    nodeCount: nodes.length,
                    roadmapTitle,
                    summary,
                    promptVersion: PROMPT_VERSION,
                },
                p_nodes: nodes,
            }
        );

        if (rpcError) {
            if (isMissingGenerateRoadmapRpc(rpcError)) {
                return NextResponse.json(
                    { error: ROADMAP_MIGRATION_MISSING_REASON },
                    { status: 503 }
                );
            }

            if (rpcError.code === "23505") {
                return NextResponse.json(
                    { error: "Roadmap generation conflict. Please retry." },
                    { status: 409 }
                );
            }

            if (rpcError.code === "22023") {
                return NextResponse.json(
                    { error: "Roadmap payload is invalid." },
                    { status: 400 }
                );
            }

            if (rpcError.code === "42501") {
                return NextResponse.json(
                    { error: "Goal not found" },
                    { status: 404 }
                );
            }

            console.error("[roadmap/generate] generate_roadmap_v1 rpc error:", rpcError);
            return NextResponse.json(
                { error: "Failed to create roadmap" },
                { status: 503 }
            );
        }

        const roadmapId = extractRoadmapIdFromRpc(rpcData);
        if (!roadmapId) {
            console.error("[roadmap/generate] RPC returned invalid roadmap id:", rpcData);
            return NextResponse.json(
                { error: "Failed to create roadmap" },
                { status: 500 }
            );
        }

        return NextResponse.json(
            { roadmapId },
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
            if (
                status === 503 &&
                err.message.includes("0002_usage_rpc.sql")
            ) {
                return NextResponse.json(
                    { error: USAGE_MIGRATION_MISSING_REASON },
                    { status: 503 }
                );
            }

            const safeMessage =
                status === 429
                    ? "Rate limit exceeded. Please try again later."
                    : status === 403
                        ? "Usage limit exceeded."
                        : status === 503 && err.message === "Rate limit backend misconfigured."
                            ? "Rate limit backend misconfigured."
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
