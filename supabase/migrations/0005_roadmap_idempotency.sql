-- Phase 5: Roadmap generation idempotency via (goal_id, idempotency_key).

BEGIN;

ALTER TABLE public.roadmaps
    ADD COLUMN IF NOT EXISTS idempotency_key uuid;

CREATE UNIQUE INDEX IF NOT EXISTS roadmaps_goal_idem_uq
    ON public.roadmaps(goal_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

DROP FUNCTION IF EXISTS public.generate_roadmap_v1(uuid, text, text, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.generate_roadmap_v1(uuid, text, text, jsonb, jsonb, uuid);

CREATE OR REPLACE FUNCTION public.generate_roadmap_v1(
    p_goal_id uuid,
    p_regeneration_reason text,
    p_generated_by text,
    p_roadmap_meta jsonb,
    p_nodes jsonb,
    p_idempotency_key uuid
)
RETURNS TABLE (roadmap_id uuid, deduped boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    uid uuid;
    v_existing_roadmap_id uuid;
    v_old_active_id uuid;
    v_new_roadmap_id uuid;
    v_next_version integer;
    v_nodes_count integer;
    v_inserted_nodes integer;
BEGIN
    uid := auth.uid();

    IF uid IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Authentication required.';
    END IF;

    IF p_goal_id IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'Goal id is required.';
    END IF;

    PERFORM 1
    FROM public.goals g
    WHERE g.id = p_goal_id
      AND g.user_id = uid;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Goal not found or access denied.';
    END IF;

    -- Serialize concurrent generations for the same goal.
    PERFORM pg_advisory_xact_lock(hashtext(p_goal_id::text));

    IF p_idempotency_key IS NOT NULL THEN
        SELECT r.id
        INTO v_existing_roadmap_id
        FROM public.roadmaps r
        WHERE r.goal_id = p_goal_id
          AND r.idempotency_key = p_idempotency_key
        LIMIT 1;

        IF v_existing_roadmap_id IS NOT NULL THEN
            RETURN QUERY SELECT v_existing_roadmap_id, TRUE;
            RETURN;
        END IF;
    END IF;

    IF p_nodes IS NULL OR jsonb_typeof(p_nodes) <> 'array' THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'Nodes payload must be a JSON array.';
    END IF;

    v_nodes_count := jsonb_array_length(p_nodes);
    IF v_nodes_count = 0 THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'Nodes payload must not be empty.';
    END IF;

    SELECT r.id
    INTO v_old_active_id
    FROM public.roadmaps r
    WHERE r.goal_id = p_goal_id
      AND r.status = 'active'
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT 1
    FOR UPDATE;

    SELECT COALESCE(MAX(r.version), 0) + 1
    INTO v_next_version
    FROM public.roadmaps r
    WHERE r.goal_id = p_goal_id;

    INSERT INTO public.roadmaps (
        goal_id,
        version,
        status,
        generated_by,
        roadmap_meta,
        regeneration_reason,
        idempotency_key
    )
    VALUES (
        p_goal_id,
        v_next_version,
        'draft',
        p_generated_by,
        COALESCE(p_roadmap_meta, '{}'::jsonb),
        p_regeneration_reason,
        p_idempotency_key
    )
    RETURNING id INTO v_new_roadmap_id;

    INSERT INTO public.roadmap_nodes (
        roadmap_id,
        sort_order,
        title,
        description,
        node_type,
        content,
        est_minutes,
        pass_rules,
        prerequisites,
        status,
        skills
    )
    SELECT
        v_new_roadmap_id,
        node.ordinality::integer,
        COALESCE(node.value->>'title', ''),
        node.value->>'description',
        COALESCE(node.value->>'nodeType', 'lesson'),
        '{}'::jsonb,
        COALESCE((node.value->>'estMinutes')::integer, 15),
        COALESCE(node.value->'passRules', '{}'::jsonb),
        ARRAY[]::uuid[],
        CASE WHEN node.ordinality = 1 THEN 'active' ELSE 'locked' END,
        COALESCE(
            ARRAY(
                SELECT jsonb_array_elements_text(COALESCE(node.value->'skills', '[]'::jsonb))
            ),
            ARRAY[]::text[]
        )
    FROM jsonb_array_elements(p_nodes) WITH ORDINALITY AS node(value, ordinality);

    GET DIAGNOSTICS v_inserted_nodes = ROW_COUNT;

    IF v_inserted_nodes <> v_nodes_count THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'Node payload insert count mismatch.';
    END IF;

    -- Keep unique(active) constraint safe: old active -> superseded before new -> active.
    IF v_old_active_id IS NOT NULL THEN
        UPDATE public.roadmaps
        SET status = 'superseded'
        WHERE id = v_old_active_id;
    END IF;

    UPDATE public.roadmaps
    SET status = 'active'
    WHERE id = v_new_roadmap_id;

    RETURN QUERY SELECT v_new_roadmap_id, FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_roadmap_v1(uuid, text, text, jsonb, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_roadmap_v1(uuid, text, text, jsonb, jsonb, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.generate_roadmap_v1(uuid, text, text, jsonb, jsonb, uuid) TO authenticated;

COMMIT;
