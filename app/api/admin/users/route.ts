// ============================================================
// GET /api/admin/users?limit=20&offset=0
// Admin-only: list users (profiles) with basic info.
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

        const { data, error, count } = await supabase
            .from("profiles")
            .select("id, email, display_name, plan, created_at", { count: "exact" })
            .order("created_at", { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) {
            console.error("[admin/users] query error:", error);
            return NextResponse.json({ error: "Failed to fetch users" }, { status: 503 });
        }

        return NextResponse.json({
            users: data ?? [],
            total: count ?? 0,
            limit,
            offset,
        });
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json({ error: err.message }, { status: err.status });
        }
        console.error("[admin/users] error:", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
