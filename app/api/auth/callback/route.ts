// ============================================================
// GET /api/auth/callback — exchange auth code for session
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { SupabaseConfigError } from "@/lib/supabase/env";

const SUPPORTED_LOCALES = ["en", "ru"] as const;
type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

function isSupportedLocale(value: string | null): value is SupportedLocale {
    return value !== null && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function localeFromAcceptLanguage(header: string | null): SupportedLocale | null {
    if (!header) return null;

    const parts = header.split(",");
    for (const part of parts) {
        const tag = part.trim().split(";")[0]?.toLowerCase();
        if (!tag) continue;
        const base = tag.split("-")[0];
        if (base === "en" || base === "ru") {
            return base;
        }
    }

    return null;
}

function resolveLocale(request: NextRequest, searchParams: URLSearchParams): SupportedLocale {
    const localeFromQuery = searchParams.get("locale");
    if (isSupportedLocale(localeFromQuery)) {
        return localeFromQuery;
    }

    const localeFromCookie = request.cookies.get("NEXT_LOCALE")?.value ?? null;
    if (isSupportedLocale(localeFromCookie)) {
        return localeFromCookie;
    }

    return localeFromAcceptLanguage(request.headers.get("accept-language")) ?? "en";
}

function isSafeNextPath(next: string | null): next is string {
    if (!next) return false;
    if (!next.startsWith("/")) return false;
    if (next.startsWith("//")) return false;
    if (next.includes("://")) return false;
    return true;
}

function hasLocalePrefix(path: string, locale: SupportedLocale): boolean {
    return (
        path === `/${locale}` ||
        path.startsWith(`/${locale}/`) ||
        path.startsWith(`/${locale}?`) ||
        path.startsWith(`/${locale}#`)
    );
}

function buildPostAuthPath(next: string | null, locale: SupportedLocale): string {
    if (!isSafeNextPath(next)) {
        return `/${locale}/onboarding`;
    }

    if (hasLocalePrefix(next, locale)) {
        return next;
    }

    return `/${locale}${next}`;
}

export async function GET(request: NextRequest) {
    const { searchParams, origin } = new URL(request.url);
    const code = searchParams.get("code");
    const next = searchParams.get("next");
    const locale = resolveLocale(request, searchParams);
    const postAuthPath = buildPostAuthPath(next, locale);

    if (code) {
        try {
            const supabase = await createClient();
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            if (!error) {
                return NextResponse.redirect(`${origin}${postAuthPath}`);
            }
        } catch (error) {
            if (error instanceof SupabaseConfigError) {
                return NextResponse.json(
                    { error: "Authentication service unavailable." },
                    { status: 503 }
                );
            }
            console.error("[auth/callback] unexpected error:", error);
        }
    }

    // Auth code exchange failed — redirect to login
    return NextResponse.redirect(`${origin}/${locale}/login`);
}
