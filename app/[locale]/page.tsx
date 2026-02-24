"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function LandingPage() {
    const t = useTranslations("landing");
    const nav = useTranslations("nav");

    return (
        <div className="min-h-screen bg-background">
            {/* Navigation */}
            <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
                <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
                    <div className="text-xl font-bold tracking-tight">
                        <span className="bg-gradient-to-r from-violet-500 to-indigo-500 bg-clip-text text-transparent">
                            AI Roadmap
                        </span>
                    </div>
                    <div className="flex items-center gap-4">
                        <Link
                            href="/login"
                            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                        >
                            {nav("login")}
                        </Link>
                        <Link
                            href="/onboarding"
                            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-all hover:opacity-90"
                        >
                            {t("hero.cta")}
                        </Link>
                    </div>
                </nav>
            </header>

            {/* Hero Section */}
            <section className="relative overflow-hidden px-6 py-24 sm:py-32 lg:py-40">
                <div className="absolute inset-0 -z-10">
                    <div className="absolute left-1/2 top-0 -translate-x-1/2 transform">
                        <div className="h-[500px] w-[800px] rounded-full bg-gradient-to-r from-violet-500/20 to-indigo-500/20 blur-3xl" />
                    </div>
                </div>
                <div className="mx-auto max-w-3xl text-center">
                    <h1 className="text-4xl font-bold tracking-tight sm:text-6xl lg:text-7xl">
                        <span className="bg-gradient-to-r from-violet-500 via-indigo-500 to-cyan-500 bg-clip-text text-transparent">
                            {t("hero.title")}
                        </span>
                    </h1>
                    <p className="mt-6 text-lg leading-8 text-muted-foreground sm:text-xl">
                        {t("hero.subtitle")}
                    </p>
                    <div className="mt-10 flex items-center justify-center gap-4">
                        <Link
                            href="/onboarding"
                            className="rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-8 py-3 text-lg font-semibold text-white shadow-lg shadow-violet-500/25 transition-all hover:shadow-xl hover:shadow-violet-500/30 hover:brightness-110"
                        >
                            {t("hero.cta")}
                        </Link>
                    </div>
                </div>
            </section>

            {/* Features Section */}
            <section className="mx-auto max-w-7xl px-6 py-24">
                <h2 className="mb-16 text-center text-3xl font-bold sm:text-4xl">
                    {t("features.title")}
                </h2>
                <div className="grid gap-8 sm:grid-cols-3">
                    {(["step1", "step2", "step3"] as const).map((step, i) => (
                        <div
                            key={step}
                            className="group relative rounded-2xl border border-border/50 bg-card p-8 transition-all hover:border-violet-500/30 hover:shadow-lg hover:shadow-violet-500/5"
                        >
                            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-r from-violet-500 to-indigo-500 text-lg font-bold text-white">
                                {i + 1}
                            </div>
                            <h3 className="mb-2 text-xl font-semibold">
                                {t(`features.${step}.title`)}
                            </h3>
                            <p className="text-muted-foreground">
                                {t(`features.${step}.description`)}
                            </p>
                        </div>
                    ))}
                </div>
            </section>

            {/* Footer */}
            <footer className="border-t border-border/40 px-6 py-12">
                <div className="mx-auto max-w-7xl text-center text-sm text-muted-foreground">
                    © {new Date().getFullYear()} AI Roadmap. All rights reserved.
                </div>
            </footer>
        </div>
    );
}
