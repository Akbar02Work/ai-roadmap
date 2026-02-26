-- ============================================================
-- 0015: Stripe webhook idempotency + subscription uniqueness
-- ============================================================

-- 1. Idempotent event log to prevent duplicate webhook processing
create table if not exists public.stripe_webhook_events (
    event_id  text        primary key,
    created_at timestamptz not null default now()
);

-- Allow anyone authenticated to insert (webhook uses Prisma, but keep RLS for safety)
alter table public.stripe_webhook_events enable row level security;

-- No RLS policy needed — webhook uses Prisma (bypasses RLS).
-- If future code needs RLS access, add policies here.

-- 2. Unique constraint: one subscription row per Stripe subscription id
-- Partial unique: only for non-null stripe_sub_id
create unique index if not exists subscriptions_stripe_sub_id_unique
    on public.subscriptions (stripe_sub_id)
    where stripe_sub_id is not null;

-- 3. Ensure subscriptions RLS is on (should already be from 0001)
alter table public.subscriptions enable row level security;
