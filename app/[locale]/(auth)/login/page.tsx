"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createBrowserClient } from "@supabase/ssr";
import { useParams, useRouter } from "next/navigation";

function getSupabase() {
    return createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
}

export default function LoginPage() {
    const t = useTranslations("nav");
    const tAuth = useTranslations("auth");
    const params = useParams();
    const router = useRouter();
    const locale = (params.locale as string) ?? "en";

    const [mode, setMode] = useState<"login" | "signup">("login");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setMessage(null);
        setLoading(true);

        const supabase = getSupabase();

        try {
            if (mode === "signup") {
                const { error: signUpError } = await supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        emailRedirectTo: `${window.location.origin}/api/auth/callback`,
                    },
                });
                if (signUpError) throw signUpError;
                setMessage(tAuth("checkEmail"));
            } else {
                const { error: signInError } =
                    await supabase.auth.signInWithPassword({ email, password });
                if (signInError) throw signInError;
                router.push(`/${locale}/onboarding`);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-background">
            <div className="w-full max-w-md rounded-2xl border border-border/50 bg-card p-8 shadow-xl">
                {/* Tabs */}
                <div className="mb-6 flex gap-2">
                    <button
                        onClick={() => {
                            setMode("login");
                            setError(null);
                            setMessage(null);
                        }}
                        className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${mode === "login"
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:bg-muted"
                            }`}
                    >
                        {t("login")}
                    </button>
                    <button
                        onClick={() => {
                            setMode("signup");
                            setError(null);
                            setMessage(null);
                        }}
                        className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${mode === "signup"
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:bg-muted"
                            }`}
                    >
                        {t("signup")}
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={tAuth("emailPlaceholder")}
                        required
                        className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-violet-500"
                    />
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={tAuth("passwordPlaceholder")}
                        required
                        minLength={6}
                        className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-violet-500"
                    />

                    {error && (
                        <p className="text-sm text-destructive">{error}</p>
                    )}
                    {message && (
                        <p className="text-sm text-green-600">{message}</p>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                    >
                        {loading
                            ? "..."
                            : mode === "login"
                                ? t("login")
                                : t("signup")}
                    </button>
                </form>
            </div>
        </div>
    );
}
