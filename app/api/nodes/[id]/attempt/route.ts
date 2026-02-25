// ============================================================
// POST /api/nodes/[id]/attempt
// Submit quiz answers + report, score, complete node via RPC.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { requireAuth, AuthError } from "@/lib/auth";

const AttemptBodySchema = z.object({
    answers: z.array(z.number().int().min(0).max(3)),
    report: z.string().max(2000),
});

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
            .select("id, content, pass_rules, status")
            .eq("id", nodeId)
            .single();

        if (nodeError || !node) {
            return NextResponse.json(
                { error: "Node not found" },
                { status: 404 }
            );
        }

        const content = (node.content as Record<string, unknown>) ?? {};
        const quiz = content.quiz as { questions: Array<{ correctIndex: number }> } | undefined;

        if (!quiz || !quiz.questions?.length) {
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

        let correct = 0;
        for (let i = 0; i < totalQ; i++) {
            if (body.answers[i] === quiz.questions[i].correctIndex) {
                correct++;
            }
        }
        const score = correct / totalQ;

        // 3. Determine pass/fail
        const passRules = (node.pass_rules as Record<string, unknown>) ?? {};
        const minScore = typeof passRules.minScore === "number" ? passRules.minScore : 0.7;
        const passed = score >= minScore;

        // 4. Create attempt record
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

        // 5. If passed, complete node via RPC
        let nextNodeId: string | null = null;
        if (passed) {
            const { data: rpcData, error: rpcError } = await supabase.rpc(
                "complete_node_v1",
                { p_node_id: nodeId }
            );

            if (rpcError) {
                // If RPC not found (migration not applied), fall back to manual update
                if (rpcError.code === "42883") {
                    console.warn("[nodes/[id]/attempt] complete_node_v1 not found, using manual update");
                    await supabase
                        .from("roadmap_nodes")
                        .update({ status: "completed" })
                        .eq("id", nodeId);
                } else {
                    console.error("[nodes/[id]/attempt] complete_node_v1 error:", rpcError);
                }
            } else {
                const firstRow = Array.isArray(rpcData) ? rpcData[0] : rpcData;
                nextNodeId = firstRow?.next_node_id ?? null;
            }
        }

        return NextResponse.json({
            score,
            passed,
            correct,
            total: totalQ,
            nextNodeId,
        });
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
        console.error("[nodes/[id]/attempt] unexpected error:", err);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
