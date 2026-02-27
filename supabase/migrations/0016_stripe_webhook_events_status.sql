-- ============================================================
-- 0016: Stripe webhook event processing state
-- ============================================================

alter table public.stripe_webhook_events
    add column if not exists status text not null default 'processing',
    add column if not exists last_error text,
    add column if not exists processed_at timestamptz,
    add column if not exists updated_at timestamptz not null default now();

-- Existing rows from 0015 represent events that were already acknowledged.
-- Backfill them as succeeded to preserve dedupe behavior.
update public.stripe_webhook_events
set
    status = 'succeeded',
    processed_at = coalesce(processed_at, created_at),
    updated_at = now()
where status = 'processing'
  and last_error is null;
