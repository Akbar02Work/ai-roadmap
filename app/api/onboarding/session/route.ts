// ============================================================
// GET /api/onboarding/session?sessionId=...
// Returns session details + chat messages.
// Ownership is enforced by Supabase RLS (goal.user_id = auth.uid()).
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";

export async function GET(request: NextRequest) {
    try {
        const { supabase } = await requireAuth();

        const sessionId = request.nextUrl.searchParams.get("sessionId");
        if (!sessionId) {
            return NextResponse.json(
                { error: "sessionId is required" },
                { status: 400 }
            );
        }

        // Fetch session (RLS ensures user owns the goal)
        const { data: session, error: sessionError } = await supabase
            .from("onboarding_sessions")
            .select("id, goal_id, status, created_at")
            .eq("id", sessionId)
            .single();

        if (sessionError || !session) {
            return NextResponse.json(
                { error: "Session not found" },
                { status: 404 }
            );
        }

        // Fetch messages ordered by creation time
        const { data: messages, error: messagesError } = await supabase
            .from("chat_messages")
            .select("id, role, content, metadata, created_at")
            .eq("session_id", sessionId)
            .order("created_at", { ascending: true });

        if (messagesError) {
            console.error(
                "[onboarding/session] messages query error:",
                messagesError
            );
            return NextResponse.json(
                { error: "Failed to fetch messages" },
                { status: 500 }
            );
        }

        return NextResponse.json({ session, messages: messages ?? [] });
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json(
                { error: err.message },
                { status: err.status }
            );
        }
        console.error("[onboarding/session] unexpected error:", err);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
