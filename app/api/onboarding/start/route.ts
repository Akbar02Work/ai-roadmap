// ============================================================
// POST /api/onboarding/start
// Creates a goal (category='language') and onboarding session.
// Returns: { sessionId, goalId }
// ============================================================

import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";
import { trackEvent, generateRequestId } from "@/lib/observability/track-event";

export async function POST() {
    try {
        const { userId, supabase } = await requireAuth();
        const requestId = generateRequestId();

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
            return NextResponse.json(
                { error: "Failed to create goal" },
                { status: 500 }
            );
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
            return NextResponse.json(
                { error: "Failed to create session" },
                { status: 500 }
            );
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
            return NextResponse.json(
                { error: err.message },
                { status: err.status }
            );
        }
        console.error("[onboarding/start] unexpected error:", err);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
