-- Phase 6.5: Add request_id column to ai_logs for correlation
-- Apply after existing migrations.

BEGIN;

ALTER TABLE public.ai_logs
    ADD COLUMN IF NOT EXISTS request_id uuid;

CREATE INDEX IF NOT EXISTS ai_logs_request_id_idx
    ON public.ai_logs(request_id)
    WHERE request_id IS NOT NULL;

COMMIT;
