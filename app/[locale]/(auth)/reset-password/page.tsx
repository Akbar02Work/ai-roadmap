"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter } from "next/navigation";

export default function ResetPasswordPage() {
    const tAuth = useTranslations("auth");
    const params = useParams();
    const router = useRouter();
    const locale = (params.locale as string) ?? "en";

    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [ready, setReady] = useState(false);

    // Listen for PASSWORD_RECOVERY event from Supabase
    useEffect(() => {
        const supabase = createClient();

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((event) => {
            if (event === "PASSWORD_RECOVERY") {
                setReady(true);
            }
        });

        // Also check if the user already has a session (recovery token in URL hash)
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session) {
                setReady(true);
            }
        });

        return () => subscription.unsubscribe();
    }, []);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);

        if (password !== confirmPassword) {
            setError(tAuth("passwordMismatch"));
            return;
        }

        setLoading(true);

        const supabase = createClient();

        try {
            const { error: updateError } = await supabase.auth.updateUser({
                password,
            });
            if (updateError) throw updateError;

            setSuccess(true);

            // Redirect to login after a short delay
            setTimeout(() => {
                router.push(`/${locale}/login`);
            }, 2000);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-background">
            <div className="w-full max-w-md rounded-2xl border border-border/50 bg-card p-8 shadow-xl">
                <h1 className="mb-2 text-center text-xl font-bold">
                    {tAuth("resetTitle")}
                </h1>
                <p className="mb-6 text-center text-sm text-muted-foreground">
                    {tAuth("resetDescription")}
                </p>

                {success ? (
                    <p className="text-center text-sm text-green-600">
                        {tAuth("resetSuccess")}
                    </p>
                ) : !ready ? (
                    <div className="text-center">
                        <p className="text-sm text-muted-foreground">
                            Loading...
                        </p>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder={tAuth("newPasswordPlaceholder")}
                            required
                            minLength={6}
                            className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-violet-500"
                        />
                        <input
                            type="password"
                            value={confirmPassword}
                            onChange={(e) =>
                                setConfirmPassword(e.target.value)
                            }
                            placeholder={tAuth("confirmPasswordPlaceholder")}
                            required
                            minLength={6}
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
                            {loading ? "..." : tAuth("resetButton")}
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
