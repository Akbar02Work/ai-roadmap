// ============================================================
// POST /api/progress/log
// Logs daily practice minutes via log_practice_v1 RPC.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { requireAuth, AuthError } from "@/lib/auth";
import { safeErrorResponse, safeAuthErrorResponse } from "@/lib/api/safe-error";

const RequestBodySchema = z.object({
    goalId: z.string().uuid(),
    minutes: z.number().int().min(1).max(240),
});

interface SupabaseRpcErrorLike {
    code?: string | null;
    message?: string | null;
    details?: string | null;
}

function isMissingRpc(error: SupabaseRpcErrorLike): boolean {
    if (error.code === "42883") return true;
    const msg = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
    return msg.includes("log_practice_v1") && msg.includes("does not exist");
}

export async function POST(request: NextRequest) {
    try {
        const { supabase } = await requireAuth();

        const raw = await request.json();
        const body = RequestBodySchema.parse(raw);

        const { data, error: rpcError } = await supabase.rpc(
            "log_practice_v1",
            {
                p_goal_id: body.goalId,
                p_minutes_delta: body.minutes,
                p_source: "manual",
            }
        );

        if (rpcError) {
            if (isMissingRpc(rpcError)) {
                return safeErrorResponse(
                    503,
                    "MIGRATION_MISSING",
                    "Progress migration not applied (0008_daily_progress.sql)."
                );
            }
            if (rpcError.code === "42501") {
                return safeErrorResponse(404, "NOT_FOUND", "Goal not found");
            }
            console.error("[progress/log] rpc error:", rpcError);
            return safeErrorResponse(503, "SERVICE_UNAVAILABLE", "Failed to log progress");
        }

        const row = Array.isArray(data) ? data[0] : data;
        return NextResponse.json({
            todayMinutes: row?.today_minutes ?? 0,
            weekMinutes: Number(row?.week_minutes ?? 0),
            streakCurrent: row?.streak_current ?? 0,
            streakBest: row?.streak_best ?? 0,
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
        console.error("[progress/log] unexpected:", err);
        return safeErrorResponse(500, "INTERNAL_ERROR", "Internal server error");
    }
}
