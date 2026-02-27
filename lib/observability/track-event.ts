// ============================================================
// trackEvent — server-side event tracking utility.
// Writes to the `events` table. No PII in payload.
// ============================================================

import "server-only";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

export interface TrackEventOptions {
    supabase: SupabaseClient;
    userId: string | null;
    eventType: string;
    payload?: Record<string, unknown>;
    requestId?: string;
}

/**
 * Awaited event tracking with safe error swallowing.
 * Writes a row to `events` table. Errors are logged but never thrown.
 * IMPORTANT: Do NOT include PII (chat text, quiz answers, raw prompts) in payload.
 */
export async function trackEvent(opts: TrackEventOptions): Promise<void> {
    const { supabase, userId, eventType, payload = {}, requestId } = opts;

    const safePayload = {
        ...payload,
        ...(requestId ? { request_id: requestId } : {}),
    };

    try {
        const { error } = await supabase
            .from("events")
            .insert({
                user_id: userId,
                event_type: eventType,
                payload: safePayload,
            });

        if (error) {
            console.warn(`[trackEvent] ${eventType} failed:`, error);
        }
    } catch (err: unknown) {
        console.warn(`[trackEvent] ${eventType} error:`, err);
    }
}

/**
 * Generate a request ID (UUID v4) for correlating events and ai_logs.
 */
export function generateRequestId(): string {
    return crypto.randomUUID();
}
