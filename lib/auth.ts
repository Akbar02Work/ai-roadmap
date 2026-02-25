// ============================================================
// Auth helper — creates Supabase server client from cookies
// Returns userId + authenticated supabase client (RLS enforced)
// ============================================================

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { SupabaseConfigError } from "@/lib/supabase/env";

export interface AuthResult {
    userId: string;
    supabase: Awaited<ReturnType<typeof createClient>>;
}

/**
 * Require authenticated user. Returns userId and an authenticated
 * Supabase client that respects RLS policies.
 * Throws 401 if unauthenticated, 503 if auth backend is unavailable.
 */
export async function requireAuth(): Promise<AuthResult> {
    let supabase: Awaited<ReturnType<typeof createClient>>;
    try {
        supabase = await createClient();
    } catch (error) {
        if (error instanceof SupabaseConfigError) {
            throw new AuthError("Authentication service unavailable", 503);
        }
        throw error;
    }

    const {
        data: { user },
        error,
    } = await supabase.auth.getUser();

    if (error) {
        console.error("[auth] supabase.auth.getUser failed:", error.message);
        throw new AuthError("Authentication service unavailable", 503);
    }

    if (!user) {
        throw new AuthError("Authentication required", 401);
    }

    return { userId: user.id, supabase };
}

export class AuthError extends Error {
    constructor(
        message: string,
        public readonly status: number
    ) {
        super(message);
        this.name = "AuthError";
    }
}
