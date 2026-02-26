-- Phase 6.5: Admin RPCs (cross-user reads) without service_role.
-- Admin source of truth at DB layer: public.admin_users.

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_users (
    user_id uuid PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_users_select_own ON public.admin_users;
CREATE POLICY admin_users_select_own
  ON public.admin_users
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

REVOKE ALL ON TABLE public.admin_users FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.admin_users TO authenticated;

DROP FUNCTION IF EXISTS public.is_admin(uuid);
CREATE OR REPLACE FUNCTION public.is_admin(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.admin_users au
        WHERE au.user_id = p_user_id
    );
$$;

DROP FUNCTION IF EXISTS public.rpc_admin_overview();
CREATE OR REPLACE FUNCTION public.rpc_admin_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    uid uuid := auth.uid();
    recent_events jsonb := '{}'::jsonb;
BEGIN
    IF uid IS NULL OR NOT public.is_admin(uid) THEN
        RAISE EXCEPTION 'Admin access denied' USING ERRCODE = '42501';
    END IF;

    WITH recent_limited AS (
        SELECT event_type
        FROM public.events
        WHERE created_at >= (now() - interval '24 hours')
        ORDER BY created_at DESC, id DESC
        LIMIT 1000
    ),
    recent_grouped AS (
        SELECT event_type, COUNT(*)::bigint AS count
        FROM recent_limited
        GROUP BY event_type
    )
    SELECT COALESCE(jsonb_object_agg(event_type, count), '{}'::jsonb)
    INTO recent_events
    FROM recent_grouped;

    RETURN jsonb_build_object(
        'totals',
        jsonb_build_object(
            'users', (SELECT COUNT(*)::bigint FROM public.profiles),
            'goals', (SELECT COUNT(*)::bigint FROM public.goals),
            'roadmaps', (SELECT COUNT(*)::bigint FROM public.roadmaps),
            'events', (SELECT COUNT(*)::bigint FROM public.events),
            'aiLogs', (SELECT COUNT(*)::bigint FROM public.ai_logs)
        ),
        'recentEvents24h',
        recent_events
    );
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_admin_users(integer, integer);
CREATE OR REPLACE FUNCTION public.rpc_admin_users(
    p_page integer DEFAULT 1,
    p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    uid uuid := auth.uid();
    safe_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
    safe_page integer := GREATEST(COALESCE(p_page, 1), 1);
    safe_offset integer := (safe_page - 1) * safe_limit;
    total_count bigint := 0;
    rows_json jsonb := '[]'::jsonb;
BEGIN
    IF uid IS NULL OR NOT public.is_admin(uid) THEN
        RAISE EXCEPTION 'Admin access denied' USING ERRCODE = '42501';
    END IF;

    SELECT COUNT(*)::bigint
    INTO total_count
    FROM public.profiles;

    SELECT COALESCE(jsonb_agg(to_jsonb(u)), '[]'::jsonb)
    INTO rows_json
    FROM (
        SELECT id, email, display_name, plan, created_at
        FROM public.profiles
        ORDER BY created_at DESC, id DESC
        LIMIT safe_limit
        OFFSET safe_offset
    ) AS u;

    RETURN jsonb_build_object(
        'users', rows_json,
        'total', total_count,
        'limit', safe_limit,
        'page', safe_page,
        'offset', safe_offset
    );
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_admin_events(text, integer, integer);
CREATE OR REPLACE FUNCTION public.rpc_admin_events(
    p_event_type text DEFAULT NULL,
    p_page integer DEFAULT 1,
    p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    uid uuid := auth.uid();
    safe_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
    safe_page integer := GREATEST(COALESCE(p_page, 1), 1);
    safe_offset integer := (safe_page - 1) * safe_limit;
    total_count bigint := 0;
    rows_json jsonb := '[]'::jsonb;
BEGIN
    IF uid IS NULL OR NOT public.is_admin(uid) THEN
        RAISE EXCEPTION 'Admin access denied' USING ERRCODE = '42501';
    END IF;

    SELECT COUNT(*)::bigint
    INTO total_count
    FROM public.events
    WHERE p_event_type IS NULL OR event_type = p_event_type;

    SELECT COALESCE(jsonb_agg(to_jsonb(e)), '[]'::jsonb)
    INTO rows_json
    FROM (
        SELECT id, user_id, event_type, payload, created_at
        FROM public.events
        WHERE p_event_type IS NULL OR event_type = p_event_type
        ORDER BY created_at DESC, id DESC
        LIMIT safe_limit
        OFFSET safe_offset
    ) AS e;

    RETURN jsonb_build_object(
        'events', rows_json,
        'total', total_count,
        'limit', safe_limit,
        'page', safe_page,
        'offset', safe_offset
    );
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_admin_ai_logs(text, integer, integer);
CREATE OR REPLACE FUNCTION public.rpc_admin_ai_logs(
    p_task_type text DEFAULT NULL,
    p_page integer DEFAULT 1,
    p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    uid uuid := auth.uid();
    safe_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
    safe_page integer := GREATEST(COALESCE(p_page, 1), 1);
    safe_offset integer := (safe_page - 1) * safe_limit;
    total_count bigint := 0;
    rows_json jsonb := '[]'::jsonb;
BEGIN
    IF uid IS NULL OR NOT public.is_admin(uid) THEN
        RAISE EXCEPTION 'Admin access denied' USING ERRCODE = '42501';
    END IF;

    SELECT COUNT(*)::bigint
    INTO total_count
    FROM public.ai_logs
    WHERE p_task_type IS NULL OR task_type = p_task_type;

    SELECT COALESCE(jsonb_agg(to_jsonb(l)), '[]'::jsonb)
    INTO rows_json
    FROM (
        SELECT
            id,
            user_id,
            task_type,
            model,
            prompt_version,
            input_tokens,
            output_tokens,
            latency_ms,
            status,
            error_message,
            request_id,
            created_at
        FROM public.ai_logs
        WHERE p_task_type IS NULL OR task_type = p_task_type
        ORDER BY created_at DESC, id DESC
        LIMIT safe_limit
        OFFSET safe_offset
    ) AS l;

    RETURN jsonb_build_object(
        'logs', rows_json,
        'total', total_count,
        'limit', safe_limit,
        'page', safe_page,
        'offset', safe_offset
    );
END;
$$;

REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_admin_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_overview() TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_admin_users(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_users(integer, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_admin_events(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_events(text, integer, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_admin_ai_logs(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_ai_logs(text, integer, integer) TO authenticated;

COMMIT;
