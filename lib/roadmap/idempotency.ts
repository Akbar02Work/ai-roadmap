const IDEMPOTENCY_STORAGE_PREFIX = "roadmap_idem:";
const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function buildStorageKey(goalId: string): string {
    return `${IDEMPOTENCY_STORAGE_PREFIX}${goalId}`;
}

export function getOrCreateRoadmapIdempotencyKey(goalId: string): string {
    if (typeof window === "undefined") {
        return crypto.randomUUID();
    }

    const key = buildStorageKey(goalId);
    const existing = localStorage.getItem(key);
    if (existing && UUID_REGEX.test(existing)) {
        return existing;
    }

    const created = crypto.randomUUID();
    localStorage.setItem(key, created);
    return created;
}

export function clearRoadmapIdempotencyKey(goalId: string): void {
    if (typeof window === "undefined") {
        return;
    }
    localStorage.removeItem(buildStorageKey(goalId));
}
