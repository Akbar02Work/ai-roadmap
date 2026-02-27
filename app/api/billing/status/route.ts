// ============================================================
// GET /api/billing/status
// Returns the user's current subscription plan and period.
// Uses Supabase RLS — no service_role.
// ============================================================

import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";

export async function GET() {
    try {
        const { userId, supabase } = await requireAuth();

        const { data: sub, error } = await supabase
            .from("subscriptions")
            .select("plan, status, stripe_sub_id, current_period_start, current_period_end, created_at")
            .eq("user_id", userId)
            .eq("status", "active")
            .not("stripe_sub_id", "is", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) {
            console.error("[billing/status] DB error:", error.message);
            return NextResponse.json(
                { error: "Failed to load subscription." },
                { status: 500 }
            );
        }

        if (!sub) {
            return NextResponse.json({
                plan: "free",
                status: "active",
                currentPeriodStart: null,
                currentPeriodEnd: null,
            });
        }

        return NextResponse.json({
            plan: sub.plan,
            status: sub.status,
            currentPeriodStart: sub.current_period_start,
            currentPeriodEnd: sub.current_period_end,
        });
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json({ error: err.message }, { status: err.status });
        }
        console.error("[billing/status] Unexpected:", err);
        return NextResponse.json({ error: "Internal error." }, { status: 500 });
    }
}
