// ============================================================
// POST /api/billing/checkout
// Creates a Stripe Checkout Session for subscription upgrade.
// Uses Supabase RLS for profile reads, Stripe SDK for checkout.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import Stripe from "stripe";
import { requireAuth, AuthError } from "@/lib/auth";

const CheckoutBody = z.object({
    plan: z.enum(["starter", "pro", "unlimited"]),
    locale: z.enum(["en", "ru"]).optional().default("en"),
});

const PRICE_MAP: Record<string, string | undefined> = {
    starter: process.env.STRIPE_PRICE_STARTER,
    pro: process.env.STRIPE_PRICE_PRO,
    unlimited: process.env.STRIPE_PRICE_UNLIMITED,
};

type BillingErrorCode =
    | "BILLING_INVALID_REQUEST"
    | "BILLING_CONFIG_ERROR"
    | "BILLING_STRIPE_ERROR"
    | "BILLING_INTERNAL_ERROR"
    | "BILLING_AUTH_REQUIRED"
    | "BILLING_AUTH_UNAVAILABLE";

function errorResponse(
    status: number,
    code: BillingErrorCode,
    error: string
) {
    return NextResponse.json({ error, code }, { status });
}

function getStripe(): Stripe {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY not set");
    return new Stripe(key, { apiVersion: "2026-01-28.clover" });
}

function getAppBaseUrl(req: NextRequest): string | null {
    const configuredUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;

    if (configuredUrl) {
        try {
            return new URL(configuredUrl).origin;
        } catch {
            return null;
        }
    }

    if (process.env.NODE_ENV !== "production") {
        // Development-only fallback to request-derived origin.
        return req.nextUrl.origin;
    }

    return null;
}

function getStripeErrorStatus(err: Stripe.errors.StripeError): number {
    switch (err.type) {
        case "StripeConnectionError":
        case "StripeRateLimitError":
        case "StripeAPIError":
            return 503;
        default:
            return 502;
    }
}

export async function POST(req: NextRequest) {
    try {
        const { userId, supabase } = await requireAuth();

        // 1. Parse + validate body
        let body: z.infer<typeof CheckoutBody>;
        try {
            body = CheckoutBody.parse(await req.json());
        } catch {
            return errorResponse(
                400,
                "BILLING_INVALID_REQUEST",
                "Invalid request. Provide plan: starter|pro|unlimited."
            );
        }

        const priceId = PRICE_MAP[body.plan];
        if (!priceId) {
            return errorResponse(
                503,
                "BILLING_CONFIG_ERROR",
                `Price not configured for plan "${body.plan}".`
            );
        }

        const stripe = getStripe();

        // 2. Get or create Stripe customer
        const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("stripe_customer_id, email")
            .eq("id", userId)
            .single();

        if (profileError || !profile) {
            console.error("[billing/checkout] Profile load failed:", profileError?.message);
            return errorResponse(500, "BILLING_INTERNAL_ERROR", "Profile not found.");
        }

        let customerId = profile.stripe_customer_id as string | null;

        if (!customerId) {
            const customer = await stripe.customers.create({
                metadata: { userId },
                email: (profile.email as string) || undefined,
            });
            customerId = customer.id;

            // Update profile with Stripe customer ID (RLS: user can update own profile)
            const { error: updateError } = await supabase
                .from("profiles")
                .update({ stripe_customer_id: customerId })
                .eq("id", userId);

            if (updateError) {
                console.error("[billing/checkout] Failed to save customer ID:", updateError.message);
                // Non-fatal — checkout will still work
            }
        }

        // 3. Create Checkout Session
        const appBaseUrl = getAppBaseUrl(req);
        if (!appBaseUrl) {
            return errorResponse(
                503,
                "BILLING_CONFIG_ERROR",
                "Billing return URL is not configured."
            );
        }

        const successUrl = new URL(`/${body.locale}/billing`, appBaseUrl);
        successUrl.searchParams.set("status", "success");

        const cancelUrl = new URL(`/${body.locale}/billing`, appBaseUrl);
        cancelUrl.searchParams.set("status", "cancel");

        const session = await stripe.checkout.sessions.create({
            mode: "subscription",
            customer: customerId,
            client_reference_id: userId,
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: successUrl.toString(),
            cancel_url: cancelUrl.toString(),
            metadata: { userId, plan: body.plan },
            subscription_data: {
                metadata: { userId, plan: body.plan },
            },
        });

        return NextResponse.json({ url: session.url });
    } catch (err) {
        if (err instanceof AuthError) {
            if (err.status === 401) {
                return errorResponse(err.status, "BILLING_AUTH_REQUIRED", err.message);
            }
            return errorResponse(err.status, "BILLING_AUTH_UNAVAILABLE", err.message);
        }
        if (err instanceof Error && err.message === "STRIPE_SECRET_KEY not set") {
            return errorResponse(
                503,
                "BILLING_CONFIG_ERROR",
                "Billing service is not configured."
            );
        }
        if (err instanceof Stripe.errors.StripeError) {
            console.error("[billing/checkout] Stripe error:", err.type, err.code);
            return errorResponse(
                getStripeErrorStatus(err),
                "BILLING_STRIPE_ERROR",
                "Billing provider error. Please retry later."
            );
        }
        console.error("[billing/checkout] Unexpected:", err);
        return errorResponse(
            500,
            "BILLING_INTERNAL_ERROR",
            "Failed to create checkout session."
        );
    }
}
