"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";

interface BillingStatus {
    plan: string;
    status: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
}

const PLANS = [
    { key: "free", price: 0 },
    { key: "starter", price: 9 },
    { key: "pro", price: 29 },
    { key: "unlimited", price: 79 },
] as const;

export default function BillingPage() {
    const t = useTranslations("billing");
    const tp = useTranslations("landing.pricing");
    const params = useParams();
    const locale = (params?.locale as string) || "en";

    const [status, setStatus] = useState<BillingStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);

    // Check URL params for success/cancel status
    useEffect(() => {
        if (typeof window !== "undefined") {
            const urlParams = new URLSearchParams(window.location.search);
            const s = urlParams.get("status");
            if (s === "success") {
                setSuccessMsg(t("checkoutSuccess"));
                // Clean up URL
                window.history.replaceState({}, "", window.location.pathname);
            } else if (s === "cancel") {
                setError(t("checkoutCancelled"));
                window.history.replaceState({}, "", window.location.pathname);
            }
        }
    }, [t]);

    const fetchStatus = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch("/api/billing/status");
            if (!res.ok) throw new Error("Failed to load billing status");
            const data = await res.json();
            setStatus(data);
        } catch {
            setError(t("loadError"));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        fetchStatus();
    }, [fetchStatus]);

    const handleUpgrade = async (plan: string) => {
        try {
            setCheckoutLoading(plan);
            setError(null);
            const res = await fetch("/api/billing/checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ plan, locale }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Checkout failed");
            if (data.url) {
                window.location.href = data.url;
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : t("checkoutError"));
            setCheckoutLoading(null);
        }
    };

    if (loading) {
        return (
            <div className="flex min-h-[60vh] items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-4xl px-6 py-10">
            <h1 className="text-3xl font-bold">{t("title")}</h1>

            {/* Current plan badge */}
            {status && (
                <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary">
                    {t("currentPlan")}: {tp(status.plan)}
                    {status.status !== "active" && (
                        <span className="rounded bg-yellow-500/20 px-2 py-0.5 text-xs text-yellow-700 dark:text-yellow-300">
                            {status.status}
                        </span>
                    )}
                </div>
            )}

            {status?.currentPeriodEnd && (
                <p className="mt-2 text-sm text-muted-foreground">
                    {t("periodEnd", {
                        date: new Date(status.currentPeriodEnd).toLocaleDateString(locale),
                    })}
                </p>
            )}

            {/* Success / Error messages */}
            {successMsg && (
                <div className="mt-4 rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
                    {successMsg}
                </div>
            )}
            {error && (
                <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    {error}
                </div>
            )}

            {/* Plan cards */}
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                {PLANS.map(({ key, price }) => {
                    const isCurrent = status?.plan === key;
                    const isDowngrade =
                        !isCurrent &&
                        PLANS.findIndex((p) => p.key === status?.plan) >=
                        PLANS.findIndex((p) => p.key === key);

                    return (
                        <div
                            key={key}
                            className={`relative flex flex-col rounded-2xl border p-6 transition ${isCurrent
                                    ? "border-primary bg-primary/5 shadow-lg shadow-primary/10"
                                    : "border-border/50 bg-card hover:border-border"
                                }`}
                        >
                            <h3 className="text-lg font-semibold">{tp(key)}</h3>
                            <p className="mt-2 text-3xl font-bold">
                                {price === 0 ? t("free") : `$${price}`}
                                {price > 0 && (
                                    <span className="text-base font-normal text-muted-foreground">
                                        {tp("perMonth")}
                                    </span>
                                )}
                            </p>

                            {/* Features */}
                            <ul className="mt-4 flex-1 space-y-2 text-sm text-muted-foreground">
                                {(
                                    t.raw(`features.${key}`) as string[]
                                ).map((f: string, i: number) => (
                                    <li key={i} className="flex items-start gap-2">
                                        <span className="mt-0.5 text-primary">✓</span>
                                        {f}
                                    </li>
                                ))}
                            </ul>

                            {/* CTA button */}
                            <div className="mt-6">
                                {isCurrent ? (
                                    <button
                                        disabled
                                        className="w-full rounded-xl bg-primary/20 px-4 py-2.5 text-sm font-medium text-primary"
                                    >
                                        {tp("currentPlan")}
                                    </button>
                                ) : key === "free" || isDowngrade ? (
                                    <button
                                        disabled
                                        className="w-full rounded-xl bg-muted px-4 py-2.5 text-sm font-medium text-muted-foreground"
                                    >
                                        {isDowngrade ? t("downgradeNA") : tp("currentPlan")}
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => handleUpgrade(key)}
                                        disabled={checkoutLoading !== null}
                                        className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                                    >
                                        {checkoutLoading === key
                                            ? t("redirecting")
                                            : tp("upgrade")}
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
