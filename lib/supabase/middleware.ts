import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicEnv, SupabaseConfigError } from "@/lib/supabase/env";

function serviceUnavailableResponse() {
    return new NextResponse("Service unavailable", {
        status: 503,
        headers: {
            "content-type": "text/plain; charset=utf-8",
        },
    });
}

function isAuthSessionMissingError(error: unknown) {
    if (!error || typeof error !== "object") {
        return false;
    }

    const maybeError = error as { name?: unknown; message?: unknown };
    return (
        maybeError.name === "AuthSessionMissingError" ||
        maybeError.message === "Auth session missing!"
    );
}

export async function updateSession(request: NextRequest) {
    let env;
    try {
        env = getSupabasePublicEnv("supabase/middleware");
    } catch (error) {
        if (error instanceof SupabaseConfigError) {
            return serviceUnavailableResponse();
        }
        console.error("[supabase/middleware] Unexpected env resolution error:", error);
        return serviceUnavailableResponse();
    }

    let supabaseResponse = NextResponse.next({
        request,
    });

    const supabase = createServerClient(
        env.url,
        env.anonKey,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll();
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) =>
                        request.cookies.set(name, value)
                    );
                    supabaseResponse = NextResponse.next({
                        request,
                    });
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    );
                },
            },
        }
    );

    // Refresh auth token if session exists; anon requests are expected to have no session.
    let refreshError: unknown = null;
    try {
        const { error } = await supabase.auth.getUser();
        refreshError = error;
    } catch (error) {
        refreshError = error;
    }

    if (refreshError) {
        if (isAuthSessionMissingError(refreshError)) {
            return supabaseResponse;
        }

        const errorMessage =
            refreshError instanceof Error ? refreshError.message : String(refreshError);
        console.error("[supabase/middleware] Failed to refresh auth session:", errorMessage);
        return serviceUnavailableResponse();
    }

    return supabaseResponse;
}
