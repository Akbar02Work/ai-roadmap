This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Supabase Migrations (Required Before Staging/Production)

Apply migrations in this exact order after the base schema exists:

1. `supabase/migrations/0001_rls.sql` - enables RLS and owner-scoped policies.
2. `supabase/migrations/0002_usage_rpc.sql` - adds `consume_usage_v1` RPC for atomic usage enforcement.
3. `supabase/migrations/0003_profiles_trigger.sql` - adds signup profile auto-create trigger, backfills missing profiles, and adds `profiles_insert_own` hardening policy.

Recommended apply methods:

1. Supabase SQL Editor: run each migration file in order (`0001` then `0002` then `0003`).
2. Supabase CLI (if configured): `supabase db push` from the project root.

`0003` is mandatory. Without it, new auth users may not get a `public.profiles` row at signup, which breaks the app's user-data invariant and can cause RLS-protected profile flows to fail.

## Staging Checklist

Before promoting to staging/production, verify all items:

1. Migrations applied in order: `0001_rls.sql` -> `0002_usage_rpc.sql` -> `0003_profiles_trigger.sql`.
2. Supabase env is set:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. LLM provider env is set for active routes:
   - OpenAI path: `OPENAI_API_KEY`
   - Anthropic fallback path: `ANTHROPIC_API_KEY`
   - OpenRouter onboarding path: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_REFERER`, `OPENROUTER_TITLE`
4. Rate-limit backend configured for production:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
   - (Without these, production rate-limited endpoints fail with `503`.)
5. Auth flows verified:
   - login/signup callback works (`/api/auth/callback`)
   - new signup gets `public.profiles` row
   - authenticated onboarding routes can read/write user-scoped data under RLS
