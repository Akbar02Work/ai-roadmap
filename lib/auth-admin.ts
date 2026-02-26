// ============================================================
// requireAdmin — guards admin-only API routes.
// Checks ADMIN_USER_IDS env (comma-separated UUIDs).
// ============================================================

import "server-only";
import { requireAuth, AuthError } from "@/lib/auth";

const UUID_V4_OR_VX_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseAdminIds(raw: string): string[] {
    return raw
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0 && UUID_V4_OR_VX_REGEX.test(id));
}

export async function requireAdmin() {
    const auth = await requireAuth();

    const adminIds = parseAdminIds(process.env.ADMIN_USER_IDS ?? "");

    if (adminIds.length === 0) {
        throw new AuthError("Admin access not configured", 403);
    }

    if (!adminIds.includes(auth.userId)) {
        throw new AuthError("Admin access denied", 403);
    }

    return auth;
}
