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
4. `supabase/migrations/0004_roadmap_atomic.sql` - adds atomic roadmap generation RPC with per-goal serialization.
5. `supabase/migrations/0005_roadmap_idempotency.sql` - adds roadmap generation idempotency `(goal_id, idempotency_key)` and dedupe returns.
6. `supabase/migrations/0006_node_progress_rpc.sql` - adds node completion RPC for status transitions.
7. `supabase/migrations/0007_node_progress_hardening.sql` - hardens node progress RPC + enforces single active node per roadmap.
8. `supabase/migrations/0008_daily_progress.sql` - daily practice progress table + `log_practice_v1` RPC.
9. `supabase/migrations/0009_reviews_srs.sql` - SRS review columns on roadmap_nodes + `review_node_v1` RPC.
10. `supabase/migrations/0010_phase6_rpc_hardening.sql` - hardens phase 6 RPCs.
11. `supabase/migrations/0011_ai_logs_request_id.sql` - adds `ai_logs.request_id` index for request-level correlation.
12. `supabase/migrations/0012_admin_rpc.sql` - adds `admin_users` and admin-only SECURITY DEFINER RPCs for cross-user observability reads.
13. `supabase/migrations/0013_admin_users_rpc_hotfix.sql` - updates `rpc_admin_users` to read from `profiles` schema safely.
14. `supabase/migrations/0014_profiles_email_admin_users.sql` - mirrors email into `profiles` and updates admin users RPC to return real emails.
15. `supabase/migrations/0015_stripe_webhook_idempotency.sql` - idempotent webhook event log + unique constraint on `subscriptions.stripe_sub_id`.
16. `supabase/migrations/0016_stripe_webhook_events_status.sql` - webhook event lifecycle fields (`processing`/`succeeded`/`failed`) for retry-safe processing.
17. `supabase/migrations/0017_subscriptions_rls_hardening.sql` - hardens `subscriptions` RLS to user read-only; subscription writes are webhook-owned.

Recommended apply methods:

1. Supabase SQL Editor: run each migration file in order (`0001` -> ... -> `0017`).
2. Supabase CLI (if configured): `supabase db push` from the project root.

`0003` through `0007` are mandatory for onboarding-to-progress flow:
- `0003`: signup/profile invariants.
- `0004` + `0005`: roadmap atomicity and idempotent generation.
- `0006` + `0007`: safe node status transitions and single-active-node integrity.
- `0008` + `0009` + `0010`: daily progress tracking and SRS reviews.
- `0011` + `0012` + `0013` + `0014`: observability and admin features.
- `0015` + `0016`: Stripe webhook idempotency, lifecycle status, and subscription uniqueness.
- `0017`: `subscriptions` is now read-only for authenticated users; INSERT/UPDATE/DELETE are denied and state changes must come from the Stripe webhook processing path.

Stripe note:
- `0015` enables RLS on `stripe_webhook_events` but intentionally does not add policies.
- Webhook writes are executed via Prisma DB role path (not Supabase user-session RLS).

### Admin Users (DB Source of Truth)

Admin observability RPCs check `auth.uid()` against `public.admin_users`.

Add an admin manually in Supabase SQL Editor:

```sql
insert into public.admin_users (user_id)
values ('<admin-user-uuid>')
on conflict (user_id) do nothing;
```

Remove admin:

```sql
delete from public.admin_users
where user_id = '<admin-user-uuid>';
```

Notes:
- Keep `ADMIN_USER_IDS` env for app/UI route guard.
- DB RPC authorization uses `public.admin_users` (not env vars).

### Roadmap Generate Idempotency Contract

`POST /api/roadmap/generate` accepts:

```json
{
  "goalId": "uuid",
  "idempotencyKey": "uuid (optional)"
}
```

Response contract:
- `201` for a new roadmap: `{ roadmapId, deduped: false, idempotencyKey }`
- `200` for replay with the same `(goalId, idempotencyKey)`: `{ roadmapId, deduped: true, idempotencyKey }`

Why: protects against duplicate clicks, retries, and parallel tabs creating extra roadmap versions.

## Staging Checklist

Before promoting to staging/production, verify all items:

1. Migrations applied in order: `0001_rls.sql` -> ... -> `0017_subscriptions_rls_hardening.sql`.
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
6. Stripe billing (if enabled):
   - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
   - `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_UNLIMITED`
   - `APP_URL` (preferred) or `NEXT_PUBLIC_APP_URL` for checkout return URLs
   - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (optional, reserved for Stripe.js)

### Stripe Webhook Setup

1. In Stripe Dashboard → Developers → Webhooks → Add endpoint.
2. URL: `https://your-domain.com/api/billing/webhook`
3. Events to subscribe:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Copy the signing secret → set `STRIPE_WEBHOOK_SECRET` env var.
5. For local testing: `stripe listen --forward-to localhost:3000/api/billing/webhook`

### Billing Smoke Checklist

