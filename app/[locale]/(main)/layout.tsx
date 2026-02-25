// ============================================================
// Server-side auth guard layout for protected (main) routes.
// If no session → redirect to /${locale}/login?next=...
// ============================================================

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthHeader } from "./auth-header";

export default async function ProtectedLayout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ locale: string }>;
}) {
    const { locale } = await params;

    let user = null;
    try {
        const supabase = await createClient();
        const {
            data: { user: authUser },
        } = await supabase.auth.getUser();
        user = authUser;
    } catch {
        // Supabase not configured or error — redirect to login
    }

    if (!user) {
        // Build the current path for the `next` param
        // We can't know the full path in a layout, so redirect to login with locale
        redirect(`/${locale}/login`);
    }

    return (
        <div className="min-h-screen bg-background">
            <AuthHeader locale={locale} userEmail={user.email ?? ""} />
            {children}
        </div>
    );
}
