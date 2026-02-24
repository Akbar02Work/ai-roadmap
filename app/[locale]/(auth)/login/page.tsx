import { useTranslations } from "next-intl";

export default function LoginPage() {
    const t = useTranslations("nav");

    return (
        <div className="flex min-h-screen items-center justify-center bg-background">
            <div className="w-full max-w-md rounded-2xl border border-border/50 bg-card p-8 shadow-xl">
                <h1 className="mb-6 text-center text-2xl font-bold">{t("login")}</h1>
                <p className="text-center text-muted-foreground">
                    Auth will be connected to Supabase here.
                </p>
            </div>
        </div>
    );
}
