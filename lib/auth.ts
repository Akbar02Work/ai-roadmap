// ============================================================
// Auth helper — creates Supabase server client from cookies
// Returns userId + authenticated supabase client (RLS enforced)
// ============================================================

import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface AuthResult {
    userId: string;
    supabase: Awaited<ReturnType<typeof createClient>>;
}

/**
 * Require authenticated user. Returns userId and an authenticated
 * Supabase client that respects RLS policies.
 * Throws { status: 401, message } if not authenticated.
 */
export async function requireAuth(): Promise<AuthResult> {
    const supabase = await createClient();
    const {
        data: { user },
        error,
    } = await supabase.auth.getUser();

    if (error || !user) {
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
