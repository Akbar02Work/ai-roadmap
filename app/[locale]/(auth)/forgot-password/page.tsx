"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter } from "next/navigation";

export default function ForgotPasswordPage() {
    const tAuth = useTranslations("auth");
    const params = useParams();
    const router = useRouter();
    const locale = (params.locale as string) ?? "en";

    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setLoading(true);

        const supabase = createClient();

        try {
            const { error: resetError } =
                await supabase.auth.resetPasswordForEmail(email, {
                    redirectTo: `${window.location.origin}/${locale}/reset-password`,
                });
            if (resetError) throw resetError;
            setSent(true);
        } catch (err) {
            // Don't reveal whether the account exists
            console.error("[forgot-password]", err);
            setSent(true);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-background">
            <div className="w-full max-w-md rounded-2xl border border-border/50 bg-card p-8 shadow-xl">
                <h1 className="mb-2 text-center text-xl font-bold">
                    {tAuth("forgotTitle")}
                </h1>
                <p className="mb-6 text-center text-sm text-muted-foreground">
                    {tAuth("forgotDescription")}
                </p>

                {sent ? (
                    <div className="space-y-4">
                        <p className="text-center text-sm text-green-600">
                            {tAuth("resetSent")}
                        </p>
                        <button
                            onClick={() => router.push(`/${locale}/login`)}
                            className="w-full rounded-xl border border-border py-3 text-sm font-medium transition hover:bg-muted"
                        >
                            {tAuth("backToLogin")}
                        </button>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder={tAuth("emailPlaceholder")}
                            required
                            className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-violet-500"
                        />

                        {error && (
                            <p className="text-sm text-destructive">{error}</p>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                        >
                            {loading ? "..." : tAuth("sendResetLink")}
                        </button>

                        <button
                            type="button"
                            onClick={() => router.push(`/${locale}/login`)}
                            className="w-full text-sm text-muted-foreground transition hover:text-foreground hover:underline"
                        >
                            {tAuth("backToLogin")}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}
