// ============================================================
// GET /api/dashboard
// Returns user's goals + active roadmaps for the dashboard.
// ============================================================

import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";

export async function GET() {
    try {
        const { userId, supabase } = await requireAuth();

        // Fetch goals (RLS: user_id = auth.uid())
        const { data: goals, error: goalsError } = await supabase
            .from("goals")
            .select("id, title, category, cefr_level, status, created_at")
            .eq("user_id", userId)
            .order("created_at", { ascending: false });

        if (goalsError) {
            console.error("[dashboard] goals query error:", goalsError);
            return NextResponse.json(
                { error: "Failed to fetch goals" },
                { status: 500 }
            );
        }

        // Fetch active roadmaps for these goals (RLS enforced through goal chain)
        const goalIds = (goals ?? []).map((g: { id: string }) => g.id);
        let roadmaps: unknown[] = [];

        if (goalIds.length > 0) {
            const { data: roadmapData } = await supabase
                .from("roadmaps")
                .select("id, goal_id, status, version, roadmap_meta")
                .in("goal_id", goalIds)
                .eq("status", "active");

            roadmaps = roadmapData ?? [];
        }

        return NextResponse.json({
            goals: goals ?? [],
            roadmaps,
        });
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json(
                { error: err.message },
                { status: err.status }
            );
        }
        console.error("[dashboard] unexpected error:", err);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
