// ============================================================
// POST /api/nodes/[id]/review
// Submits review result via review_node_v1 RPC.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { requireAuth, AuthError } from "@/lib/auth";
import { safeErrorResponse, safeAuthErrorResponse } from "@/lib/api/safe-error";

const RequestBodySchema = z.object({
    passed: z.boolean(),
});

interface SupabaseRpcErrorLike {
    code?: string | null;
    message?: string | null;
    details?: string | null;
}

function isMissingReviewMigration(error: SupabaseRpcErrorLike): boolean {
    if (error.code === "42883" || error.code === "42703") return true;
    const msg = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
    return (
        (msg.includes("review_node_v1") && msg.includes("does not exist")) ||
        (msg.includes("next_review_at") && msg.includes("does not exist")) ||
        (msg.includes("last_review_at") && msg.includes("does not exist")) ||
        (msg.includes("review_interval_days") && msg.includes("does not exist")) ||
        (msg.includes("review_count") && msg.includes("does not exist"))
    );
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { supabase } = await requireAuth();
        const { id: nodeId } = await params;

        const raw = await request.json();
        const body = RequestBodySchema.parse(raw);

        const { data, error: rpcError } = await supabase.rpc(
            "review_node_v1",
            {
                p_node_id: nodeId,
                p_passed: body.passed,
            }
        );

        if (rpcError) {
            if (isMissingReviewMigration(rpcError)) {
                return NextResponse.json(
                    { error: "Review migration not applied (0009_reviews_srs.sql)." },
                    { status: 503 }
                );
            }
            if (rpcError.code === "42501") {
                return NextResponse.json(
                    { error: "Node not found or access denied" },
                    { status: 404 }
                );
            }
            if (rpcError.code === "22023") {
                return NextResponse.json(
                    { error: "Only completed nodes can be reviewed" },
                    { status: 400 }
                );
            }
            console.error("[nodes/[id]/review] rpc error:", rpcError);
            return NextResponse.json(
                { error: "Review unavailable." },
                { status: 503 }
            );
        }

        const row = Array.isArray(data) ? data[0] : data;
        return NextResponse.json({
            nextReviewAt: row?.next_review_at ?? null,
            intervalDays: row?.interval_days ?? null,
            reviewCount: row?.review_count_new ?? null,
        });
    } catch (err) {
        if (err instanceof AuthError) {
            return safeAuthErrorResponse(err);
        }
        if (err instanceof z.ZodError) {
            return safeErrorResponse(
                400,
                "VALIDATION_ERROR",
                `Validation: ${err.issues.map((i) => i.message).join(", ")}`
            );
        }
        console.error("[nodes/[id]/review] unexpected:", err);
        return safeErrorResponse(500, "INTERNAL_ERROR", "Internal server error");
    }
}
