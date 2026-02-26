// ============================================================
// GET /api/admin/events?limit=20&offset=0&event_type=...
// Admin-only: list events.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-admin";
import { AuthError } from "@/lib/auth";

export async function GET(request: NextRequest) {
    try {
        const { supabase } = await requireAdmin();

        const { searchParams } = new URL(request.url);
        const limit = Math.min(parseInt(searchParams.get("limit") ?? "20"), 100);
        const offset = parseInt(searchParams.get("offset") ?? "0");
        const eventType = searchParams.get("event_type");

        let query = supabase
            .from("events")
            .select("id, user_id, event_type, payload, created_at", { count: "exact" })
            .order("created_at", { ascending: false })
            .range(offset, offset + limit - 1);

        if (eventType) {
            query = query.eq("event_type", eventType);
        }

        const { data, error, count } = await query;

        if (error) {
            console.error("[admin/events] query error:", error);
            return NextResponse.json({ error: "Failed to fetch events" }, { status: 503 });
        }

        return NextResponse.json({
            events: data ?? [],
            total: count ?? 0,
            limit,
            offset,
        });
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json({ error: err.message }, { status: err.status });
        }
        console.error("[admin/events] error:", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
