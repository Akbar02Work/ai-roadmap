// ============================================================
// GET /api/onboarding/session?sessionId=...
// Returns session details + chat messages.
// Ownership is enforced by Supabase RLS (goal.user_id = auth.uid()).
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";
import { safeErrorResponse, safeAuthErrorResponse } from "@/lib/api/safe-error";

export async function GET(request: NextRequest) {
    try {
        const { supabase } = await requireAuth();

        const sessionId = request.nextUrl.searchParams.get("sessionId");
        if (!sessionId) {
            return safeErrorResponse(400, "VALIDATION_ERROR", "sessionId is required");
        }

        // Fetch session (RLS ensures user owns the goal)
        const { data: session, error: sessionError } = await supabase
            .from("onboarding_sessions")
            .select("id, goal_id, status, created_at")
            .eq("id", sessionId)
            .single();

        if (sessionError || !session) {
            return safeErrorResponse(404, "NOT_FOUND", "Session not found");
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
            return safeErrorResponse(
                500,
                "INTERNAL_ERROR",
                "Failed to fetch messages"
            );
        }

        return NextResponse.json({ session, messages: messages ?? [] });
    } catch (err) {
        if (err instanceof AuthError) {
            return safeAuthErrorResponse(err);
        }
        console.error("[onboarding/session] unexpected error:", err);
        return safeErrorResponse(500, "INTERNAL_ERROR", "Internal server error");
    }
}
