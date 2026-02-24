// ============================================================
// Rate Limiter — Upstash Redis + @upstash/ratelimit
// Controlled fallback:
// - production: fail-closed (503) if Upstash is unavailable/misconfigured
// - dev/test: in-memory limiter with explicit warning
// ============================================================

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let ratelimitInstance: Ratelimit | null = null;
let strictRatelimitInstance: Ratelimit | null = null;
let upstashErrorLogged = false;
let inMemoryFallbackLogged = false;
let lastUpstashErrorReason: string | null = null;

function getRedis(): Redis | null {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
        lastUpstashErrorReason = "UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN are not set.";
        return null;
    }
    try {
        return new Redis({ url, token });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        lastUpstashErrorReason = `Upstash Redis init failed: ${message}`;
        return null;
    }
}

/**
 * Standard rate limit: 30 requests per 60 seconds per user.
 */
function getStandardRateLimiter(): Ratelimit | null {
    if (ratelimitInstance) return ratelimitInstance;
    const redis = getRedis();
    if (!redis) return null;
    try {
        ratelimitInstance = new Ratelimit({
            redis,
            limiter: Ratelimit.slidingWindow(30, "60 s"),
            prefix: "rl:standard",
            analytics: true,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        lastUpstashErrorReason = `Upstash standard limiter init failed: ${message}`;
        return null;
    }
    return ratelimitInstance;
}

/**
 * Strict rate limit for expensive endpoints: 5 requests per 60 seconds per user.
 */
function getStrictRateLimiter(): Ratelimit | null {
    if (strictRatelimitInstance) return strictRatelimitInstance;
    const redis = getRedis();
    if (!redis) return null;
    try {
        strictRatelimitInstance = new Ratelimit({
            redis,
            limiter: Ratelimit.slidingWindow(5, "60 s"),
            prefix: "rl:strict",
            analytics: true,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        lastUpstashErrorReason = `Upstash strict limiter init failed: ${message}`;
        return null;
    }
    return strictRatelimitInstance;
}

export interface RateLimitResult {
    allowed: boolean;
    remaining?: number;
    resetMs?: number;
    statusCode?: 429 | 503;
    reason?: string;
}

type InMemoryWindowEntry = { count: number; windowStartedAt: number };
const inMemoryStandard = new Map<string, InMemoryWindowEntry>();
const inMemoryStrict = new Map<string, InMemoryWindowEntry>();
const WINDOW_MS = 60_000;

function runInMemoryLimiter(
    identifier: string,
    strict: boolean
): RateLimitResult {
    const limit = strict ? 5 : 30;
    const bucket = strict ? inMemoryStrict : inMemoryStandard;
    const now = Date.now();
    const current = bucket.get(identifier);

    if (!current || now - current.windowStartedAt >= WINDOW_MS) {
        bucket.set(identifier, { count: 1, windowStartedAt: now });
        return {
            allowed: true,
            remaining: limit - 1,
            resetMs: WINDOW_MS,
        };
    }

    if (current.count >= limit) {
        return {
            allowed: false,
            statusCode: 429,
            reason: "Rate limit exceeded. Try again later.",
            remaining: 0,
            resetMs: Math.max(0, WINDOW_MS - (now - current.windowStartedAt)),
        };
    }

    current.count += 1;
    bucket.set(identifier, current);
    return {
        allowed: true,
        remaining: Math.max(0, limit - current.count),
        resetMs: Math.max(0, WINDOW_MS - (now - current.windowStartedAt)),
    };
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

    if (!limiter) {
        const reason = lastUpstashErrorReason ?? "Rate limit backend misconfigured.";
        if (process.env.NODE_ENV === "production") {
            if (!upstashErrorLogged) {
                console.error(`[rate-limit] ${reason}`);
                upstashErrorLogged = true;
            }
            return {
                allowed: false,
                statusCode: 503,
                reason: "Rate limit backend misconfigured.",
            };
        }

        if (!inMemoryFallbackLogged) {
            console.error(`[rate-limit] Upstash unavailable, using in-memory fallback. ${reason}`);
            inMemoryFallbackLogged = true;
        }
        return runInMemoryLimiter(identifier, strict);
    }

    try {
        const result = await limiter.limit(identifier);

        return {
            allowed: result.success,
            remaining: result.remaining,
            resetMs: result.reset,
            statusCode: result.success ? undefined : 429,
            reason: result.success ? undefined : "Rate limit exceeded. Try again later.",
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        lastUpstashErrorReason = `Upstash rate-limit request failed: ${message}`;
        ratelimitInstance = null;
        strictRatelimitInstance = null;
        if (process.env.NODE_ENV === "production") {
            if (!upstashErrorLogged) {
                console.error(`[rate-limit] ${lastUpstashErrorReason}`);
                upstashErrorLogged = true;
            }
            return {
                allowed: false,
                statusCode: 503,
                reason: "Rate limit backend misconfigured.",
            };
        }
        if (!inMemoryFallbackLogged) {
            console.error(`[rate-limit] Upstash failed, using in-memory fallback. ${lastUpstashErrorReason}`);
            inMemoryFallbackLogged = true;
        }
        return runInMemoryLimiter(identifier, strict);
    }
}
