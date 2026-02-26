// ============================================================
// GET /api/admin/ai-logs?limit=20&offset=0&task_type=...
// Admin-only: list AI logs WITHOUT llm_raw_input.
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
        const taskType = searchParams.get("task_type");

        // IMPORTANT: Do NOT select llm_raw_input (PII/prompt data)
        let query = supabase
            .from("ai_logs")
            .select(
                "id, user_id, task_type, model, prompt_version, input_tokens, output_tokens, latency_ms, status, error_message, created_at",
                { count: "exact" }
            )
            .order("created_at", { ascending: false })
            .range(offset, offset + limit - 1);

        if (taskType) {
            query = query.eq("task_type", taskType);
        }

        const { data, error, count } = await query;

        if (error) {
            console.error("[admin/ai-logs] query error:", error);
            return NextResponse.json({ error: "Failed to fetch logs" }, { status: 503 });
        }

        return NextResponse.json({
            logs: data ?? [],
            total: count ?? 0,
            limit,
            offset,
        });
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json({ error: err.message }, { status: err.status });
        }
        console.error("[admin/ai-logs] error:", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
