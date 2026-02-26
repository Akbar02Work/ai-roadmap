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
 * Fire-and-forget event tracking.
 * Writes a row to `events` table. Errors are logged but never thrown.
 * IMPORTANT: Do NOT include PII (chat text, quiz answers, raw prompts) in payload.
 */
export function trackEvent(opts: TrackEventOptions): void {
    const { supabase, userId, eventType, payload = {}, requestId } = opts;

    const safePayload = {
        ...payload,
        ...(requestId ? { request_id: requestId } : {}),
    };

    // Fire and forget — don't await, don't block the request
    supabase
        .from("events")
        .insert({
            user_id: userId,
            event_type: eventType,
            payload: safePayload,
        })
        .then(({ error }: { error: unknown }) => {
            if (error) {
                console.warn(`[trackEvent] ${eventType} failed:`, error);
            }
        })
        .catch((err: unknown) => {
            console.warn(`[trackEvent] ${eventType} error:`, err);
        });
}

/**
 * Generate a request ID (UUID v4) for correlating events and ai_logs.
 */
export function generateRequestId(): string {
    return crypto.randomUUID();
}
