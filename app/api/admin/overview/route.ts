// ============================================================
// GET /api/admin/overview
// Admin-only: aggregate stats (users, goals, roadmaps, events).
// ============================================================

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-admin";
import { AuthError } from "@/lib/auth";
import { safeErrorResponse, safeAuthErrorResponse } from "@/lib/api/safe-error";

export async function GET() {
    try {
        const { supabase } = await requireAdmin();

        const { data, error } = await supabase.rpc("rpc_admin_overview");

        if (error) {
            if (error.code === "42501") {
                return safeErrorResponse(403, "FORBIDDEN", "Admin access denied");
            }
            console.error("[admin/overview] query error:", error);
            return safeErrorResponse(503, "SERVICE_UNAVAILABLE", "Failed to fetch admin overview");
        }

        const payload =
            data && typeof data === "object" && !Array.isArray(data)
                ? (data as Record<string, unknown>)
                : {};
        const totals =
            payload.totals && typeof payload.totals === "object" && !Array.isArray(payload.totals)
                ? (payload.totals as Record<string, unknown>)
                : {};
        const recentEvents24h =
            payload.recentEvents24h &&
                typeof payload.recentEvents24h === "object" &&
                !Array.isArray(payload.recentEvents24h)
                ? (payload.recentEvents24h as Record<string, unknown>)
                : {};

        return NextResponse.json({
            totals,
            recentEvents24h,
        });
    } catch (err) {
        if (err instanceof AuthError) {
            return safeAuthErrorResponse(err);
        }
        console.error("[admin/overview] error:", err);
        return safeErrorResponse(500, "INTERNAL_ERROR", "Internal server error");
    }
}
