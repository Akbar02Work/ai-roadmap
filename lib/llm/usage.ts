// ============================================================
// Usage Limits — check + increment per-user daily limits
// ============================================================

import { prisma } from "@/lib/db";
import { type Plan, PLAN_LIMITS } from "./types";

interface UsageCheckResult {
    allowed: boolean;
    reason?: string;
    current?: { aiMessages: number; tokensUsed: number };
    limit?: { aiMessagesPerDay: number; tokensPerDay: number };
}

export interface UsageConsumeResult {
    allowed: boolean;
    reason?: string;
}

/**
 * Get the user's plan. Falls back to 'free' if no subscription found.
 */
async function getUserPlan(userId: string): Promise<Plan> {
    const sub = await prisma.subscription.findFirst({
        where: { userId, status: "active" },
        orderBy: { createdAt: "desc" },
    });
    return (sub?.plan as Plan) ?? "free";
}

/**
 * Check if user can make an LLM call. Should be called BEFORE the LLM request.
 * Returns { allowed: false, reason } if limit exceeded.
 */
export async function checkUsageLimit(userId: string): Promise<UsageCheckResult> {
    const plan = await getUserPlan(userId);
    const limits = PLAN_LIMITS[plan];

    // Unlimited plan → always allowed
    if (limits.aiMessagesPerDay === Infinity) {
        return { allowed: true };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const usage = await prisma.usage.findUnique({
        where: { userId_date: { userId, date: today } },
    });

    const current = {
        aiMessages: usage?.aiMessages ?? 0,
        tokensUsed: usage?.tokensUsed ?? 0,
    };

    if (current.aiMessages >= limits.aiMessagesPerDay) {
        return {
            allowed: false,
            reason: `Daily AI message limit reached (${limits.aiMessagesPerDay}/${plan} plan). Upgrade for more.`,
            current,
            limit: { aiMessagesPerDay: limits.aiMessagesPerDay, tokensPerDay: limits.tokensPerDay },
        };
    }

    if (current.tokensUsed >= limits.tokensPerDay) {
        return {
            allowed: false,
            reason: `Daily token limit reached (${limits.tokensPerDay}/${plan} plan). Upgrade for more.`,
            current,
            limit: { aiMessagesPerDay: limits.aiMessagesPerDay, tokensPerDay: limits.tokensPerDay },
        };
    }

    return { allowed: true, current, limit: { aiMessagesPerDay: limits.aiMessagesPerDay, tokensPerDay: limits.tokensPerDay } };
}

/**
 * Atomically increment usage counters AFTER a successful LLM call.
 * Uses upsert to handle first-call-of-the-day.
 */
export async function incrementUsage(
    userId: string,
    tokensUsed: number
): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await prisma.usage.upsert({
        where: { userId_date: { userId, date: today } },
        create: {
            userId,
            date: today,
            aiMessages: 1,
            tokensUsed,
        },
        update: {
            aiMessages: { increment: 1 },
            tokensUsed: { increment: tokensUsed },
        },
    });
}

/**
 * Atomically consume usage budget for the current day.
 * This is the authoritative enforcement path after an LLM call.
 */
export async function consumeUsage(
    userId: string,
    deltaTokens: number,
    deltaMessages = 1
): Promise<UsageConsumeResult> {
    const plan = await getUserPlan(userId);
    const limits = PLAN_LIMITS[plan];

    // Unlimited plan still tracks usage, but has no hard cap.
    if (limits.aiMessagesPerDay === Infinity || limits.tokensPerDay === Infinity) {
        await incrementUsage(userId, deltaTokens);
        return { allowed: true };
    }

    const rows = await prisma.$queryRaw<Array<{ ai_messages: number; tokens_used: number }>>`
        WITH ensure_row AS (
            INSERT INTO "usage" ("user_id", "date")
            VALUES (${userId}::uuid, CURRENT_DATE)
            ON CONFLICT ("user_id", "date") DO NOTHING
        )
        UPDATE "usage"
        SET
            "ai_messages" = "ai_messages" + ${deltaMessages},
            "tokens_used" = "tokens_used" + ${deltaTokens}
        WHERE
            "user_id" = ${userId}::uuid
            AND "date" = CURRENT_DATE
            AND "ai_messages" + ${deltaMessages} <= ${limits.aiMessagesPerDay}
            AND "tokens_used" + ${deltaTokens} <= ${limits.tokensPerDay}
        RETURNING "ai_messages", "tokens_used"
    `;

    if (rows.length > 0) {
        return { allowed: true };
    }

    return {
        allowed: false,
        reason: `Daily usage limit exceeded (${plan} plan).`,
    };
}
