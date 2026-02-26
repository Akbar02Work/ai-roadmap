// ============================================================
// POST /api/billing/webhook
// Stripe webhook handler. Uses Prisma for DB writes (no user
// session available). Verifies signature, handles idempotency.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// Disable Next.js body parsing — we need raw body for signature verification
export const dynamic = "force-dynamic";

function getStripe(): Stripe {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY not set");
    return new Stripe(key, { apiVersion: "2026-01-28.clover" });
}

// Map Stripe price IDs to plan names
function priceIdToPlan(priceId: string): string {
    const map: Record<string, string> = {};
    if (process.env.STRIPE_PRICE_STARTER) map[process.env.STRIPE_PRICE_STARTER] = "starter";
    if (process.env.STRIPE_PRICE_PRO) map[process.env.STRIPE_PRICE_PRO] = "pro";
    if (process.env.STRIPE_PRICE_UNLIMITED) map[process.env.STRIPE_PRICE_UNLIMITED] = "unlimited";
    return map[priceId] || "starter";
}

// Map Stripe subscription status to our status
function mapStatus(stripeStatus: string): string {
    switch (stripeStatus) {
        case "active":
        case "trialing":
            return "active";
        case "canceled":
        case "unpaid":
        case "incomplete_expired":
            return "cancelled";
        case "past_due":
        case "incomplete":
            return "past_due";
        default:
            return "active";
    }
}

export async function POST(req: NextRequest) {
    const stripe = getStripe();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
        console.error("[webhook] STRIPE_WEBHOOK_SECRET not set");
        return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
    }

    // 1. Verify signature
    const body = await req.text();
    const sig = req.headers.get("stripe-signature");

    if (!sig) {
        return NextResponse.json({ error: "Missing signature" }, { status: 400 });
    }

    let event: Stripe.Event;
    try {
        event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
    } catch (err) {
        console.error("[webhook] Signature verification failed:", err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    // 2. Idempotency check — skip already-processed events
    try {
        await prisma.stripeWebhookEvent.create({
            data: { eventId: event.id },
        });
    } catch (err: unknown) {
        // Unique constraint violation = already processed
        const code = (err as { code?: string })?.code;
        if (code === "P2002") {
            return NextResponse.json({ received: true });
        }
        console.error("[webhook] Idempotency insert failed, processing anyway:", err);
    }

    // 3. Handle events
    try {
        switch (event.type) {
            case "checkout.session.completed":
                await handleCheckoutCompleted(stripe, event.data.object as Stripe.Checkout.Session);
                break;
            case "customer.subscription.updated":
                await handleSubscriptionChange(event.data.object as Stripe.Subscription);
                break;
            case "customer.subscription.deleted":
                await handleSubscriptionChange(event.data.object as Stripe.Subscription);
                break;
            default:
                // Unhandled event type — return 200 to prevent Stripe retries
                break;
        }
    } catch (err) {
        console.error(`[webhook] Error handling ${event.type}:`, err);
        // Still return 200 to avoid infinite retries on persistent errors
        // The idempotency log ensures we won't re-process on manual retry
    }

    return NextResponse.json({ received: true });
}

// ---- Event Handlers ----

async function handleCheckoutCompleted(stripe: Stripe, session: Stripe.Checkout.Session) {
    const userId = session.metadata?.userId || session.client_reference_id;
    const subscriptionId = session.subscription as string | null;
    const customerId = session.customer as string | null;

    if (!userId || !subscriptionId) {
        console.warn("[webhook] checkout.session.completed: missing userId or subscriptionId");
        return;
    }

    // Retrieve the full subscription to get plan details
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const priceId = subscription.items.data[0]?.price?.id || "";
    const plan = session.metadata?.plan || priceIdToPlan(priceId);

    // Update profile with Stripe customer ID if needed
    if (customerId) {
        await prisma.profile.update({
            where: { id: userId },
            data: { stripeCustomerId: customerId },
        });
    }

    // Upsert subscription
    await upsertSubscription(userId, subscription, plan);
}

async function handleSubscriptionChange(subscription: Stripe.Subscription) {
    const userId = subscription.metadata?.userId;

    if (!userId) {
        console.warn(`[webhook] subscription ${subscription.id}: no userId in metadata, skipping`);
        return;
    }

    const priceId = subscription.items.data[0]?.price?.id || "";
    const plan = subscription.metadata?.plan || priceIdToPlan(priceId);

    await upsertSubscription(userId, subscription, plan);
}

async function upsertSubscription(
    userId: string,
    subscription: Stripe.Subscription,
    plan: string
) {
    const data = {
        userId,
        plan,
        status: mapStatus(subscription.status),
        stripeSubId: subscription.id,
        currentPeriodStart: new Date(subscription.items.data[0]?.current_period_start ?? Date.now()),
        currentPeriodEnd: new Date(subscription.items.data[0]?.current_period_end ?? Date.now()),
    };

    // Try to find existing subscription by stripe_sub_id
    const existing = await prisma.subscription.findFirst({
        where: { stripeSubId: subscription.id },
    });

    if (existing) {
        await prisma.subscription.update({
            where: { id: existing.id },
            data: {
                plan: data.plan,
                status: data.status,
                currentPeriodStart: data.currentPeriodStart,
                currentPeriodEnd: data.currentPeriodEnd,
            },
        });
    } else {
        await prisma.subscription.create({ data });
    }
}
