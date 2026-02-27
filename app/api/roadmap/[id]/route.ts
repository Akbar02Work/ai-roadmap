// ============================================================
// GET /api/roadmap/[id]
// Returns roadmap + nodes (ordered by sort_order).
// Access enforced by RLS (roadmap → goal → user_id).
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";
import { safeErrorResponse, safeAuthErrorResponse } from "@/lib/api/safe-error";

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { supabase } = await requireAuth();
        const { id } = await params;

        // Fetch roadmap (RLS ensures ownership through goal chain)
        const { data: roadmap, error: roadmapError } = await supabase
            .from("roadmaps")
            .select("id, goal_id, version, status, generated_by, roadmap_meta, regeneration_reason, created_at")
            .eq("id", id)
            .single();

        if (roadmapError || !roadmap) {
            return safeErrorResponse(404, "NOT_FOUND", "Roadmap not found");
        }

        // Fetch nodes ordered by sort_order
        const { data: nodes, error: nodesError } = await supabase
            .from("roadmap_nodes")
            .select("id, sort_order, title, description, node_type, est_minutes, pass_rules, skills, status, created_at")
            .eq("roadmap_id", id)
            .order("sort_order", { ascending: true });

        if (nodesError) {
            console.error("[roadmap/[id]] nodes query error:", nodesError);
            return safeErrorResponse(
                500,
                "INTERNAL_ERROR",
                "Failed to fetch roadmap nodes"
            );
        }

        return NextResponse.json({
            roadmap,
            nodes: nodes ?? [],
        });
    } catch (err) {
        if (err instanceof AuthError) {
            return safeAuthErrorResponse(err);
        }
        console.error("[roadmap/[id]] unexpected error:", err);
        return safeErrorResponse(500, "INTERNAL_ERROR", "Internal server error");
    }
}
