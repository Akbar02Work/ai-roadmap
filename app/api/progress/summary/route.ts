// ============================================================
// GET /api/progress/summary?goalId=...
// Returns streak summary + last 7 days series.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";
import { safeErrorResponse, safeAuthErrorResponse } from "@/lib/api/safe-error";

export async function GET(request: NextRequest) {
    try {
        const { userId, supabase } = await requireAuth();

        const { searchParams } = new URL(request.url);
        const goalId = searchParams.get("goalId");

        if (!goalId) {
            return NextResponse.json({ error: "goalId is required" }, { status: 400 });
        }

        // Verify goal ownership (RLS handles this, but explicit for clarity)
        const { data: goal, error: goalError } = await supabase
            .from("goals")
            .select("id")
            .eq("id", goalId)
            .eq("user_id", userId)
            .single();

        if (goalError || !goal) {
            return NextResponse.json({ error: "Goal not found" }, { status: 404 });
        }

        // Get last 7 days of progress
        const today = new Date();
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 6);

        const { data: series, error: seriesError } = await supabase
            .from("daily_progress")
            .select("day, minutes, nodes_completed")
            .eq("goal_id", goalId)
            .gte("day", weekAgo.toISOString().split("T")[0])
            .order("day", { ascending: true });

        if (seriesError) {
            // Table might not exist (migration not applied)
            if (seriesError.code === "42P01") {
                return NextResponse.json(
                    { error: "Progress migration not applied (0008_daily_progress.sql)." },
                    { status: 503 }
                );
            }
            console.error("[progress/summary] series error:", seriesError);
            return NextResponse.json({ error: "Failed to fetch progress" }, { status: 503 });
        }

        // Build 7-day series (fill gaps with 0)
        const seriesMap = new Map<string, { minutes: number; nodesCompleted: number }>();
        for (const row of series ?? []) {
            seriesMap.set(row.day, {
                minutes: row.minutes,
                nodesCompleted: row.nodes_completed,
            });
        }

        const days: Array<{ day: string; minutes: number; nodesCompleted: number }> = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const dayStr = d.toISOString().split("T")[0];
            const entry = seriesMap.get(dayStr);
            days.push({
                day: dayStr,
                minutes: entry?.minutes ?? 0,
                nodesCompleted: entry?.nodesCompleted ?? 0,
            });
        }

        // Calculate streak
        const MIN_DAILY = 10;
        let streakCurrent = 0;
        let streakBest = 0;
        let curStreak = 0;

        for (const d of days) {
            if (d.minutes >= MIN_DAILY || d.nodesCompleted > 0) {
                curStreak++;
                if (curStreak > streakBest) streakBest = curStreak;
            } else {
                curStreak = 0;
            }
        }

        // Current streak: count backwards from today
        for (let i = days.length - 1; i >= 0; i--) {
            if (days[i].minutes >= MIN_DAILY || days[i].nodesCompleted > 0) {
                streakCurrent++;
            } else {
                break;
            }
        }

        const todayEntry = days[days.length - 1];
        const weekMinutes = days.reduce((s, d) => s + d.minutes, 0);

        return NextResponse.json({
            todayMinutes: todayEntry.minutes,
            weekMinutes,
            streakCurrent,
            streakBest,
            series: days,
        });
    } catch (err) {
        if (err instanceof AuthError) {
            return safeAuthErrorResponse(err);
        }
        console.error("[progress/summary] unexpected:", err);
        return safeErrorResponse(500, "INTERNAL_ERROR", "Internal server error");
    }
}
