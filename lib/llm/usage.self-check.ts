// ============================================================
// usage self-check
// Demonstrates why atomic consume is required under concurrency.
// ============================================================

type MockState = { aiMessages: number };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class Mutex {
    private tail: Promise<void> = Promise.resolve();

    async run<T>(fn: () => Promise<T>): Promise<T> {
        const prev = this.tail;
        let release!: () => void;
        this.tail = new Promise<void>((resolve) => {
            release = resolve;
        });
        await prev;
        try {
            return await fn();
        } finally {
            release();
        }
    }
}

async function nonAtomicConsume(state: MockState, limit: number): Promise<boolean> {
    if (state.aiMessages >= limit) {
        return false;
    }
    await sleep(0);
    state.aiMessages += 1;
    return true;
}

function createAtomicConsume() {
    const lock = new Mutex();
    return async (state: MockState, limit: number): Promise<boolean> =>
        lock.run(async () => {
            if (state.aiMessages >= limit) {
                return false;
            }
            state.aiMessages += 1;
            return true;
        });
}

export async function runUsageRaceSelfCheck() {
    const limit = 1;
    const attempts = 20;

    const stateNonAtomic: MockState = { aiMessages: 0 };
    const nonAtomicResults = await Promise.all(
        Array.from({ length: attempts }, () => nonAtomicConsume(stateNonAtomic, limit))
    );

    const stateAtomic: MockState = { aiMessages: 0 };
    const atomicConsume = createAtomicConsume();
    const atomicResults = await Promise.all(
        Array.from({ length: attempts }, () => atomicConsume(stateAtomic, limit))
    );

    return {
        attempts,
        limit,
        nonAtomicAccepted: nonAtomicResults.filter(Boolean).length,
        atomicAccepted: atomicResults.filter(Boolean).length,
        nonAtomicFinalCount: stateNonAtomic.aiMessages,
        atomicFinalCount: stateAtomic.aiMessages,
    };
}
