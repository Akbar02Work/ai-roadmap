import { useTranslations } from "next-intl";

export default function BillingPage() {
    const t = useTranslations("landing.pricing");

    return (
        <div className="min-h-screen bg-background p-8">
            <h1 className="text-3xl font-bold">{t("title")}</h1>
            <p className="mt-4 text-muted-foreground">
                Stripe billing integration will be implemented in Phase 7.
            </p>
        </div>
    );
}
