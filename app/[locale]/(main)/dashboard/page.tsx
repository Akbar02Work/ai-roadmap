"use client";

import { useState, useEffect, useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
    clearRoadmapIdempotencyKey,
    getOrCreateRoadmapIdempotencyKey,
} from "@/lib/roadmap/idempotency";

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

interface ProgressSummary {
    todayMinutes: number;
    weekMinutes: number;
    streakCurrent: number;
    streakBest: number;
    series: Array<{ day: string; minutes: number; nodesCompleted: number }>;
}

interface DueReviewNode {
    id: string;
    title: string;
    sort_order: number;
}

export default function DashboardPage() {
    const t = useTranslations("dashboard");
    const tCommon = useTranslations("common");
    const locale = useLocale();
    const router = useRouter();

    const [goals, setGoals] = useState<GoalRow[]>([]);
    const [roadmaps, setRoadmaps] = useState<RoadmapRow[]>([]);
    const [progress, setProgress] = useState<Record<string, ProgressSummary>>({});
    const [dueReviews, setDueReviews] = useState<Record<string, DueReviewNode[]>>({});
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState<string | null>(null);
    const [logging, setLogging] = useState<string | null>(null);

    const loadProgress = useCallback(async (goalId: string) => {
        try {
            const res = await fetch(`/api/progress/summary?goalId=${goalId}`);
            if (res.ok) {
                const data = await res.json();
                setProgress((prev) => ({ ...prev, [goalId]: data }));
            }
        } catch {
            // silent — progress API may not be available (migration missing)
        }
    }, []);

    const loadDueReviews = useCallback(async (goalId: string) => {
        try {
            const res = await fetch(`/api/reviews/due?goalId=${goalId}`);
            if (res.ok) {
                const data = await res.json();
                setDueReviews((prev) => ({ ...prev, [goalId]: data.nodes ?? [] }));
            }
        } catch {
            // silent
        }
    }, []);

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
                const loadedGoals: GoalRow[] = data.goals ?? [];
                setGoals(loadedGoals);
                setRoadmaps(data.roadmaps ?? []);

                // Load progress + reviews for each goal
                for (const g of loadedGoals) {
                    loadProgress(g.id);
                    loadDueReviews(g.id);
                }
            } catch {
                // silent
            } finally {
                setLoading(false);
            }
        }

        load();
    }, [locale, router, loadProgress, loadDueReviews]);

    async function handleGenerate(goalId: string) {
        setGenerating(goalId);
        try {
            const idempotencyKey = getOrCreateRoadmapIdempotencyKey(goalId);
            const res = await fetch("/api/roadmap/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ goalId, idempotencyKey }),
            });
            if (!res.ok) throw new Error("Failed to generate");
            const data = await res.json();
            if (res.status === 200 || res.status === 201) {
                clearRoadmapIdempotencyKey(goalId);
            }
            router.push(`/${locale}/roadmap/${data.roadmapId}`);
        } catch {
            setGenerating(null);
        }
    }

    async function handleLogMinutes(goalId: string, minutes: number) {
        setLogging(goalId);
        try {
            const res = await fetch("/api/progress/log", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ goalId, minutes }),
            });
            if (res.ok) {
                const data = await res.json();
                setProgress((prev) => ({
                    ...prev,
                    [goalId]: {
                        ...prev[goalId],
                        todayMinutes: data.todayMinutes,
                        weekMinutes: data.weekMinutes,
                        streakCurrent: data.streakCurrent,
                        streakBest: data.streakBest,
                    },
                }));
            }
        } catch {
            // silent
        } finally {
            setLogging(null);
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
                <div className="mt-6 space-y-6">
                    {goals.map((goal) => {
                        const activeRoadmap = getActiveRoadmap(goal.id);
                        const prog = progress[goal.id];
                        const due = dueReviews[goal.id] ?? [];

                        return (
                            <div
                                key={goal.id}
                                className="rounded-xl border border-border/50 bg-card p-5"
                            >
                                {/* Header */}
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

                                {/* Progress stats */}
                                <div className="mt-4 grid grid-cols-4 gap-3">
                                    <div className="rounded-lg bg-muted/50 p-3 text-center">
                                        <div className="text-2xl font-bold">
                                            {prog ? (
                                                `🔥 ${prog.streakCurrent}`
                                            ) : (
                                                <span className="animate-pulse text-muted-foreground">...</span>
                                            )}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            {t("streak")}
                                        </div>
                                    </div>
                                    <div className="rounded-lg bg-muted/50 p-3 text-center">
                                        <div className="text-2xl font-bold">
                                            {prog ? (
                                                `⭐ ${prog.streakBest}`
                                            ) : (
                                                <span className="animate-pulse text-muted-foreground">...</span>
                                            )}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            {t("bestStreak")}
                                        </div>
                                    </div>
                                    <div className="rounded-lg bg-muted/50 p-3 text-center">
                                        <div className="text-2xl font-bold">
                                            {prog ? (
                                                prog.todayMinutes
                                            ) : (
                                                <span className="animate-pulse text-muted-foreground">...</span>
                                            )}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            {t("todayMin")}
                                        </div>
                                    </div>
                                    <div className="rounded-lg bg-muted/50 p-3 text-center">
                                        <div className="text-2xl font-bold">
                                            {prog ? (
                                                prog.weekMinutes
                                            ) : (
                                                <span className="animate-pulse text-muted-foreground">...</span>
                                            )}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            {t("weekMin")}
                                        </div>
                                    </div>
                                </div>

                                {/* Mini history chart (7-day bars) */}
                                <div className="mt-3 flex items-end gap-1">
                                    {(prog?.series ??
                                        Array.from({ length: 7 }, (_, i) => ({
                                            day: String(i),
                                            minutes: 0,
                                            nodesCompleted: 0,
                                        }))).map((d) => {
                                        if (!prog?.series) {
                                            return (
                                                <div
                                                    key={d.day}
                                                    className="flex flex-1 flex-col items-center"
                                                >
                                                    <div
                                                        className="w-full animate-pulse rounded-sm bg-muted"
                                                        style={{
                                                            height: "22px",
                                                            minHeight: "4px",
                                                            maxHeight: "40px",
                                                        }}
                                                    />
                                                    <span className="mt-1 text-[10px] text-muted-foreground">
                                                        {" "}
                                                    </span>
                                                </div>
                                            );
                                        }

                                        const maxMin = Math.max(
                                            ...prog.series.map((s) => s.minutes),
                                            10
                                        );
                                        const heightPct = Math.max(
                                            (d.minutes / maxMin) * 100,
                                            4
                                        );
                                        const dayLabel = new Date(d.day + "T00:00:00").toLocaleDateString(
                                            locale,
                                            { weekday: "narrow" }
                                        );

                                        return (
                                            <div
                                                key={d.day}
                                                className="flex flex-1 flex-col items-center"
                                            >
                                                <div
                                                    className={`w-full rounded-sm transition-all ${d.minutes >= 10 || d.nodesCompleted > 0
                                                            ? "bg-primary"
                                                            : d.minutes > 0
                                                                ? "bg-primary/40"
                                                                : "bg-muted"
                                                        }`}
                                                    style={{
                                                        height: `${heightPct}%`,
                                                        minHeight: "4px",
                                                        maxHeight: "40px",
                                                    }}
                                                    title={t("chartTooltip", {
                                                        day: d.day,
                                                        minutes: d.minutes,
                                                    })}
                                                />
                                                <span className="mt-1 text-[10px] text-muted-foreground">
                                                    {dayLabel}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Action buttons */}
                                <div className="mt-4 flex flex-wrap gap-2">
                                    {activeRoadmap ? (
                                        <>
                                            <button
                                                onClick={() =>
                                                    router.push(
                                                        `/${locale}/roadmap/${activeRoadmap.id}`
                                                    )
                                                }
                                                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                                            >
                                                {t("continue")}
                                            </button>
                                            {due.length > 0 && (
                                                <button
                                                    onClick={() =>
                                                        router.push(
                                                            `/${locale}/roadmap/${activeRoadmap.id}/node/${due[0].id}`
                                                        )
                                                    }
                                                    className="rounded-lg border border-primary bg-primary/10 px-4 py-2 text-sm font-medium text-primary transition hover:bg-primary/20"
                                                >
                                                    {t("reviewDue", {
                                                        count: due.length,
                                                    })}
                                                </button>
                                            )}
                                        </>
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
                                                ? tCommon("loading")
                                                : t("generateRoadmap")}
                                        </button>
                                    )}

                                    {/* Log 10 min button */}
                                    {activeRoadmap && (
                                        <button
                                            onClick={() =>
                                                handleLogMinutes(goal.id, 10)
                                            }
                                            disabled={logging === goal.id}
                                            className="rounded-lg border border-border px-4 py-2 text-sm transition hover:bg-muted disabled:opacity-50"
                                        >
                                            {logging === goal.id
                                                ? tCommon("loading")
                                                : t("logMinutes")}
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
