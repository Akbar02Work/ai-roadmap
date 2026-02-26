// ============================================================
// requireAdmin — guards admin-only API routes.
// Checks ADMIN_USER_IDS env (comma-separated UUIDs).
// ============================================================

import "server-only";
import { requireAuth, AuthError } from "@/lib/auth";

export async function requireAdmin() {
    const auth = await requireAuth();

    const adminIds = (process.env.ADMIN_USER_IDS ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);

    if (adminIds.length === 0) {
        throw new AuthError("Admin access not configured", 403);
    }

    if (!adminIds.includes(auth.userId)) {
        throw new AuthError("Admin access denied", 403);
    }

    return auth;
}
