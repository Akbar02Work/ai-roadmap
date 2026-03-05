// ============================================================
// GET /api/billing/config
// Exposes a minimal "is billing configured" flag to the client UI.
// Does NOT leak secrets; only booleans.
// ============================================================

import { NextResponse } from "next/server";

function hasNonEmpty(value: string | undefined): boolean {
    return typeof value === "string" && value.trim().length > 0;
}

export async function GET() {
    // For now, "configured" means we can create Stripe Checkout sessions.
    // We intentionally do not require auth here; the response doesn't expose anything sensitive.
    const enabled =
        hasNonEmpty(process.env.STRIPE_SECRET_KEY) &&
        hasNonEmpty(process.env.STRIPE_PRICE_STARTER) &&
        hasNonEmpty(process.env.STRIPE_PRICE_PRO) &&
        hasNonEmpty(process.env.STRIPE_PRICE_UNLIMITED) &&
        hasNonEmpty(process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL);

    return NextResponse.json({ enabled });
}

