-- Phase 3: Atomic usage enforcement via authenticated Supabase RPC.

BEGIN;

DROP FUNCTION IF EXISTS public.consume_usage_v1(integer, integer, integer, integer);

CREATE OR REPLACE FUNCTION public.consume_usage_v1(
    delta_tokens integer,
    delta_messages integer,
    max_tokens integer,
    max_messages integer
)
RETURNS TABLE(allowed boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    uid uuid;
    safe_delta_tokens integer := GREATEST(delta_tokens, 0);
    safe_delta_messages integer := GREATEST(delta_messages, 0);
BEGIN
    uid := auth.uid();

    IF uid IS NULL THEN
        RETURN QUERY SELECT false;
        RETURN;
    END IF;

    INSERT INTO public.usage ("user_id", "date")
    VALUES (uid, CURRENT_DATE)
    ON CONFLICT ("user_id", "date") DO NOTHING;

    RETURN QUERY
    WITH updated AS (
        UPDATE public.usage
        SET
            "ai_messages" = "ai_messages" + safe_delta_messages,
            "tokens_used" = "tokens_used" + safe_delta_tokens
        WHERE
            "user_id" = uid
            AND "date" = CURRENT_DATE
            AND "ai_messages" + safe_delta_messages <= max_messages
            AND "tokens_used" + safe_delta_tokens <= max_tokens
        RETURNING true AS allowed
    )
    SELECT COALESCE((SELECT updated.allowed FROM updated LIMIT 1), false) AS allowed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_usage_v1(integer, integer, integer, integer) TO authenticated;

COMMIT;
