// ============================================================
// Shared safe-error helpers for API routes.
// Ensures no raw provider / DB / Stripe errors leak to clients.
// Every error response follows { error: string, code: string }.
// ============================================================

import { NextResponse } from "next/server";
import type { AuthError } from "@/lib/auth";

// Stable, machine-readable error codes. Add new codes here as needed.
export type ApiErrorCode =
    // Auth
    | "AUTH_REQUIRED"
    | "AUTH_UNAVAILABLE"
    // Validation
    | "VALIDATION_ERROR"
    // LLM
    | "LLM_RATE_LIMIT"
    | "LLM_USAGE_LIMIT"
    | "LLM_UNAVAILABLE"
    | "LLM_MIGRATION_MISSING"
    // General
    | "INTERNAL_ERROR"
    | "NOT_FOUND"
    | "CONFLICT"
    | "SERVICE_UNAVAILABLE"
    | "MIGRATION_MISSING";

export function safeErrorResponse(
    status: number,
    code: ApiErrorCode,
    error: string
) {
    return NextResponse.json({ error, code }, { status });
}

/**
 * Maps an LLMError to a safe client-facing response.
 * Never exposes raw provider messages.
 */
export function safeLLMErrorResponse(err: {
    httpStatus: number;
    message: string;
}) {
    const status = err.httpStatus;

    // Migration-missing messages we allow through (they tell operators what to do)
    if (status === 503 && err.message.includes("0002_usage_rpc.sql")) {
        return safeErrorResponse(
            503,
            "LLM_MIGRATION_MISSING",
            "Usage enforcement migration not applied (0002_usage_rpc.sql)."
        );
    }

    if (status === 429) {
        return safeErrorResponse(
            429,
            "LLM_RATE_LIMIT",
            "Rate limit exceeded. Please try again later."
        );
    }
    if (status === 403) {
        return safeErrorResponse(
            403,
            "LLM_USAGE_LIMIT",
            "Usage limit exceeded."
        );
    }
    if (
        status === 503 &&
        err.message === "Rate limit backend misconfigured."
    ) {
        return safeErrorResponse(
            503,
            "SERVICE_UNAVAILABLE",
            "Rate limit backend misconfigured."
        );
    }

    return safeErrorResponse(
        status >= 500 ? status : 502,
        "LLM_UNAVAILABLE",
        "LLM provider unavailable. Please try again later."
    );
}

/**
 * Maps an AuthError to a safe client-facing response.
 * Preserves existing message + status, adds stable code.
 */
export function safeAuthErrorResponse(err: AuthError) {
    const code: ApiErrorCode =
        err.status === 401 ? "AUTH_REQUIRED" : "AUTH_UNAVAILABLE";
    return safeErrorResponse(err.status, code, err.message);
}
