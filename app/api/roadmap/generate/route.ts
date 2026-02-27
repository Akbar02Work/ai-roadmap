// ============================================================
// POST /api/roadmap/generate
// Generates a roadmap from goal data using LLM, persists via Supabase (RLS).
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { trackEvent, generateRequestId } from "@/lib/observability/track-event";
import { z } from "zod/v4";
import { requireAuth, AuthError } from "@/lib/auth";
import { callLLMStructured, LLMError } from "@/lib/llm";
import { safeErrorResponse, safeAuthErrorResponse } from "@/lib/api/safe-error";
import { RoadmapOutputSchema } from "@/lib/schemas/roadmap";
import {
    buildPrompt,
    PROMPT_VERSION,
} from "@/lib/prompts/roadmap-generation.v1";
import type { Locale } from "@/lib/llm/types";

const RequestBodySchema = z.object({
    goalId: z.string().uuid(),
    idempotencyKey: z.string().uuid().optional(),
    regenerationReason: z.string().optional(),
});

const USAGE_MIGRATION_MISSING_REASON =
    "Usage enforcement migration not applied (0002_usage_rpc.sql).";
const ROADMAP_MIGRATION_MISSING_REASON =
    "Roadmap generation migration not applied (0004_roadmap_atomic.sql).";
const ROADMAP_IDEMPOTENCY_MIGRATION_MISSING_REASON =
    "Roadmap idempotency migration not applied (0005_roadmap_idempotency.sql).";

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

function isMissingRoadmapIdempotencyUpgrade(
    error: SupabaseRpcErrorLike
): boolean {
    const message =
        `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`
            .toLowerCase()
            .replace(/\s+/g, "");
    return message.includes("generate_roadmap_v1(uuid,text,text,jsonb,jsonb,uuid)");
}

interface GenerateRoadmapRpcRow {
    roadmap_id?: unknown;
    deduped?: unknown;
}

function extractGenerateRoadmapResult(data: unknown): {
    roadmapId: string;
    deduped: boolean;
} | null {
    const firstRow = Array.isArray(data) ? data[0] : data;
    if (!firstRow || typeof firstRow !== "object") {
        return null;
    }

    const row = firstRow as GenerateRoadmapRpcRow;
    const roadmapId =
        typeof row.roadmap_id === "string" ? row.roadmap_id : null;
    const deduped =
        typeof row.deduped === "boolean"
            ? row.deduped
            : row.deduped === "t"
                ? true
                : row.deduped === "f"
                    ? false
                    : null;

    if (!roadmapId || deduped === null) {
        return null;
    }

    return { roadmapId, deduped };
}

export async function POST(request: NextRequest) {
    try {
        const { userId, supabase } = await requireAuth();
        const requestId = generateRequestId();

        const raw = await request.json();
        const body = RequestBodySchema.parse(raw);
        const idempotencyKey = body.idempotencyKey ?? randomUUID();

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
            { userId, supabase, requestId }
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
                p_idempotency_key: idempotencyKey,
            }
        );

        if (rpcError) {
            if (isMissingGenerateRoadmapRpc(rpcError)) {
                const migrationReason = isMissingRoadmapIdempotencyUpgrade(rpcError)
                    ? ROADMAP_IDEMPOTENCY_MIGRATION_MISSING_REASON
                    : ROADMAP_MIGRATION_MISSING_REASON;
                return NextResponse.json(
                    { error: migrationReason },
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

        const result = extractGenerateRoadmapResult(rpcData);
        if (!result) {
            console.error("[roadmap/generate] RPC returned invalid roadmap result:", rpcData);
            return NextResponse.json(
                { error: "Failed to create roadmap" },
                { status: 500 }
            );
        }

        await trackEvent({
            supabase,
            userId,
            eventType: "roadmap_generated",
            payload: {
                goalId: body.goalId,
                roadmapId: result.roadmapId,
                deduped: result.deduped,
                nodeCount: nodes.length,
            },
            requestId,
        });

        return NextResponse.json(
            {
                roadmapId: result.roadmapId,
                deduped: result.deduped,
                idempotencyKey,
            },
            { status: result.deduped ? 200 : 201 }
        );
    } catch (err) {
        if (err instanceof AuthError) {
            return safeAuthErrorResponse(err);
        }
        if (err instanceof z.ZodError) {
            return safeErrorResponse(
                400,
                "VALIDATION_ERROR",
                `Validation error: ${err.issues.map((i) => i.message).join(", ")}`
            );
        }
        if (err instanceof LLMError) {
            // Map LLM errors to safe external messages
            const status = err.httpStatus;
            if (
                status === 503 &&
                err.message.includes("0002_usage_rpc.sql")
            ) {
                return safeErrorResponse(
                    503,
                    "LLM_MIGRATION_MISSING",
                    USAGE_MIGRATION_MISSING_REASON
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

            const code =
                status === 429
                    ? "LLM_RATE_LIMIT" as const
                    : status === 403
                        ? "LLM_USAGE_LIMIT" as const
                        : "LLM_UNAVAILABLE" as const;

            return safeErrorResponse(status, code, safeMessage);
        }
        console.error("[roadmap/generate] unexpected error:", err);
        return safeErrorResponse(500, "INTERNAL_ERROR", "Internal server error");
    }
}
