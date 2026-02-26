// ============================================================
// GET /api/admin/overview
// Admin-only: aggregate stats (users, goals, roadmaps, events).
// ============================================================

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-admin";
import { AuthError } from "@/lib/auth";

export async function GET() {
    try {
        const { supabase } = await requireAdmin();

        // Run aggregate queries in parallel
        const [usersRes, goalsRes, roadmapsRes, eventsRes, aiLogsRes] = await Promise.all([
            supabase.from("profiles").select("id", { count: "exact", head: true }),
            supabase.from("goals").select("id", { count: "exact", head: true }),
            supabase.from("roadmaps").select("id", { count: "exact", head: true }),
            supabase.from("events").select("id", { count: "exact", head: true }),
            supabase.from("ai_logs").select("id", { count: "exact", head: true }),
        ]);

        // Recent events (last 24h) by type
        const dayAgo = new Date(Date.now() - 86400000).toISOString();
        const { data: recentEvents } = await supabase
            .from("events")
            .select("event_type")
            .gte("created_at", dayAgo);

        const eventCounts: Record<string, number> = {};
        for (const e of recentEvents ?? []) {
            eventCounts[e.event_type] = (eventCounts[e.event_type] ?? 0) + 1;
        }

        return NextResponse.json({
            totals: {
                users: usersRes.count ?? 0,
                goals: goalsRes.count ?? 0,
                roadmaps: roadmapsRes.count ?? 0,
                events: eventsRes.count ?? 0,
                aiLogs: aiLogsRes.count ?? 0,
            },
            recentEvents24h: eventCounts,
        });
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json({ error: err.message }, { status: err.status });
        }
        console.error("[admin/overview] error:", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
