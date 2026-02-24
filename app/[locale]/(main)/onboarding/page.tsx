"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";

// --- Types ---

interface ChatMessage {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    metadata?: Record<string, unknown>;
    created_at: string;
}

interface DiagnosticQuestion {
    question: string;
    type: "multiple_choice" | "translation" | "fill_blank";
    options: string[] | null;
    cefrTarget: string;
}

type Phase = "loading" | "chat" | "diagnostic" | "done";

// --- Storage helpers ---

const STORAGE_KEY = "onboarding_session";

function getSavedSession(): {
    sessionId: string;
    goalId: string;
} | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function saveSession(sessionId: string, goalId: string) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId, goalId }));
}

// --- Component ---

export default function OnboardingPage() {
    const t = useTranslations("onboarding");
    const locale = useLocale();

    const [phase, setPhase] = useState<Phase>("loading");
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [goalId, setGoalId] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Diagnostic state
    const [questions, setQuestions] = useState<DiagnosticQuestion[]>([]);
    const [answers, setAnswers] = useState<string[]>([]);
    const [currentQ, setCurrentQ] = useState(0);
    const [cefrResult, setCefrResult] = useState<{
        level: string;
        explanation: string;
    } | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Auto-scroll
    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages, scrollToBottom]);

    // --- Initialize session ---

    useEffect(() => {
        async function init() {
            const saved = getSavedSession();
            if (saved) {
                // Try to restore existing session
                try {
                    const res = await fetch(
                        `/api/onboarding/session?sessionId=${saved.sessionId}`
                    );
                    if (res.ok) {
                        const data = await res.json();
                        setSessionId(saved.sessionId);
                        setGoalId(saved.goalId);
                        setMessages(data.messages ?? []);

                        // Check if session is completed
                        if (data.session?.status === "completed") {
                            // Check if we have CEFR result in goal
                            setPhase("done");
                        } else {
                            // Check if last message suggests diagnostic
                            const lastAssistant = (
                                data.messages as ChatMessage[]
                            )
                                ?.filter(
                                    (m: ChatMessage) =>
                                        m.role === "assistant"
                                )
                                .pop();
                            const meta = lastAssistant?.metadata as Record<
                                string,
                                unknown
                            > | undefined;
                            if (
                                meta?.nextAction ===
                                "start_diagnostic"
                            ) {
                                setPhase("diagnostic");
                                startDiagnostic(saved.goalId);
                            } else {
                                setPhase("chat");
                            }
                        }
                        return;
                    }
                } catch {
                    // Session not found, create new one
                }
            }

            // Create new session
            try {
                const res = await fetch("/api/onboarding/start", {
                    method: "POST",
                });
                if (res.status === 401) {
                    // Not authenticated — redirect to login
                    window.location.href = `/${locale}/login`;
                    return;
                }
                if (!res.ok) throw new Error("Failed to start session");
                const data = await res.json();
                setSessionId(data.sessionId);
                setGoalId(data.goalId);
                saveSession(data.sessionId, data.goalId);
                setPhase("chat");
            } catch {
                setError(t("initError"));
                setPhase("chat");
            }
        }

        init();
    }, [locale]);

    // --- Send message ---

    async function sendMessage() {
        if (!input.trim() || !sessionId || isLoading) return;

        const userMessage = input.trim();
        setInput("");
        setError(null);
        setIsLoading(true);

        // Optimistic add
        const tempId = `temp-${Date.now()}`;
        setMessages((prev) => [
            ...prev,
            {
                id: tempId,
                role: "user",
                content: userMessage,
                created_at: new Date().toISOString(),
            },
        ]);

        try {
            const res = await fetch("/api/onboarding/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sessionId,
                    message: userMessage,
                }),
            });

            if (res.status === 401) {
                setError(t("sessionExpired"));
                setIsLoading(false);
                return;
            }

            if (!res.ok) {
                throw new Error("Chat request failed");
            }

            const data = await res.json();
            setMessages(data.messages);

            if (data.nextAction === "start_diagnostic") {
                // Transition to diagnostic phase
                setTimeout(() => {
                    setPhase("diagnostic");
                    if (goalId) startDiagnostic(goalId);
                }, 1500);
            }
        } catch {
            setError(t("errorSending"));
            // Remove optimistic message
            setMessages((prev) => prev.filter((m) => m.id !== tempId));
        } finally {
            setIsLoading(false);
            inputRef.current?.focus();
        }
    }

    // --- Diagnostic ---

    async function startDiagnostic(gId: string) {
        setIsLoading(true);
        try {
            const res = await fetch("/api/onboarding/diagnose/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ goalId: gId }),
            });
            if (!res.ok) throw new Error("Failed to generate questions");
            const data = await res.json();
            setQuestions(data.questions);
            setAnswers(new Array(data.questions.length).fill(""));
            setCurrentQ(0);
        } catch {
            setError(t("diagnosticStartError"));
        } finally {
            setIsLoading(false);
        }
    }

    async function submitDiagnostic() {
        if (!goalId || !sessionId) return;
        setIsLoading(true);
        try {
            const res = await fetch("/api/onboarding/diagnose/submit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    goalId,
                    sessionId,
                    questions,
                    answers,
                }),
            });
            if (!res.ok) throw new Error("Failed to submit answers");
            const data = await res.json();
            setCefrResult({
                level: data.cefrLevel,
                explanation: data.explanation,
            });
            setPhase("done");
        } catch {
            setError(t("diagnosticSubmitError"));
        } finally {
            setIsLoading(false);
        }
    }

    // --- Key handler ---

    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    }

    // --- Render ---

    return (
        <div className="flex min-h-screen flex-col bg-background">
            {/* Header */}
            <header className="border-b border-border/40 px-6 py-4">
                <h1 className="text-xl font-bold">{t("title")}</h1>
            </header>

            {/* Main content */}
            <div className="flex flex-1 flex-col">
                {phase === "loading" && (
                    <div className="flex flex-1 items-center justify-center">
                        <div className="animate-pulse text-muted-foreground">
                            {t("loading")}
                        </div>
                    </div>
                )}

                {/* Chat phase */}
                {(phase === "chat" || (phase === "diagnostic" && questions.length === 0)) && (
                    <>
                        {/* Messages list */}
                        <div className="flex-1 overflow-y-auto p-6">
                            <div className="mx-auto max-w-2xl space-y-4">
                                {messages.length === 0 && !isLoading && (
                                    <div className="rounded-2xl bg-muted/50 p-4 text-sm text-muted-foreground">
                                        {t("welcome")}
                                    </div>
                                )}
                                {messages.map((msg) => (
                                    <div
                                        key={msg.id}
                                        className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                                    >
                                        <div
                                            className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${msg.role === "user"
                                                    ? "bg-primary text-primary-foreground"
                                                    : "bg-muted text-foreground"
                                                }`}
                                        >
                                            {msg.content}
                                        </div>
                                    </div>
                                ))}
                                {isLoading && (
                                    <div className="flex justify-start">
                                        <div className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
                                            <span className="inline-flex gap-1">
                                                <span className="animate-bounce">
                                                    ●
                                                </span>
                                                <span
                                                    className="animate-bounce"
                                                    style={{
                                                        animationDelay:
                                                            "0.1s",
                                                    }}
                                                >
                                                    ●
                                                </span>
                                                <span
                                                    className="animate-bounce"
                                                    style={{
                                                        animationDelay:
                                                            "0.2s",
                                                    }}
                                                >
                                                    ●
                                                </span>
                                            </span>
                                        </div>
                                    </div>
                                )}
                                <div ref={messagesEndRef} />
                            </div>
                        </div>

                        {/* Input area */}
                        <div className="border-t border-border/40 p-4">
                            <div className="mx-auto flex max-w-2xl gap-2">
                                <input
                                    ref={inputRef}
                                    type="text"
                                    value={input}
                                    onChange={(e) =>
                                        setInput(e.target.value)
                                    }
                                    onKeyDown={handleKeyDown}
                                    placeholder={t("placeholder")}
                                    disabled={isLoading}
                                    className="flex-1 rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:border-violet-500 disabled:opacity-50"
                                />
                                <button
                                    onClick={sendMessage}
                                    disabled={
                                        isLoading || !input.trim()
                                    }
                                    className="rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                                >
                                    {t("send")}
                                </button>
                            </div>
                            {error && (
                                <p className="mx-auto mt-2 max-w-2xl text-sm text-destructive">
                                    {error}
                                </p>
                            )}
                        </div>
                    </>
                )}

                {/* Diagnostic phase */}
                {phase === "diagnostic" && questions.length > 0 && (
                    <div className="flex flex-1 flex-col p-6">
                        <div className="mx-auto w-full max-w-2xl space-y-6">
                            <div className="text-sm text-muted-foreground">
                                {t("questionOf", {
                                    current: currentQ + 1,
                                    total: questions.length,
                                })}
                            </div>

                            {/* Progress bar */}
                            <div className="h-2 rounded-full bg-muted">
                                <div
                                    className="h-2 rounded-full bg-primary transition-all duration-300"
                                    style={{
                                        width: `${((currentQ + 1) / questions.length) * 100}%`,
                                    }}
                                />
                            </div>

                            {/* Question */}
                            <div className="rounded-2xl bg-muted/50 p-6">
                                <p className="mb-1 text-xs uppercase text-muted-foreground">
                                    CEFR {questions[currentQ].cefrTarget}
                                </p>
                                <p className="text-lg font-medium">
                                    {questions[currentQ].question}
                                </p>
                            </div>

                            {/* Answer input */}
                            {questions[currentQ].type ===
                                "multiple_choice" &&
                                questions[currentQ].options ? (
                                <div className="space-y-2">
                                    {questions[currentQ].options!.map(
                                        (opt, i) => (
                                            <button
                                                key={i}
                                                onClick={() => {
                                                    const newAnswers = [
                                                        ...answers,
                                                    ];
                                                    newAnswers[currentQ] =
                                                        opt;
                                                    setAnswers(
                                                        newAnswers
                                                    );
                                                }}
                                                className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition ${answers[currentQ] ===
                                                        opt
                                                        ? "border-primary bg-primary/10 font-medium"
                                                        : "border-border hover:border-primary/50"
                                                    }`}
                                            >
                                                {opt}
                                            </button>
                                        )
                                    )}
                                </div>
                            ) : (
                                <input
                                    type="text"
                                    value={answers[currentQ] ?? ""}
                                    onChange={(e) => {
                                        const newAnswers = [
                                            ...answers,
                                        ];
                                        newAnswers[currentQ] =
                                            e.target.value;
                                        setAnswers(newAnswers);
                                    }}
                                    placeholder={t(
                                        "answerPlaceholder"
                                    )}
                                    className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:border-violet-500"
                                />
                            )}

                            {/* Navigation */}
                            <div className="flex justify-between">
                                <button
                                    onClick={() =>
                                        setCurrentQ((q) =>
                                            Math.max(0, q - 1)
                                        )
                                    }
                                    disabled={currentQ === 0}
                                    className="rounded-xl border border-border px-4 py-2 text-sm transition hover:bg-muted disabled:opacity-30"
                                >
                                    ←
                                </button>
                                {currentQ <
                                    questions.length - 1 ? (
                                    <button
                                        onClick={() =>
                                            setCurrentQ((q) => q + 1)
                                        }
                                        disabled={
                                            !answers[currentQ]
                                        }
                                        className="rounded-xl bg-primary px-6 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                                    >
                                        →
                                    </button>
                                ) : (
                                    <button
                                        onClick={submitDiagnostic}
                                        disabled={
                                            isLoading ||
                                            !answers[currentQ]
                                        }
                                        className="rounded-xl bg-primary px-6 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                                    >
                                        {isLoading
                                            ? "..."
                                            : t("submitAnswers")}
                                    </button>
                                )}
                            </div>

                            {error && (
                                <p className="text-sm text-destructive">
                                    {error}
                                </p>
                            )}
                        </div>
                    </div>
                )}

                {/* Done phase */}
                {phase === "done" && (
                    <div className="flex flex-1 items-center justify-center p-6">
                        <div className="mx-auto max-w-md space-y-6 text-center">
                            {cefrResult ? (
                                <>
                                    <div className="text-6xl">🎯</div>
                                    <h2 className="text-2xl font-bold">
                                        {t("diagnosticResult", {
                                            level: cefrResult.level,
                                        })}
                                    </h2>
                                    <p className="text-muted-foreground">
                                        {cefrResult.explanation}
                                    </p>
                                </>
                            ) : (
                                <>
                                    <div className="text-6xl">✅</div>
                                    <h2 className="text-2xl font-bold">
                                        {t("completeTitle")}
                                    </h2>
                                </>
                            )}
                            <div className="rounded-2xl bg-muted/50 p-6">
                                <p className="text-muted-foreground">
                                    {t("phase4Placeholder")}
                                </p>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
