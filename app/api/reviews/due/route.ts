// ============================================================
// GET /api/reviews/due?goalId=...
// Returns due review nodes (completed, next_review_at <= now).
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";
import { safeErrorResponse, safeAuthErrorResponse } from "@/lib/api/safe-error";

export async function GET(request: NextRequest) {
    try {
        const { supabase } = await requireAuth();

        const { searchParams } = new URL(request.url);
        const goalId = searchParams.get("goalId");

        if (!goalId) {
            return safeErrorResponse(400, "VALIDATION_ERROR", "goalId is required");
        }

        // Get active roadmap for this goal (RLS enforced)
        const { data: roadmap, error: roadmapError } = await supabase
            .from("roadmaps")
            .select("id")
            .eq("goal_id", goalId)
            .eq("status", "active")
            .order("created_at", { ascending: false })
            .limit(1)
            .single();

        if (roadmapError || !roadmap) {
            return NextResponse.json({ nodes: [] });
        }

        // Query due nodes
        const { data: dueNodes, error: nodesError } = await supabase
            .from("roadmap_nodes")
            .select("id, sort_order, title, description, node_type, skills, est_minutes, next_review_at, review_count, review_interval_days")
            .eq("roadmap_id", roadmap.id)
            .eq("status", "completed")
            .not("next_review_at", "is", null)
            .lte("next_review_at", new Date().toISOString())
            .order("next_review_at", { ascending: true })
            .order("sort_order", { ascending: true })
            .order("id", { ascending: true })
            .limit(10);

        if (nodesError) {
            // Check if review columns don't exist yet
            const msg = `${nodesError.message ?? ""} ${nodesError.details ?? ""}`.toLowerCase();
            if (msg.includes("next_review_at") || nodesError.code === "42703") {
                return safeErrorResponse(
                    503,
                    "MIGRATION_MISSING",
                    "Review migration not applied (0009_reviews_srs.sql)."
                );
            }
            console.error("[reviews/due] query error:", nodesError);
            return safeErrorResponse(503, "SERVICE_UNAVAILABLE", "Failed to fetch reviews");
        }

        return NextResponse.json({ nodes: dueNodes ?? [] });
    } catch (err) {
        if (err instanceof AuthError) {
            return safeAuthErrorResponse(err);
        }
        console.error("[reviews/due] unexpected:", err);
        return safeErrorResponse(500, "INTERNAL_ERROR", "Internal server error");
    }
}
