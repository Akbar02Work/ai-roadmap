// ============================================================
// Rate Limiter — Upstash Redis + @upstash/ratelimit
// Graceful no-op fallback if env vars are not set.
// ============================================================

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let ratelimitInstance: Ratelimit | null = null;
let strictRatelimitInstance: Ratelimit | null = null;

function getRedis(): Redis | null {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
        return null;
    }
    return new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
}

/**
 * Standard rate limit: 30 requests per 60 seconds per user.
 */
function getStandardRateLimiter(): Ratelimit | null {
    if (ratelimitInstance) return ratelimitInstance;
    const redis = getRedis();
    if (!redis) return null;
    ratelimitInstance = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(30, "60 s"),
        prefix: "rl:standard",
        analytics: true,
    });
    return ratelimitInstance;
}

/**
 * Strict rate limit for expensive endpoints: 5 requests per 60 seconds per user.
 */
function getStrictRateLimiter(): Ratelimit | null {
    if (strictRatelimitInstance) return strictRatelimitInstance;
    const redis = getRedis();
    if (!redis) return null;
    strictRatelimitInstance = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(5, "60 s"),
        prefix: "rl:strict",
        analytics: true,
    });
    return strictRatelimitInstance;
}

export interface RateLimitResult {
    allowed: boolean;
    remaining?: number;
    resetMs?: number;
}

/**
 * Check rate limit. Returns { allowed: true } if Upstash is not configured (graceful no-op).
 * @param identifier - unique identifier (userId or IP)
 * @param strict - use strict limits (for expensive endpoints like roadmap generation)
 */
export async function checkRateLimit(
    identifier: string,
    strict = false
): Promise<RateLimitResult> {
    const limiter = strict ? getStrictRateLimiter() : getStandardRateLimiter();

    // No-op fallback: if Upstash is not configured, allow everything
    if (!limiter) {
        return { allowed: true };
    }

    const result = await limiter.limit(identifier);

    return {
        allowed: result.success,
        remaining: result.remaining,
        resetMs: result.reset,
    };
}
