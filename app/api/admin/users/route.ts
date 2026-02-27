// ============================================================
// GET /api/admin/users?limit=20&offset=0
// Admin-only: list users (profiles) with basic info.
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

        const { data, error } = await supabase.rpc("rpc_admin_users", {
            p_page: page,
            p_limit: limit,
        });

        if (error) {
            if (error.code === "42501") {
                return safeErrorResponse(403, "FORBIDDEN", "Admin access denied");
            }
            console.error("[admin/users] query error:", error);
            return safeErrorResponse(503, "SERVICE_UNAVAILABLE", "Failed to fetch users");
        }

        const payload =
            data && typeof data === "object" && !Array.isArray(data)
                ? (data as Record<string, unknown>)
                : {};

        return NextResponse.json({
            users: Array.isArray(payload.users) ? payload.users : [],
            total: toNumber(payload.total, 0),
            limit: toNumber(payload.limit, limit),
            page: toNumber(payload.page, page),
            offset: toNumber(payload.offset, offset),
        });
    } catch (err) {
        if (err instanceof AuthError) {
            return safeAuthErrorResponse(err);
        }
        console.error("[admin/users] error:", err);
        return safeErrorResponse(500, "INTERNAL_ERROR", "Internal server error");
    }
}
