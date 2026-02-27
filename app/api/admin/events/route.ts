// ============================================================
// GET /api/admin/events?limit=20&offset=0&event_type=...
// Admin-only: list events.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-admin";
import { AuthError } from "@/lib/auth";
import { safeErrorResponse, safeAuthErrorResponse } from "@/lib/api/safe-error";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parsePagination(searchParams: URLSearchParams) {
    const rawLimit = Number.parseInt(searchParams.get("limit") ?? "", 10);
    const limit = Number.isFinite(rawLimit)
        ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
        : DEFAULT_LIMIT;

    const rawOffset = Number.parseInt(searchParams.get("offset") ?? "", 10);
    if (Number.isFinite(rawOffset) && rawOffset >= 0) {
        const offset = rawOffset;
        const page = Math.floor(offset / limit) + 1;
        return { limit, page, offset };
    }

    const rawPage = Number.parseInt(searchParams.get("page") ?? "", 10);
    const page = Number.isFinite(rawPage) ? Math.max(rawPage, 1) : 1;
    const offset = (page - 1) * limit;

    return { limit, page, offset };
}

function toNumber(value: unknown, fallback: number): number {
    const parsed = typeof value === "number"
        ? value
        : typeof value === "string"
            ? Number.parseInt(value, 10)
            : Number.NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(request: NextRequest) {
    try {
        const { supabase } = await requireAdmin();

        const { searchParams } = new URL(request.url);
        const { limit, page, offset } = parsePagination(searchParams);
        const eventType = searchParams.get("event_type")?.trim() || null;

        const { data, error } = await supabase.rpc("rpc_admin_events", {
            p_event_type: eventType,
            p_page: page,
            p_limit: limit,
        });

        if (error) {
            if (error.code === "42501") {
                return NextResponse.json({ error: "Admin access denied" }, { status: 403 });
            }
            console.error("[admin/events] query error:", error);
            return NextResponse.json({ error: "Failed to fetch events" }, { status: 503 });
        }

        const payload =
            data && typeof data === "object" && !Array.isArray(data)
                ? (data as Record<string, unknown>)
                : {};

        return NextResponse.json({
            events: Array.isArray(payload.events) ? payload.events : [],
            total: toNumber(payload.total, 0),
            limit: toNumber(payload.limit, limit),
            page: toNumber(payload.page, page),
            offset: toNumber(payload.offset, offset),
        });
    } catch (err) {
        if (err instanceof AuthError) {
            return safeAuthErrorResponse(err);
        }
        console.error("[admin/events] error:", err);
        return safeErrorResponse(500, "INTERNAL_ERROR", "Internal server error");
    }
}
