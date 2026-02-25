export interface SupabasePublicEnv {
    url: string;
    anonKey: string;
}

export class SupabaseConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SupabaseConfigError";
    }
}

export function getSupabasePublicEnv(context: string): SupabasePublicEnv {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
    const missing: string[] = [];

    if (!url) {
        missing.push("NEXT_PUBLIC_SUPABASE_URL");
    }
    if (!anonKey) {
        missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    }

    if (missing.length > 0 || !url || !anonKey) {
        const detail = `Missing required Supabase env vars: ${missing.join(", ")}`;
        console.error(`[${context}] ${detail}`);
        throw new SupabaseConfigError(
            "Supabase auth is unavailable due to missing environment configuration."
        );
    }

    return { url, anonKey };
}
