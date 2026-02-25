// ============================================================
// GET /api/roadmap/[id]
// Returns roadmap + nodes (ordered by sort_order).
// Access enforced by RLS (roadmap → goal → user_id).
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";

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
            return NextResponse.json(
                { error: "Roadmap not found" },
                { status: 404 }
            );
        }

        // Fetch nodes ordered by sort_order
        const { data: nodes, error: nodesError } = await supabase
            .from("roadmap_nodes")
            .select("id, sort_order, title, description, node_type, est_minutes, pass_rules, skills, status, created_at")
            .eq("roadmap_id", id)
            .order("sort_order", { ascending: true });

        if (nodesError) {
            console.error("[roadmap/[id]] nodes query error:", nodesError);
            return NextResponse.json(
                { error: "Failed to fetch roadmap nodes" },
                { status: 500 }
            );
        }

        return NextResponse.json({
            roadmap,
            nodes: nodes ?? [],
        });
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json(
                { error: err.message },
                { status: err.status }
            );
        }
        console.error("[roadmap/[id]] unexpected error:", err);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
