// ============================================================
// POST /api/nodes/[id]/attempt
// Submit quiz answers + report, score, complete node via RPC.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { requireAuth, AuthError } from "@/lib/auth";
import { safeErrorResponse, safeAuthErrorResponse } from "@/lib/api/safe-error";
import { QuizOutputSchema } from "@/lib/schemas/quiz";

const AttemptBodySchema = z.object({
    answers: z.array(z.union([z.number().int().min(0), z.null()])),
    report: z.string().max(2000),
});
const PASS_THRESHOLD = 0.7;

const NODE_PROGRESS_MIGRATION_MISSING_REASON =
    "Node progress migration not applied (0006_node_progress_rpc.sql, 0007_node_progress_hardening.sql).";
const NODE_PROGRESS_UNAVAILABLE_REASON = "Node progress unavailable.";

interface SupabaseRpcErrorLike {
    code?: string | null;
    message?: string | null;
    details?: string | null;
    hint?: string | null;
}

function isMissingCompleteNodeRpc(error: SupabaseRpcErrorLike): boolean {
    const message =
        `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
    if (error.code === "42883") {
        return true;
    }
    return message.includes("complete_node_v1") && message.includes("does not exist");
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { userId, supabase } = await requireAuth();
        const { id: nodeId } = await params;

        const raw = await request.json();
        const body = AttemptBodySchema.parse(raw);

        // 1. Load node with quiz from content
        const { data: node, error: nodeError } = await supabase
            .from("roadmap_nodes")
            .select("id, content, status")
            .eq("id", nodeId)
            .single();

        if (nodeError || !node) {
            return NextResponse.json(
                { error: "Node not found" },
                { status: 404 }
            );
        }

        if (node.status !== "active" && node.status !== "completed") {
            return NextResponse.json(
                { error: "node_not_active" },
                { status: 400 }
            );
        }

        const content = (node.content as Record<string, unknown>) ?? {};
        const quizCandidate = content.quiz_full ?? content.quiz;
        const quizParsed = QuizOutputSchema.safeParse(quizCandidate);

        if (!quizParsed.success) {
            return NextResponse.json(
                { error: "Quiz data is invalid. Generate quiz again." },
                { status: 400 }
            );
        }

        const quiz = quizParsed.data;
        if (!quiz.questions.length) {
            return NextResponse.json(
                { error: "No quiz found. Generate one first." },
                { status: 400 }
            );
        }

        // 2. Score
        const totalQ = quiz.questions.length;
        if (body.answers.length !== totalQ) {
            return NextResponse.json(
                { error: `Expected ${totalQ} answers, got ${body.answers.length}` },
                { status: 400 }
            );
        }
        const answeredAll = body.answers.every((answer) => typeof answer === "number");
        if (!answeredAll) {
            return NextResponse.json(
                { error: "All quiz questions must be answered before submitting." },
                { status: 400 }
            );
        }

        let correct = 0;
        for (let i = 0; i < totalQ; i++) {
            const answer = body.answers[i];
            if (typeof answer !== "number") {
                return NextResponse.json(
                    { error: `Missing answer at question ${i + 1}` },
                    { status: 400 }
                );
            }
            if (answer < 0 || answer >= quiz.questions[i].options.length) {
                return NextResponse.json(
                    { error: `Answer index out of range at question ${i + 1}` },
                    { status: 400 }
                );
            }
            if (answer === quiz.questions[i].correctIndex) {
                correct++;
            }
        }
        const score = correct / totalQ;

        // 3. Determine pass/fail
        const passed = answeredAll && score >= PASS_THRESHOLD;

        // 4. If passed, complete node via RPC (fail-closed, no manual fallback).
        let nextNodeId: string | null = null;
        if (passed) {
            const { data: rpcData, error: rpcError } = await supabase.rpc(
                "complete_node_v1",
                { p_node_id: nodeId }
            );

            if (rpcError) {
                if (isMissingCompleteNodeRpc(rpcError)) {
                    return NextResponse.json(
                        { error: NODE_PROGRESS_MIGRATION_MISSING_REASON },
                        { status: 503 }
                    );
                }

                if (rpcError.code === "22023") {
                    return NextResponse.json(
                        { error: "node_not_active" },
                        { status: 400 }
                    );
                }

                console.error("[nodes/[id]/attempt] complete_node_v1 error:", rpcError);
                return NextResponse.json(
                    { error: NODE_PROGRESS_UNAVAILABLE_REASON },
                    { status: 503 }
                );
            }

            const firstRow = Array.isArray(rpcData) ? rpcData[0] : rpcData;
            nextNodeId = firstRow?.next_node_id ?? null;
        }

        // 5. Create attempt record
        const { error: attemptError } = await supabase
            .from("attempts")
            .insert({
                user_id: userId,
                node_id: nodeId,
                attempt_type: "quiz",
                score,
                passed,
                user_report: body.report || null,
                llm_feedback: {},
                llm_rubric: {},
            });

        if (attemptError) {
            console.error("[nodes/[id]/attempt] attempt insert error:", attemptError);
            return NextResponse.json(
                { error: "Failed to save attempt" },
                { status: 500 }
            );
        }

        const responseBody: {
            score: number;
            passed: boolean;
            correct: number;
            total: number;
            nextNodeId?: string | null;
        } = {
            score,
            passed,
            correct,
            total: totalQ,
        };
        if (passed) {
            responseBody.nextNodeId = nextNodeId;
        }

        return NextResponse.json(responseBody);
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
        console.error("[nodes/[id]/attempt] unexpected error:", err);
        return safeErrorResponse(500, "INTERNAL_ERROR", "Internal server error");
    }
}
