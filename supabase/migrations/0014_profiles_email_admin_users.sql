-- Phase 6.5: expose user emails in admin users list via profiles.email.
-- Keeps service_role disabled; data is read through admin RPCs.

BEGIN;

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS email text;

-- Backfill email for existing profiles from auth.users.
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE u.id = p.id
  AND (p.email IS NULL OR btrim(p.email) = '');

-- Keep profile email populated for new signups.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, email, display_name, locale, created_at, updated_at)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'locale', 'en'),
        now(),
        now()
    )
    ON CONFLICT (id) DO UPDATE
    SET
        email = EXCLUDED.email,
        updated_at = now();

    RETURN NEW;
END;
$$;

-- Return real email from profiles in admin users RPC.
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
            email,
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
