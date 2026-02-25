"use client";

import { useState, useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";

interface QuizQuestion {
    prompt: string;
    options: string[];
}

interface NodeData {
    id: string;
    roadmap_id: string;
    title: string;
    description: string | null;
    node_type: string;
    skills: string[];
    est_minutes: number;
    status: string;
    content: { quiz?: { questions: QuizQuestion[] } };
}

export default function NodePage() {
    const t = useTranslations("node");
    const tCommon = useTranslations("common");
    const locale = useLocale();
    const router = useRouter();
    const params = useParams();
    const roadmapId = params.id as string;
    const nodeId = params.nodeId as string;

    const [node, setNode] = useState<NodeData | null>(null);
    const [quiz, setQuiz] = useState<QuizQuestion[] | null>(null);
    const [answers, setAnswers] = useState<(number | null)[]>([]);
    const [report, setReport] = useState("");
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<{
        score: number;
        passed: boolean;
        correct: number;
        total: number;
    } | null>(null);
    const roadmapPath = `/${locale}/roadmap/${roadmapId}`;

    function goToRoadmap() {
        router.push(roadmapPath);
        // Ensure destination route reloads fresh statuses after attempt submit.
        setTimeout(() => {
            router.refresh();
        }, 0);
    }

    // Load node
    useEffect(() => {
        async function load() {
            let shouldStopLoading = true;
            try {
                const res = await fetch(`/api/nodes/${nodeId}`);
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
                if (!data?.node || data.node.roadmap_id !== roadmapId) {
                    setError(t("notFound"));
                    return;
                }

                setNode(data.node);

                // Check if quiz already exists
                const existingQuiz = data.node?.content?.quiz;
                if (existingQuiz?.questions) {
                    setQuiz(existingQuiz.questions);
                    setAnswers(new Array(existingQuiz.questions.length).fill(null));
                }
            } catch {
                setError(t("loadError"));
            } finally {
                if (shouldStopLoading) {
                    setLoading(false);
                }
            }
        }

        if (nodeId && roadmapId) load();
    }, [nodeId, roadmapId, locale, router, t]);

    async function handleGenerateQuiz() {
        setGenerating(true);
        setError(null);
        try {
            const res = await fetch(`/api/nodes/${nodeId}/quiz`, {
                method: "POST",
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error ?? t("generateError"));
            }
            const data = await res.json();
            const questions = data.quiz.questions;
            setQuiz(questions);
            setAnswers(new Array(questions.length).fill(null));
        } catch (err) {
            setError(err instanceof Error ? err.message : t("generateError"));
        } finally {
            setGenerating(false);
        }
    }

    async function handleSubmit() {
        if (!quiz || answers.some((a) => a === null)) return;
        setSubmitting(true);
        setError(null);
        try {
            const res = await fetch(`/api/nodes/${nodeId}/attempt`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    answers: answers as number[],
                    report,
                }),
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error ?? t("submitError"));
            }
            const data = await res.json();
            setResult(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : t("submitError"));
        } finally {
            setSubmitting(false);
        }
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

    if (error && !node) {
        return (
            <div className="flex min-h-[60vh] items-center justify-center">
                <p className="text-destructive">{error}</p>
            </div>
        );
    }

    if (!node) return null;

    const allAnswered = quiz ? answers.every((a) => a !== null) : false;

    return (
        <div className="mx-auto max-w-3xl p-6">
            {/* Header */}
            <div className="mb-6">
                <button
                    onClick={goToRoadmap}
                    className="mb-4 text-sm text-muted-foreground transition hover:text-foreground"
                >
                    ← {t("backToRoadmap")}
                </button>
                <h1 className="text-2xl font-bold">{node.title}</h1>
                {node.description && (
                    <p className="mt-2 text-muted-foreground">
                        {node.description}
                    </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                    {node.skills.map((skill) => (
                        <span
                            key={skill}
                            className="rounded-md bg-muted px-2 py-1 text-xs"
                        >
                            {skill}
                        </span>
                    ))}
                    <span className="text-xs text-muted-foreground">
                        ⏱ {node.est_minutes} min
                    </span>
                </div>
            </div>

            {/* Result (after submission) */}
            {result && (
                <div className="mb-6 rounded-xl border-2 border-primary/30 bg-primary/5 p-6 text-center">
                    <div className="text-4xl">
                        {result.passed ? "✅" : "❌"}
                    </div>
                    <h2 className="mt-2 text-xl font-bold">
                        {result.passed ? t("passed") : t("failed")}
                    </h2>
                    <p className="mt-1 text-muted-foreground">
                        {t("scoreText", {
                            correct: result.correct,
                            total: result.total,
                            pct: Math.round(result.score * 100),
                        })}
                    </p>
                    <button
                        onClick={goToRoadmap}
                        className="mt-4 rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                    >
                        {t("backToRoadmap")}
                    </button>
                </div>
            )}

            {/* No quiz yet */}
            {!quiz && !result && (
                <div className="rounded-xl border border-border/50 bg-card p-8 text-center">
                    <p className="text-muted-foreground">
                        {t("noQuizYet")}
                    </p>
                    <button
                        onClick={handleGenerateQuiz}
                        disabled={generating}
                        className="mt-4 rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                    >
                        {generating ? t("generatingQuiz") : t("generateQuiz")}
                    </button>
                </div>
            )}

            {/* Quiz */}
            {quiz && !result && (
                <div className="space-y-6">
                    {quiz.map((q, qIdx) => (
                        <div
                            key={qIdx}
                            className="rounded-xl border border-border/50 bg-card p-5"
                        >
                            <p className="mb-3 font-medium">
                                <span className="text-muted-foreground">
                                    {qIdx + 1}.{" "}
                                </span>
                                {q.prompt}
                            </p>
                            <div className="space-y-2">
                                {q.options.map((opt, optIdx) => (
                                    <button
                                        key={optIdx}
                                        onClick={() => {
                                            const newAnswers = [...answers];
                                            newAnswers[qIdx] = optIdx;
                                            setAnswers(newAnswers);
                                        }}
                                        className={`w-full rounded-lg border px-4 py-2.5 text-left text-sm transition ${answers[qIdx] === optIdx
                                                ? "border-primary bg-primary/10 font-medium"
                                                : "border-border hover:border-primary/50"
                                            }`}
                                    >
                                        {opt}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}

                    {/* Report */}
                    <div className="rounded-xl border border-border/50 bg-card p-5">
                        <label className="mb-2 block text-sm font-medium">
                            {t("reportLabel")}
                        </label>
                        <textarea
                            value={report}
                            onChange={(e) => setReport(e.target.value)}
                            placeholder={t("reportPlaceholder")}
                            rows={3}
                            className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm outline-none focus:border-violet-500"
                        />
                    </div>

                    {error && (
                        <p className="text-sm text-destructive">{error}</p>
                    )}

                    {/* Submit */}
                    <button
                        onClick={handleSubmit}
                        disabled={!allAnswered || submitting}
                        className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                    >
                        {submitting ? "..." : t("submit")}
                    </button>
                </div>
            )}
        </div>
    );
}
