// ============================================================
// Usage Limits — check + increment per-user daily limits
// ============================================================

import "server-only";
import { prisma } from "@/lib/db";
import { type Plan, type CallLLMContext, PLAN_LIMITS } from "./types";

const POSTGRES_INT_MAX = 2_147_483_647;

interface UsageCheckResult {
    allowed: boolean;
    reason?: string;
    statusCode?: 403 | 503;
    current?: { aiMessages: number; tokensUsed: number };
    limit?: { aiMessagesPerDay: number; tokensPerDay: number };
}

export interface UsageConsumeResult {
    allowed: boolean;
    reason?: string;
    statusCode?: 403 | 503;
}

interface UsagePlanSnapshot {
    plan: Plan;
    limits: { aiMessagesPerDay: number; tokensPerDay: number };
}

const USAGE_ENFORCEMENT_UNAVAILABLE_REASON = "Usage enforcement unavailable.";
const USAGE_ENFORCEMENT_MIGRATION_MISSING_REASON =
    "Usage enforcement migration not applied (0002_usage_rpc.sql).";

interface SupabaseRpcErrorLike {
    code?: string;
    message?: string;
    details?: string;
    hint?: string;
}

function isMissingConsumeUsageRpc(error: SupabaseRpcErrorLike): boolean {
    const message = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
    if (error.code === "42883") {
        return true;
    }
    return message.includes("consume_usage_v1") && message.includes("does not exist");
}

function normalizePlan(plan: unknown): Plan {
    switch (plan) {
        case "free":
        case "starter":
        case "pro":
        case "unlimited":
            return plan;
        default:
            return "free";
    }
}

function getPlanSnapshot(plan: Plan): UsagePlanSnapshot {
    const limits = PLAN_LIMITS[plan];
    return {
        plan,
        limits: {
            aiMessagesPerDay:
                limits.aiMessagesPerDay === Infinity
                    ? POSTGRES_INT_MAX
                    : limits.aiMessagesPerDay,
            tokensPerDay:
                limits.tokensPerDay === Infinity
                    ? POSTGRES_INT_MAX
                    : limits.tokensPerDay,
        },
    };
}

/**
 * Get the user's plan. Falls back to 'free' if no subscription found.
 */
async function getUserPlan(userId: string): Promise<Plan> {
    const sub = await prisma.subscription.findFirst({
        where: { userId, status: "active" },
        orderBy: { createdAt: "desc" },
    });
    return normalizePlan(sub?.plan);
}

async function getUserPlanWithSupabase(ctx: CallLLMContext): Promise<Plan> {
    const { data, error } = await ctx.supabase
        .from("subscriptions")
        .select("plan")
        .eq("user_id", ctx.userId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1);

    if (error) {
        throw new Error(`[usage] subscriptions query failed: ${error.message}`);
    }

    return normalizePlan(data?.[0]?.plan);
}

/**
 * Check if user can make an LLM call. Should be called BEFORE the LLM request.
 * Returns { allowed: false, reason } if limit exceeded.
 */
