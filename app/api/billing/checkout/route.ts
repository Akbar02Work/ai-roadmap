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

function getStripe(): Stripe {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY not set");
    return new Stripe(key, { apiVersion: "2026-01-28.clover" });
}

export async function POST(req: NextRequest) {
    try {
        const { userId, supabase } = await requireAuth();

        // 1. Parse + validate body
        let body: z.infer<typeof CheckoutBody>;
        try {
            body = CheckoutBody.parse(await req.json());
        } catch {
            return NextResponse.json(
                { error: "Invalid request. Provide plan: starter|pro|unlimited." },
                { status: 400 }
            );
        }

        const priceId = PRICE_MAP[body.plan];
        if (!priceId) {
            return NextResponse.json(
                { error: `Price not configured for plan "${body.plan}". Set STRIPE_PRICE_${body.plan.toUpperCase()} env.` },
                { status: 503 }
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
            return NextResponse.json({ error: "Profile not found." }, { status: 500 });
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
        const origin = req.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        const session = await stripe.checkout.sessions.create({
            mode: "subscription",
            customer: customerId,
            client_reference_id: userId,
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: `${origin}/${body.locale}/billing?status=success`,
            cancel_url: `${origin}/${body.locale}/billing?status=cancel`,
            metadata: { userId, plan: body.plan },
            subscription_data: {
                metadata: { userId, plan: body.plan },
            },
        });

        return NextResponse.json({ url: session.url });
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json({ error: err.message }, { status: err.status });
        }
        if (err instanceof Error && err.message === "STRIPE_SECRET_KEY not set") {
            return NextResponse.json(
                { error: "Billing service is not configured." },
                { status: 503 }
            );
        }
        console.error("[billing/checkout] Unexpected:", err);
        return NextResponse.json(
            { error: "Failed to create checkout session." },
            { status: 500 }
        );
    }
}
