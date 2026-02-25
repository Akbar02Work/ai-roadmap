import createMiddleware from "next-intl/middleware";
import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { routing } from "@/i18n/routing";

const intlMiddleware = createMiddleware(routing);

export async function proxy(request: NextRequest) {
    // Skip auth session refresh for API routes
    if (request.nextUrl.pathname.startsWith("/api")) {
        return NextResponse.next();
    }

    // 1. Refresh Supabase auth session
    const supabaseResponse = await updateSession(request);
    if (supabaseResponse.status === 503) {
        return supabaseResponse;
    }

    // 2. Handle i18n locale detection and routing
    const intlResponse = intlMiddleware(request);

    // Merge cookies from supabase into intl response
    if (supabaseResponse && intlResponse) {
        supabaseResponse.cookies.getAll().forEach(({ name, value, ...options }) => {
            intlResponse.cookies.set(name, value, options);
        });
    }

    return intlResponse;
}

export const config = {
    matcher: [
        // Match all pathnames except:
        // - API routes (/api/...)
        // - Static files (_next/static, _next/image, favicon.ico, etc.)
        "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    ],
};
