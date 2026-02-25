"use client";

import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export function AuthHeader({
    locale,
    userEmail,
}: {
    locale: string;
    userEmail: string;
}) {
    const t = useTranslations("auth");
    const tNav = useTranslations("nav");
    const router = useRouter();

    async function handleLogout() {
        const supabase = createClient();
        await supabase.auth.signOut();
        router.push(`/${locale}/login`);
    }

    return (
        <header className="flex items-center justify-between border-b border-border/40 px-6 py-3">
            <nav className="flex items-center gap-4">
                <button
                    onClick={() => router.push(`/${locale}/dashboard`)}
                    className="text-sm text-muted-foreground transition hover:text-foreground"
                >
                    {tNav("dashboard")}
                </button>
                <button
                    onClick={() => router.push(`/${locale}/onboarding`)}
                    className="text-sm text-muted-foreground transition hover:text-foreground"
                >
                    {tNav("home")}
                </button>
                <button
                    onClick={() => router.push(`/${locale}/settings`)}
                    className="text-sm text-muted-foreground transition hover:text-foreground"
                >
                    {tNav("settings")}
                </button>
            </nav>
            <div className="flex items-center gap-4">
                <span className="text-xs text-muted-foreground">
                    {userEmail}
                </span>
                <button
                    onClick={handleLogout}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-destructive hover:text-destructive"
                >
                    {t("logoutButton")}
                </button>
            </div>
        </header>
    );
}
