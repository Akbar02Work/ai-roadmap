-- Phase 6.5 hotfix: make rpc_admin_users compatible with profiles schema
-- that does not include email/plan columns.

BEGIN;

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
        SELECT
            id,
            NULL::text AS email,
            display_name,
            NULL::text AS plan,
            created_at
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

REVOKE ALL ON FUNCTION public.rpc_admin_users(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_users(integer, integer) TO authenticated;

COMMIT;
