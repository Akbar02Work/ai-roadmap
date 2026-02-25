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

    // Refresh the auth token
    const { error } = await supabase.auth.getUser();
    if (error) {
        console.error("[supabase/middleware] Failed to refresh auth session:", error.message);
        return serviceUnavailableResponse();
    }

    return supabaseResponse;
}
