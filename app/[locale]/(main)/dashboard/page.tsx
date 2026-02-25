"use client";

import { useState, useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

interface GoalRow {
    id: string;
    title: string;
    category: string;
    cefr_level: string | null;
    status: string;
    created_at: string;
}

interface RoadmapRow {
    id: string;
    goal_id: string;
    status: string;
    version: number;
    roadmap_meta: { roadmapTitle?: string; nodeCount?: number };
}

export default function DashboardPage() {
    const t = useTranslations("dashboard");
    const tCommon = useTranslations("common");
    const locale = useLocale();
    const router = useRouter();

    const [goals, setGoals] = useState<GoalRow[]>([]);
    const [roadmaps, setRoadmaps] = useState<RoadmapRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState<string | null>(null);

    useEffect(() => {
        async function load() {
            try {
                const res = await fetch("/api/dashboard");
                if (res.status === 401) {
                    router.push(`/${locale}/login`);
                    return;
                }
                if (!res.ok) return;
                const data = await res.json();
                setGoals(data.goals ?? []);
                setRoadmaps(data.roadmaps ?? []);
            } catch {
                // silent
            } finally {
                setLoading(false);
            }
        }

        load();
    }, [locale, router]);

    async function handleGenerate(goalId: string) {
        setGenerating(goalId);
        try {
            const res = await fetch("/api/roadmap/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ goalId }),
            });
            if (!res.ok) throw new Error("Failed to generate");
            const data = await res.json();
            router.push(`/${locale}/roadmap/${data.roadmapId}`);
        } catch {
            setGenerating(null);
        }
    }

    function getActiveRoadmap(goalId: string): RoadmapRow | undefined {
        return roadmaps.find(
            (r) => r.goal_id === goalId && r.status === "active"
        );
    }

    if (loading) {
        return (
            <div className="flex min-h-[60vh] items-center justify-center">
                <div className="animate-pulse text-muted-foreground">
                    {tCommon("loading")}
                </div>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-3xl p-8">
            <h1 className="text-3xl font-bold">{t("title")}</h1>

            {goals.length === 0 ? (
                <div className="mt-8 rounded-2xl border border-border/50 bg-muted/30 p-8 text-center">
                    <p className="text-muted-foreground">{t("noGoals")}</p>
                    <button
                        onClick={() => router.push(`/${locale}/onboarding`)}
                        className="mt-4 rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                    >
                        {t("createGoal")}
                    </button>
                </div>
            ) : (
                <div className="mt-6 space-y-4">
                    {goals.map((goal) => {
                        const activeRoadmap = getActiveRoadmap(goal.id);

                        return (
                            <div
                                key={goal.id}
                                className="rounded-xl border border-border/50 bg-card p-5"
                            >
                                <div className="flex items-start justify-between">
                                    <div>
                                        <h2 className="font-semibold">
                                            {goal.title}
                                        </h2>
                                        <div className="mt-1 flex gap-2 text-xs text-muted-foreground">
                                            <span>{goal.category}</span>
                                            {goal.cefr_level && (
                                                <span className="rounded bg-muted px-1.5 py-0.5">
                                                    CEFR: {goal.cefr_level}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <span
                                        className={`rounded-full px-2 py-0.5 text-xs ${goal.status === "active"
                                                ? "bg-primary/10 text-primary"
                                                : "bg-muted text-muted-foreground"
                                            }`}
                                    >
                                        {goal.status}
                                    </span>
                                </div>

                                <div className="mt-4 flex gap-2">
                                    {activeRoadmap ? (
                                        <button
                                            onClick={() =>
                                                router.push(
                                                    `/${locale}/roadmap/${activeRoadmap.id}`
                                                )
                                            }
                                            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                                        >
                                            {t("viewRoadmap")}
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() =>
                                                handleGenerate(goal.id)
                                            }
                                            disabled={
                                                generating === goal.id ||
                                                !goal.cefr_level
                                            }
                                            title={
                                                !goal.cefr_level
                                                    ? t("needsDiagnosis")
                                                    : undefined
                                            }
                                            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                                        >
                                            {generating === goal.id
                                                ? "..."
                                                : t("generateRoadmap")}
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