1. Navigate to `/{locale}/billing` → see 4 plan cards, current plan = free.
2. Click "Upgrade" on Starter → redirected to Stripe Checkout.
3. Complete test payment (use `4242 4242 4242 4242`) → redirected back with success banner.
4. Refresh billing page → current plan = starter, period end shown.
5. In Stripe Dashboard: cancel subscription → webhook fires → plan reverts to cancelled.
6. `stripe_webhook_events` rows transition to `succeeded` after successful processing.
7. Webhook retry scenario: temporarily break a price env mapping, trigger event, verify row becomes `failed`; fix env and replay same Stripe event, verify row becomes `succeeded`.
8. Non-authenticated user → `/api/billing/status` returns 401.
9. Invalid plan → `/api/billing/checkout` returns `400` with `code=BILLING_INVALID_REQUEST`.

## Pre-launch Checklist

Before going live, verify every item:

### Database Migrations (in order)

Apply all migrations `0001_rls.sql` → `0017_subscriptions_rls_hardening.sql` via Supabase SQL Editor or `supabase db push`. Skipping any migration **will** cause runtime 503 errors on dependent endpoints.

### Admin Setup

```sql
INSERT INTO public.admin_users (user_id)
VALUES ('<admin-user-uuid>')
ON CONFLICT (user_id) DO NOTHING;
```

Also set `ADMIN_USER_IDS=<uuid>` env var for UI route guard.

### Stripe Webhook Setup

1. Stripe Dashboard → Developers → Webhooks → Add endpoint.
2. URL: `https://your-domain.com/api/billing/webhook`
3. Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
4. Copy signing secret → `STRIPE_WEBHOOK_SECRET`
5. Set remaining Stripe env vars:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_UNLIMITED`
   - `APP_URL` (required in production for checkout return URLs)

### LLM Provider Keys

At least one of:
- `OPENAI_API_KEY` (primary)
- `ANTHROPIC_API_KEY` (fallback)
- `OPENROUTER_API_KEY` + `OPENROUTER_MODEL` + `OPENROUTER_REFERER` + `OPENROUTER_TITLE` (onboarding)

### Upstash Redis (Rate Limiting)

- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- **If not set in production**: rate-limited endpoints return `503` (fail-closed).
- **If not set in development**: in-memory fallback limiter is used (safe for local dev).

### LLM Test Endpoint

- `/api/llm/test` is **disabled** in production by default.
- To enable: set `ENABLE_LLM_TEST_ENDPOINT=true`.
- Not recommended for public-facing deployments.

---

## Full MVP Smoke Test

End-to-end verification flow (12 steps). Run against a clean test user.

| # | Step | Method | Endpoint / Action | Expected |
|---|------|--------|-------------------|----------|
| 1 | **Auth** | browser | Sign up / log in via Supabase Auth | Redirect to dashboard, `profiles` row created |
| 2 | **Onboarding start** | `POST` | `/api/onboarding/start` | `201` → `{ sessionId, goalId }` |
| 3 | **Onboarding chat** | `POST` | `/api/onboarding/chat` | `200` → assistant reply + collected fields |
| 4 | **Diagnose generate** | `POST` | `/api/onboarding/diagnose/generate` | `200` → CEFR diagnostic questions |
| 5 | **Diagnose submit** | `POST` | `/api/onboarding/diagnose/submit` | `200` → `{ cefrLevel, explanation }`, session completed |
| 6 | **Roadmap generate** | `POST` | `/api/roadmap/generate` | `201` → `{ roadmapId, deduped: false }` |
| 7 | **Node fetch + quiz** | `GET` → `POST` | `/api/nodes/[id]` → `/api/nodes/[id]/quiz` | Node data, then `201` → quiz questions |
| 8 | **Quiz attempt** | `POST` | `/api/nodes/[id]/attempt` | Score result, node completion if passed |
| 9 | **Daily log** | `POST` | `/api/progress/log` | `200` → streak + minutes summary |
| 10 | **Due reviews** | `GET` | `/api/reviews/due?goalId=...` | `200` → `{ nodes: [...] }` (may be empty) |
| 11 | **Admin check** | `GET` | `/api/admin/events` + `/api/admin/ai-logs` | `200` → paginated results (requires admin role) |
| 12 | **Billing** | `POST` → `GET` | `/api/billing/checkout` → `/api/billing/status` | Checkout URL, then plan status |

### Quick cURL Smoke (Steps 2–3)

```bash
# Step 2 — start onboarding
curl -s -X POST http://localhost:3000/api/onboarding/start \
  -H "Cookie: <auth-cookie>" | jq .

# Step 3 — send chat message
curl -s -X POST http://localhost:3000/api/onboarding/chat \
  -H "Cookie: <auth-cookie>" \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"<id>","message":"I want to learn Spanish"}' | jq .
```

---

## Phase 5 Manual Test (Node Completion Rules)

Preconditions:
- Migrations `0006_node_progress_rpc.sql` and `0007_node_progress_hardening.sql` are applied.
- User has an active roadmap with an active node.

Steps:
1. Open dashboard -> `View Roadmap` -> open active node -> click `Generate quiz`.
2. Answer only 2/5 questions:
   - Submit button must stay disabled in UI (`Answered X/Y` is below total), or
   - if request is forced manually, API returns `400` with "All quiz questions must be answered before submitting."
3. Answer all questions but with 3/5 correct:
   - response should be `passed: false` (threshold is `70%`),
   - node must remain not completed.
4. Answer all questions with 4/5 correct:
   - response should be `passed: true`,
   - current node becomes `completed`,
   - next node becomes `active`.
