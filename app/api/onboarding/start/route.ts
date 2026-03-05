// ============================================================
// POST /api/onboarding/start
// Creates a goal (category='language') and onboarding session.
// Returns: { sessionId, goalId }
// ============================================================

import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";
import { safeErrorResponse, safeAuthErrorResponse } from "@/lib/api/safe-error";
import { trackEvent, generateRequestId } from "@/lib/observability/track-event";

export async function POST() {
    try {
        const { userId, supabase } = await requireAuth();
        const requestId = generateRequestId();

        // If the user already has an in-progress onboarding session, reuse it.
        // This prevents accidental creation of many duplicate goals/sessions when users revisit onboarding.
        const { data: recentGoals, error: recentGoalsError } = await supabase
            .from("goals")
            .select("id")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(25);

        if (recentGoalsError) {
            console.error("[onboarding/start] recent goals query error:", recentGoalsError);
        } else {
            const goalIds = (recentGoals ?? []).map((g: { id: string }) => g.id);
            if (goalIds.length > 0) {
                const { data: existingSession, error: existingSessionError } = await supabase
                    .from("onboarding_sessions")
                    .select("id, goal_id, status")
                    .in("goal_id", goalIds)
                    .eq("status", "in_progress")
                    .order("created_at", { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (existingSessionError) {
                    console.error("[onboarding/start] existing session query error:", existingSessionError);
                } else if (existingSession?.id && existingSession.goal_id) {
                    return NextResponse.json(
                        { sessionId: existingSession.id, goalId: existingSession.goal_id },
                        { status: 200 }
                    );
                }
            }
        }

        // 1. Create goal
        const { data: goal, error: goalError } = await supabase
            .from("goals")
            .insert({
                user_id: userId,
                title: "Language Learning",
                category: "language",
                target_description: null,
                motivation: null,
                constraints: {},
                diagnosis: {},
                status: "active",
            })
            .select("id")
            .single();

        if (goalError) {
            console.error("[onboarding/start] goal insert error:", goalError);
            return safeErrorResponse(500, "INTERNAL_ERROR", "Failed to create goal");
        }

        // 2. Create onboarding session
        const { data: session, error: sessionError } = await supabase
            .from("onboarding_sessions")
            .insert({
                goal_id: goal.id,
                status: "in_progress",
            })
            .select("id")
            .single();

        if (sessionError) {
            console.error(
                "[onboarding/start] session insert error:",
                sessionError
            );
            return safeErrorResponse(500, "INTERNAL_ERROR", "Failed to create session");
        }

        await trackEvent({
            supabase,
            userId,
            eventType: "onboarding_started",
            payload: { goalId: goal.id, sessionId: session.id },
            requestId,
        });

        return NextResponse.json(
            { sessionId: session.id, goalId: goal.id },
            { status: 201 }
        );
    } catch (err) {
        if (err instanceof AuthError) {
            return safeAuthErrorResponse(err);
        }
        console.error("[onboarding/start] unexpected error:", err);
        return safeErrorResponse(500, "INTERNAL_ERROR", "Internal server error");
    }
}
