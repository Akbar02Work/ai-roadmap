// ============================================================
// GET /api/nodes/[id]
// Returns a single roadmap node. Access enforced by RLS chain.
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

        const { data: node, error: nodeError } = await supabase
            .from("roadmap_nodes")
            .select("id, roadmap_id, sort_order, title, description, node_type, content, est_minutes, pass_rules, skills, status, created_at")
            .eq("id", id)
            .single();

        if (nodeError || !node) {
            return NextResponse.json(
                { error: "Node not found" },
                { status: 404 }
            );
        }

        // Also fetch goal info for context (language, cefr_level)
        const { data: roadmap } = await supabase
            .from("roadmaps")
            .select("id, goal_id")
            .eq("id", node.roadmap_id)
            .single();

        let goalContext = null;
        if (roadmap) {
            const { data: goal } = await supabase
                .from("goals")
                .select("category, cefr_level, diagnosis")
                .eq("id", roadmap.goal_id)
                .single();
            goalContext = goal;
        }

        return NextResponse.json({ node, goalContext });
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json(
                { error: err.message },
                { status: err.status }
            );
        }
        console.error("[nodes/[id]] unexpected error:", err);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
