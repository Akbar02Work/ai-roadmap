-- Phase 5 hardening: node progress status integrity.
-- Apply after 0006_node_progress_rpc.sql.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS roadmap_nodes_one_active
    ON public.roadmap_nodes(roadmap_id)
    WHERE status = 'active';

CREATE OR REPLACE FUNCTION public.complete_node_v1(
    p_node_id uuid
)
RETURNS TABLE(next_node_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_uid uuid;
    v_roadmap_id uuid;
    v_sort_order integer;
    v_current_status text;
    v_next_id uuid;
BEGIN
    v_uid := auth.uid();

    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Authentication required.';
    END IF;

    IF p_node_id IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'Node id is required.';
    END IF;

    SELECT rn.roadmap_id
    INTO v_roadmap_id
    FROM public.roadmap_nodes rn
    JOIN public.roadmaps r ON r.id = rn.roadmap_id
    JOIN public.goals g ON g.id = r.goal_id
    WHERE rn.id = p_node_id
      AND g.user_id = v_uid;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Node not found or access denied.';
    END IF;

    -- Serialize status transitions per roadmap.
    PERFORM pg_advisory_xact_lock(hashtext(v_roadmap_id::text));

    SELECT rn.sort_order, rn.status
    INTO v_sort_order, v_current_status
    FROM public.roadmap_nodes rn
    JOIN public.roadmaps r ON r.id = rn.roadmap_id
    JOIN public.goals g ON g.id = r.goal_id
    WHERE rn.id = p_node_id
      AND g.user_id = v_uid
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Node not found or access denied.';
    END IF;

    IF v_current_status = 'completed' THEN
        SELECT rn2.id
        INTO v_next_id
        FROM public.roadmap_nodes rn2
        WHERE rn2.roadmap_id = v_roadmap_id
          AND rn2.sort_order > v_sort_order
          AND rn2.status IN ('active', 'locked')
        ORDER BY rn2.sort_order ASC
        LIMIT 1;

        RETURN QUERY SELECT v_next_id;
        RETURN;
    END IF;

    IF v_current_status <> 'active' THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'node_not_active';
    END IF;

    UPDATE public.roadmap_nodes
    SET status = 'completed'
    WHERE id = p_node_id
      AND status = 'active';

    SELECT rn2.id
    INTO v_next_id
    FROM public.roadmap_nodes rn2
    WHERE rn2.roadmap_id = v_roadmap_id
      AND rn2.sort_order > v_sort_order
      AND rn2.status = 'locked'
    ORDER BY rn2.sort_order ASC
    LIMIT 1;

    IF v_next_id IS NOT NULL THEN
        UPDATE public.roadmap_nodes
        SET status = 'active'
        WHERE id = v_next_id
          AND status = 'locked';
    END IF;

    RETURN QUERY SELECT v_next_id;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_node_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_node_v1(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_node_v1(uuid) TO authenticated;

COMMIT;