export async function checkUsageLimit(userId: string): Promise<UsageCheckResult> {
    const planSnapshot = getPlanSnapshot(await getUserPlan(userId));
    const { plan, limits } = planSnapshot;

    // Unlimited plan → always allowed
    if (plan === "unlimited") {
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

export async function checkUsageLimitWithSupabase(
    ctx: CallLLMContext
): Promise<UsageCheckResult> {
    try {
        const planSnapshot = getPlanSnapshot(await getUserPlanWithSupabase(ctx));
        const { plan, limits } = planSnapshot;

        if (plan === "unlimited") {
            return { allowed: true };
        }

        const today = new Date().toISOString().slice(0, 10);
        const { data, error } = await ctx.supabase
            .from("usage")
            .select("ai_messages, tokens_used")
            .eq("user_id", ctx.userId)
            .eq("date", today)
            .maybeSingle();

        if (error) {
            return {
                allowed: false,
                statusCode: 503,
                reason: "Usage check unavailable.",
            };
        }

        const current = {
            aiMessages: data?.ai_messages ?? 0,
            tokensUsed: data?.tokens_used ?? 0,
        };

        if (current.aiMessages >= limits.aiMessagesPerDay) {
            return {
                allowed: false,
                statusCode: 403,
                reason: `Daily AI message limit reached (${limits.aiMessagesPerDay}/${plan} plan). Upgrade for more.`,
                current,
                limit: {
                    aiMessagesPerDay: limits.aiMessagesPerDay,
                    tokensPerDay: limits.tokensPerDay,
                },
            };
        }

        if (current.tokensUsed >= limits.tokensPerDay) {
            return {
                allowed: false,
                statusCode: 403,
                reason: `Daily token limit reached (${limits.tokensPerDay}/${plan} plan). Upgrade for more.`,
                current,
                limit: {
                    aiMessagesPerDay: limits.aiMessagesPerDay,
                    tokensPerDay: limits.tokensPerDay,
                },
            };
        }

        return {
            allowed: true,
            current,
            limit: {
                aiMessagesPerDay: limits.aiMessagesPerDay,
                tokensPerDay: limits.tokensPerDay,
            },
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[usage] supabase usage check failed:", message);
        return {
            allowed: false,
            statusCode: 503,
            reason: "Usage check unavailable.",
        };
    }
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
    const planSnapshot = getPlanSnapshot(await getUserPlan(userId));
    const { plan, limits } = planSnapshot;

    // Unlimited plan still tracks usage, but has no hard cap.
    if (plan === "unlimited") {
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
        statusCode: 403,
    };
}

export async function consumeUsageWithSupabase(
    ctx: CallLLMContext,
    deltaTokens: number,
    deltaMessages = 1
): Promise<UsageConsumeResult> {
    try {
        const planSnapshot = getPlanSnapshot(await getUserPlanWithSupabase(ctx));
        const { plan, limits } = planSnapshot;

        const { data, error } = await ctx.supabase.rpc("consume_usage_v1", {
            delta_tokens: deltaTokens,
            delta_messages: deltaMessages,
            max_tokens: limits.tokensPerDay,
            max_messages: limits.aiMessagesPerDay,
        });

        if (error) {
            if (isMissingConsumeUsageRpc(error)) {
                console.error(
                    "[usage] consume_usage_v1 missing. Apply migration 0002_usage_rpc.sql.",
                    {
                        code: error.code,
                        message: error.message,
                    }
                );
                return {
                    allowed: false,
                    statusCode: 503,
                    reason: USAGE_ENFORCEMENT_MIGRATION_MISSING_REASON,
                };
            }
            console.error("[usage] consume_usage_v1 rpc error:", error);
            return {
                allowed: false,
                statusCode: 503,
                reason: USAGE_ENFORCEMENT_UNAVAILABLE_REASON,
            };
        }

        const allowed = Array.isArray(data)
            ? Boolean(data[0]?.allowed)
            : Boolean((data as { allowed?: boolean } | null)?.allowed);

        if (!allowed) {
            return {
                allowed: false,
                statusCode: 403,
                reason: `Daily usage limit exceeded (${plan} plan).`,
            };
        }

        return { allowed: true };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
            isMissingConsumeUsageRpc({
                message,
            })
        ) {
            console.error(
                "[usage] consume_usage_v1 missing. Apply migration 0002_usage_rpc.sql.",
                { message }
            );
            return {
                allowed: false,
                statusCode: 503,
                reason: USAGE_ENFORCEMENT_MIGRATION_MISSING_REASON,
            };
        }
        console.error("[usage] supabase usage consume failed:", message);
        return {
            allowed: false,
            statusCode: 503,
            reason: USAGE_ENFORCEMENT_UNAVAILABLE_REASON,
        };
    }
}
