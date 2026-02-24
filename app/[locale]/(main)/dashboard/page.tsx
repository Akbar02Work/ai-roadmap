import { useTranslations } from "next-intl";

export default function DashboardPage() {
    const t = useTranslations("dashboard");

    return (
        <div className="min-h-screen bg-background p-8">
            <h1 className="text-3xl font-bold">{t("title")}</h1>
            <p className="mt-4 text-muted-foreground">{t("noGoals")}</p>
        </div>
    );
}
