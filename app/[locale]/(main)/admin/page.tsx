"use client";

import { useState, useEffect, useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

type Tab = "overview" | "users" | "events" | "aiLogs";

interface Overview {
    totals: Record<string, number>;
    recentEvents24h: Record<string, number>;
}

interface UserRow {
    id: string;
    email?: string | null;
    display_name: string | null;
    plan?: string | null;
    created_at: string;
}

interface EventRow {
    id: string;
    user_id: string | null;
    event_type: string;
    payload: Record<string, unknown>;
    created_at: string;
}

interface AiLogRow {
    id: string;
    user_id: string | null;
    task_type: string;
    model: string;
    prompt_version: string | null;
    input_tokens: number | null;
    output_tokens: number | null;
    latency_ms: number | null;
    status: string;
    error_message: string | null;
    created_at: string;
}

export default function AdminPage() {
    const t = useTranslations("admin");
    const tCommon = useTranslations("common");
    const locale = useLocale();
    const router = useRouter();

    const [tab, setTab] = useState<Tab>("overview");
    const [forbidden, setForbidden] = useState(false);
    const [overview, setOverview] = useState<Overview | null>(null);
    const [users, setUsers] = useState<UserRow[]>([]);
    const [events, setEvents] = useState<EventRow[]>([]);
    const [aiLogs, setAiLogs] = useState<AiLogRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    const loadTab = useCallback(async (t: Tab) => {
        setLoading(true);
        setLoadError(null);
        try {
            const endpoint = t === "overview" ? "/api/admin/overview"
                : t === "users" ? "/api/admin/users?limit=50"
                    : t === "events" ? "/api/admin/events?limit=50"
                        : "/api/admin/ai-logs?limit=50";

            const res = await fetch(endpoint);
            if (res.status === 401) { router.push(`/${locale}/login`); return; }
            if (res.status === 403) { setForbidden(true); return; }
            if (!res.ok) {
                let serverMessage = "";
                try {
                    const errData = await res.json() as { error?: string };
                    serverMessage = errData.error ?? "";
                } catch {
                    // ignore non-json errors
                }
                setLoadError(serverMessage || tCommon("error"));
                return;
            }

            const data = await res.json();
            if (t === "overview") setOverview(data);
            else if (t === "users") setUsers(data.users ?? []);
            else if (t === "events") setEvents(data.events ?? []);
            else setAiLogs(data.logs ?? []);
        } catch {
            setLoadError(tCommon("error"));
        } finally {
            setLoading(false);
        }
    }, [locale, router, tCommon]);

    useEffect(() => { loadTab(tab); }, [tab, loadTab]);

    if (forbidden) {
        return (
            <div className="flex min-h-[60vh] items-center justify-center">
                <p className="text-destructive">{t("forbidden")}</p>
            </div>
        );
    }

    const tabs: { key: Tab; label: string }[] = [
        { key: "overview", label: t("tabOverview") },
        { key: "users", label: t("tabUsers") },
        { key: "events", label: t("tabEvents") },
        { key: "aiLogs", label: t("tabAiLogs") },
    ];

    return (
        <div className="mx-auto max-w-5xl p-6">
            <h1 className="text-2xl font-bold">{t("title")}</h1>

            {/* Tabs */}
            <div className="mt-4 flex gap-1 rounded-lg bg-muted p-1">
                {tabs.map((tb) => (
                    <button
                        key={tb.key}
                        onClick={() => setTab(tb.key)}
                        className={`rounded-md px-4 py-2 text-sm font-medium transition ${tab === tb.key
                                ? "bg-background shadow-sm"
                                : "hover:bg-background/50"
                            }`}
                    >
                        {tb.label}
                    </button>
                ))}
            </div>

            {loading && (
                <div className="mt-8 animate-pulse text-center text-muted-foreground">
                    {tCommon("loading")}
                </div>
            )}

            {!loading && loadError && (
                <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {loadError}
                </div>
            )}

            {/* Overview */}
            {!loading && tab === "overview" && overview && (
                <div className="mt-6 space-y-6">
                    <div className="grid grid-cols-5 gap-3">
                        {Object.entries(overview.totals).map(([key, val]) => (
                            <div key={key} className="rounded-xl border border-border/50 bg-card p-4 text-center">
                                <div className="text-2xl font-bold">{val}</div>
                                <div className="text-xs text-muted-foreground capitalize">{key}</div>
                            </div>
                        ))}
                    </div>
                    <div>
                        <h3 className="mb-2 font-medium">{t("events24h")}</h3>
                        {Object.keys(overview.recentEvents24h).length === 0 ? (
                            <p className="text-sm text-muted-foreground">{t("noEvents")}</p>
                        ) : (
                            <div className="space-y-1">
                                {Object.entries(overview.recentEvents24h)
                                    .sort(([, a], [, b]) => b - a)
                                    .map(([type, count]) => (
                                        <div key={type} className="flex justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
                                            <span className="font-mono">{type}</span>
                                            <span className="font-bold">{count}</span>
                                        </div>
                                    ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Users */}
            {!loading && tab === "users" && (
                <div className="mt-6 overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b text-left text-muted-foreground">
                                <th className="pb-2">{t("colEmail")}</th>
                                <th className="pb-2">{t("colPlan")}</th>
                                <th className="pb-2">{t("colCreated")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map((u) => (
                                <tr key={u.id} className="border-b border-border/30">
                                    <td className="py-2">{u.email ?? u.display_name ?? u.id.slice(0, 8)}</td>
                                    <td className="py-2"><span className="rounded bg-muted px-1.5 py-0.5 text-xs">{u.plan ?? "—"}</span></td>
                                    <td className="py-2 text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Events */}
            {!loading && tab === "events" && (
                <div className="mt-6 overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b text-left text-muted-foreground">
                                <th className="pb-2">{t("colType")}</th>
                                <th className="pb-2">{t("colPayload")}</th>
                                <th className="pb-2">{t("colCreated")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {events.map((e) => (
                                <tr key={e.id} className="border-b border-border/30">
                                    <td className="py-2 font-mono text-xs">{e.event_type}</td>
                                    <td className="max-w-xs truncate py-2 text-xs text-muted-foreground">{JSON.stringify(e.payload)}</td>
                                    <td className="py-2 text-muted-foreground">{new Date(e.created_at).toLocaleString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* AI Logs */}
            {!loading && tab === "aiLogs" && (
                <div className="mt-6 overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b text-left text-muted-foreground">
                                <th className="pb-2">{t("colTask")}</th>
                                <th className="pb-2">{t("colModel")}</th>
                                <th className="pb-2">{t("colTokens")}</th>
                                <th className="pb-2">{t("colLatency")}</th>
                                <th className="pb-2">{t("colStatus")}</th>
                                <th className="pb-2">{t("colCreated")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {aiLogs.map((log) => (
                                <tr key={log.id} className="border-b border-border/30">
                                    <td className="py-2 font-mono text-xs">{log.task_type}</td>
                                    <td className="py-2 text-xs">{log.model}</td>
                                    <td className="py-2 text-xs text-muted-foreground">
                                        {log.input_tokens ?? "—"}/{log.output_tokens ?? "—"}
                                    </td>
                                    <td className="py-2 text-xs text-muted-foreground">
                                        {log.latency_ms ? `${log.latency_ms}ms` : "—"}
                                    </td>
                                    <td className="py-2">
                                        <span className={`rounded px-1.5 py-0.5 text-xs ${log.status === "success" ? "bg-green-500/10 text-green-600"
                                                : log.status === "error" ? "bg-red-500/10 text-red-600"
                                                    : "bg-muted text-muted-foreground"
                                            }`}>{log.status}</span>
                                    </td>
                                    <td className="py-2 text-muted-foreground">{new Date(log.created_at).toLocaleString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
