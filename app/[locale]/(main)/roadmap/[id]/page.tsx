"use client";

import { useState, useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";

interface RoadmapNode {
    id: string;
    sort_order: number;
    title: string;
    description: string | null;
    node_type: string;
    est_minutes: number;
    skills: string[];
    status: string;
}

interface RoadmapData {
    id: string;
    goal_id: string;
    version: number;
    status: string;
    roadmap_meta: {
        roadmapTitle?: string;
        summary?: string;
        nodeCount?: number;
    };
    created_at: string;
}

const NODE_TYPE_ICONS: Record<string, string> = {
    lesson: "📖",
    practice: "✍️",
    review: "🔄",
    quiz: "📝",
};

const STATUS_STYLES: Record<string, string> = {
    active: "border-primary bg-primary/5",
    locked: "border-border/50 opacity-60",
    completed: "border-green-500 bg-green-500/5",
    skipped: "border-muted opacity-40",
};

export default function RoadmapPage() {
    const t = useTranslations("roadmap");
    const locale = useLocale();
    const router = useRouter();
    const params = useParams();
    const roadmapId = params.id as string;

    const [roadmap, setRoadmap] = useState<RoadmapData | null>(null);
    const [nodes, setNodes] = useState<RoadmapNode[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function loadRoadmap() {
            let shouldStopLoading = true;
            try {
                const res = await fetch(`/api/roadmap/${roadmapId}`);
                if (res.status === 401) {
                    shouldStopLoading = false;
                    router.replace(`/${locale}/login`);
                    return;
                }

                if (res.status === 403) {
                    setError(t("forbidden"));
                    return;
                }

                if (res.status === 404) {
                    setError(t("notFound"));
                    return;
                }

                if (!res.ok) {
                    setError(t("loadError"));
                    return;
                }

                const data = await res.json();
                setRoadmap(data.roadmap);
                setNodes(data.nodes);
            } catch {
                setError(t("loadError"));
            } finally {
                if (shouldStopLoading) {
                    setLoading(false);
                }
            }
        }

        if (roadmapId) loadRoadmap();
    }, [roadmapId, locale, router, t]);

    if (loading) {
        return (
            <div className="flex min-h-[60vh] items-center justify-center">
                <div className="animate-pulse text-muted-foreground">
                    {t("loading")}
                </div>
            </div>
        );
    }

    if (error || !roadmap) {
        return (
            <div className="flex min-h-[60vh] items-center justify-center">
                <p className="text-destructive">{error ?? t("notFound")}</p>
            </div>
        );
    }

    const meta = roadmap.roadmap_meta;
    const completedCount = nodes.filter((n) => n.status === "completed").length;
    const totalMinutes = nodes.reduce((sum, n) => sum + n.est_minutes, 0);

    return (
        <div className="mx-auto max-w-3xl p-6">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-2xl font-bold">
                    {meta?.roadmapTitle ?? t("title")}
                </h1>
                {meta?.summary && (
                    <p className="mt-2 text-muted-foreground">
                        {meta.summary}
                    </p>
                )}
                <div className="mt-4 flex gap-4 text-sm text-muted-foreground">
                    <span>
                        {t("progress")}: {completedCount}/{nodes.length}
                    </span>
                    <span>
                        {t("totalTime")}: {totalMinutes} min
                    </span>
                    <span>v{roadmap.version}</span>
                </div>

                {/* Progress bar */}
                <div className="mt-3 h-2 rounded-full bg-muted">
                    <div
                        className="h-2 rounded-full bg-primary transition-all duration-500"
                        style={{
                            width: `${nodes.length > 0 ? (completedCount / nodes.length) * 100 : 0}%`,
                        }}
                    />
                </div>
            </div>

            {/* Node list */}
            <div className="space-y-3">
                {nodes.map((node, index) => {
                    const isClickable = node.status === "active" || node.status === "completed";
                    return (
                        <div
                            key={node.id}
                            onClick={() => {
                                if (isClickable) {
                                    router.push(`/${locale}/roadmap/${roadmapId}/node/${node.id}`);
                                }
                            }}
                            className={`rounded-xl border-2 p-4 transition ${STATUS_STYLES[node.status] ?? STATUS_STYLES.locked} ${isClickable ? "cursor-pointer hover:shadow-md" : "cursor-not-allowed"}`}
                        >
                            <div className="flex items-start gap-3">
                                {/* Index + icon */}
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-lg">
                                    {NODE_TYPE_ICONS[node.node_type] ?? "📄"}
                                </div>

                                <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-muted-foreground">
                                            {index + 1}
                                        </span>
                                        <h3 className="font-medium">
                                            {node.title}
                                        </h3>
                                        <span
                                            className={`ml-auto rounded-full px-2 py-0.5 text-xs ${node.status === "completed"
                                                ? "bg-green-500/10 text-green-600"
                                                : node.status === "active"
                                                    ? "bg-primary/10 text-primary"
                                                    : "bg-muted text-muted-foreground"
                                                }`}
                                        >
                                            {t(node.status)}
                                        </span>
                                    </div>

                                    {node.description && (
                                        <p className="mt-1 text-sm text-muted-foreground">
                                            {node.description}
                                        </p>
                                    )}

                                    <div className="mt-2 flex flex-wrap gap-2">
                                        <span className="text-xs text-muted-foreground">
                                            ⏱ {node.est_minutes} min
                                        </span>
                                        {node.skills.map((skill) => (
                                            <span
                                                key={skill}
                                                className="rounded-md bg-muted px-1.5 py-0.5 text-xs"
                                            >
                                                {skill}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
