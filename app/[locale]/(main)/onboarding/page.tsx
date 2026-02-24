"use client";

import { useTranslations } from "next-intl";

export default function OnboardingPage() {
    const t = useTranslations("onboarding");

    return (
        <div className="flex min-h-screen flex-col bg-background">
            <header className="border-b border-border/40 px-6 py-4">
                <h1 className="text-xl font-bold">{t("title")}</h1>
            </header>
            <div className="flex flex-1 flex-col justify-end p-6">
                <div className="mx-auto w-full max-w-2xl">
                    <p className="mb-4 text-center text-muted-foreground">
                        Chat onboarding will be implemented in Phase 3.
                    </p>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            placeholder={t("placeholder")}
                            className="flex-1 rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:border-violet-500"
                            disabled
                        />
                        <button
                            className="rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground opacity-50"
                            disabled
                        >
                            {t("send")}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
