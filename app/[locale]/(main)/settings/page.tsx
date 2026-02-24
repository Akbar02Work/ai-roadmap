import { useTranslations } from "next-intl";

export default function SettingsPage() {
    const t = useTranslations("settings");

    return (
        <div className="min-h-screen bg-background p-8">
            <h1 className="text-3xl font-bold">{t("title")}</h1>
            <div className="mt-8 space-y-6">
                <div className="rounded-xl border border-border/50 bg-card p-6">
                    <h2 className="text-lg font-semibold">{t("language")}</h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                        Language switcher will be implemented here.
                    </p>
                </div>
                <div className="rounded-xl border border-border/50 bg-card p-6">
                    <h2 className="text-lg font-semibold">{t("profile")}</h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                        Profile settings will be implemented here.
                    </p>
                </div>
            </div>
        </div>
    );
}
