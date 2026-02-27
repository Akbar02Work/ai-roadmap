// ============================================================
// POST /api/billing/webhook
// Stripe webhook handler. Uses Prisma for DB writes (no user
// session available). Verifies signature, handles idempotency.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/db";
import { safeErrorResponse } from "@/lib/api/safe-error";

export const runtime = "nodejs";

// Disable Next.js body parsing — we need raw body for signature verification
export const dynamic = "force-dynamic";

function getStripe(): Stripe {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY not set");
    return new Stripe(key, { apiVersion: "2026-01-28.clover" });
}

type BillingPlan = "starter" | "pro" | "unlimited";
type WebhookEventStatus = "processing" | "succeeded" | "failed";

const VALID_BILLING_PLANS = new Set<BillingPlan>(["starter", "pro", "unlimited"]);

// Map Stripe price IDs to plan names
function priceIdToPlan(priceId: string): BillingPlan | null {
    const map: Record<string, string> = {};
    if (process.env.STRIPE_PRICE_STARTER) map[process.env.STRIPE_PRICE_STARTER] = "starter";
    if (process.env.STRIPE_PRICE_PRO) map[process.env.STRIPE_PRICE_PRO] = "pro";
    if (process.env.STRIPE_PRICE_UNLIMITED) map[process.env.STRIPE_PRICE_UNLIMITED] = "unlimited";
    const plan = map[priceId];
    if (!plan || !VALID_BILLING_PLANS.has(plan as BillingPlan)) return null;
    return plan as BillingPlan;
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

function normalizePlan(plan: string | null | undefined): BillingPlan | null {
    if (!plan) return null;
    if (!VALID_BILLING_PLANS.has(plan as BillingPlan)) return null;
    return plan as BillingPlan;
}

function resolvePlan(metadataPlan: string | null | undefined, priceId: string): BillingPlan {
    const fromMetadata = normalizePlan(metadataPlan);
    if (fromMetadata) return fromMetadata;
    const fromPrice = priceIdToPlan(priceId);
    if (fromPrice) return fromPrice;
    throw new Error("Unknown plan for subscription event");
}

function fromUnixSeconds(seconds: number | null | undefined): Date | null {
    if (typeof seconds !== "number") return null;
    return new Date(seconds * 1000);
}

function toSafeErrorMessage(err: unknown): string {
    if (err instanceof Stripe.errors.StripeError) {
        return `Stripe error: ${err.type}`;
    }
    if (err instanceof Error) {
        return err.message.slice(0, 500);
    }
    return "Unknown webhook processing error";
}

async function markEventProcessing(eventId: string): Promise<WebhookEventStatus> {
    const existing = await prisma.stripeWebhookEvent.findUnique({
        where: { eventId },
        select: { status: true },
    });

    if (!existing) {
        try {
            const created = await prisma.stripeWebhookEvent.create({
                data: {
                    eventId,
                    status: "processing",
                    lastError: null,
                    processedAt: null,
                    updatedAt: new Date(),
                },
                select: { status: true },
            });
            return created.status as WebhookEventStatus;
        } catch (err: unknown) {
            const code = (err as { code?: string })?.code;
            if (code !== "P2002") throw err;

            const raced = await prisma.stripeWebhookEvent.findUnique({
                where: { eventId },
                select: { status: true },
            });
            if (!raced) throw err;
            return raced.status as WebhookEventStatus;
        }
    }

    if (existing.status === "succeeded") {
        return "succeeded";
    }

    const updated = await prisma.stripeWebhookEvent.update({
        where: { eventId },
        data: {
            status: "processing",
            lastError: null,
            updatedAt: new Date(),
        },
        select: { status: true },
    });

    return updated.status as WebhookEventStatus;
}

async function markEventSucceeded(eventId: string): Promise<void> {
    const now = new Date();
    await prisma.stripeWebhookEvent.update({
        where: { eventId },
        data: {
            status: "succeeded",
            lastError: null,
            processedAt: now,
            updatedAt: now,
        },
    });
}

async function markEventFailed(eventId: string, safeError: string): Promise<void> {
    await prisma.stripeWebhookEvent.update({
        where: { eventId },
        data: {
            status: "failed",
            lastError: safeError.slice(0, 2000),
            updatedAt: new Date(),
        },
    });
}

export async function POST(req: NextRequest) {
    let stripe: Stripe;
    try {
        stripe = getStripe();
    } catch (err) {
        console.error("[webhook] Stripe config error:", err);
        return safeErrorResponse(503, "SERVICE_UNAVAILABLE", "Webhook not configured");
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
        console.error("[webhook] STRIPE_WEBHOOK_SECRET not set");
        return safeErrorResponse(503, "SERVICE_UNAVAILABLE", "Webhook not configured");
    }

    // 1. Verify signature
    const body = await req.text();
    const sig = req.headers.get("stripe-signature");

    if (!sig) {
        return safeErrorResponse(400, "VALIDATION_ERROR", "Missing signature");
    }

    let event: Stripe.Event;
    try {
        event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
    } catch (err) {
        console.error("[webhook] Signature verification failed:", err instanceof Error ? err.message : err);
        return safeErrorResponse(400, "VALIDATION_ERROR", "Invalid signature");
    }

    // 2. Event lifecycle + idempotency
    let eventStatus: WebhookEventStatus;
    try {
        eventStatus = await markEventProcessing(event.id);
    } catch (err) {
        console.error("[webhook] Failed to initialize idempotency state:", err);
        return safeErrorResponse(500, "INTERNAL_ERROR", "Webhook idempotency unavailable");
    }

    if (eventStatus === "succeeded") {
        return NextResponse.json({ received: true });
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
        const safeError = toSafeErrorMessage(err);
        console.error(`[webhook] Error handling ${event.type}:`, safeError);
        try {
            await markEventFailed(event.id, safeError);
        } catch (statusErr) {
            console.error("[webhook] Failed to mark event as failed:", statusErr);
        }
        return safeErrorResponse(500, "INTERNAL_ERROR", "Webhook processing failed");
    }

    try {
        await markEventSucceeded(event.id);
    } catch (err) {
        console.error("[webhook] Failed to finalize webhook event status:", err);
        return safeErrorResponse(500, "INTERNAL_ERROR", "Webhook status update failed");
    }

    return NextResponse.json({ received: true });
}

// ---- Event Handlers ----

async function handleCheckoutCompleted(stripe: Stripe, session: Stripe.Checkout.Session) {
    const userId = session.metadata?.userId || session.client_reference_id;
    const subscriptionId = session.subscription as string | null;
    const customerId = session.customer as string | null;

    if (!userId || !subscriptionId) {
        throw new Error("checkout.session.completed missing userId or subscriptionId");
    }

    // Retrieve the full subscription to get plan details
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const priceId = subscription.items.data[0]?.price?.id || "";
    const plan = resolvePlan(session.metadata?.plan, priceId);

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
        throw new Error(`subscription ${subscription.id} missing metadata.userId`);
    }

    const priceId = subscription.items.data[0]?.price?.id || "";
    const plan = resolvePlan(subscription.metadata?.plan, priceId);

    await upsertSubscription(userId, subscription, plan);
}

async function upsertSubscription(
    userId: string,
    subscription: Stripe.Subscription,
    plan: BillingPlan
) {
    const subscriptionPeriod = subscription as Stripe.Subscription & {
        current_period_start?: number;
        current_period_end?: number;
    };

    const data = {
        userId,
        plan,
        status: mapStatus(subscription.status),
        stripeSubId: subscription.id,
        currentPeriodStart: fromUnixSeconds(subscriptionPeriod.current_period_start),
        currentPeriodEnd: fromUnixSeconds(subscriptionPeriod.current_period_end),
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
