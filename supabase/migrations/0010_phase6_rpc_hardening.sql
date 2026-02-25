-- Phase 6C: RPC hardening for completion/review concurrency and invariants.
-- Keeps Phase 6 behavior while restoring Phase 5 safety guarantees.

BEGIN;

CREATE OR REPLACE FUNCTION public.complete_node_v1(
    p_node_id uuid
)
RETURNS TABLE(next_node_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    uid              uuid;
    v_roadmap_id     uuid;
    v_goal_id        uuid;
    v_sort_order     int;
    v_current_status text;
    v_next_id        uuid;
BEGIN
    uid := auth.uid();
    IF uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication required.';
    END IF;

    IF p_node_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'node_id is required';
    END IF;

    -- Resolve roadmap first so the advisory lock key is stable per roadmap.
    SELECT rn.roadmap_id
    INTO v_roadmap_id
    FROM public.roadmap_nodes rn
    JOIN public.roadmaps r ON r.id = rn.roadmap_id
    JOIN public.goals g ON g.id = r.goal_id
    WHERE rn.id = p_node_id
      AND g.user_id = uid;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Node not found or access denied'
            USING ERRCODE = '42501';
    END IF;

    -- Serialize roadmap transitions before reading mutable node state.
    PERFORM pg_advisory_xact_lock(hashtext(v_roadmap_id::text));

    -- Re-read fresh state after lock and lock this row for transition.
    SELECT rn.roadmap_id, rn.sort_order, rn.status, r.goal_id
    INTO v_roadmap_id, v_sort_order, v_current_status, v_goal_id
    FROM public.roadmap_nodes rn
    JOIN public.roadmaps r ON r.id = rn.roadmap_id
    JOIN public.goals g ON g.id = r.goal_id
    WHERE rn.id = p_node_id
      AND g.user_id = uid
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Node not found or access denied'
            USING ERRCODE = '42501';
    END IF;

    -- Idempotent no-op.
    IF v_current_status = 'completed' THEN
        SELECT rn2.id INTO v_next_id
        FROM public.roadmap_nodes rn2
        WHERE rn2.roadmap_id = v_roadmap_id
          AND rn2.sort_order > v_sort_order
        ORDER BY rn2.sort_order ASC, rn2.id ASC
        LIMIT 1;

        RETURN QUERY SELECT v_next_id;
        RETURN;
    END IF;

    -- Preserve Phase 5 invariant: only active node can be completed.
    IF v_current_status <> 'active' THEN
        RAISE EXCEPTION 'node_not_active'
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.roadmap_nodes
    SET status = 'completed',
        next_review_at = now() + interval '2 days',
        review_interval_days = 2,
        review_count = 0,
        last_review_at = now()
    WHERE id = p_node_id;

    -- Promote the next locked node after current node leaves active state.
    SELECT rn2.id INTO v_next_id
    FROM public.roadmap_nodes rn2
    WHERE rn2.roadmap_id = v_roadmap_id
      AND rn2.sort_order > v_sort_order
      AND rn2.status = 'locked'
    ORDER BY rn2.sort_order ASC, rn2.id ASC
    LIMIT 1
    FOR UPDATE;

    IF v_next_id IS NOT NULL THEN
        UPDATE public.roadmap_nodes
        SET status = 'active'
        WHERE id = v_next_id;
    END IF;

    -- Best-effort update. Completion must still succeed if 0008 is absent.
    BEGIN
        INSERT INTO public.daily_progress (goal_id, day, minutes, nodes_completed, updated_at)
        VALUES (v_goal_id, current_date, 0, 1, now())
        ON CONFLICT (goal_id, day) DO UPDATE
            SET nodes_completed = daily_progress.nodes_completed + 1,
                updated_at = now();
    EXCEPTION WHEN undefined_table THEN
        NULL;
    END;

    RETURN QUERY SELECT v_next_id;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_node_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_node_v1(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_node_v1(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.review_node_v1(
    p_node_id uuid,
    p_passed  boolean
)
RETURNS TABLE (
    next_review_at   timestamptz,
    interval_days    int,
    review_count_new int
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    uid             uuid;
    v_roadmap_id    uuid;
    v_status        text;
    v_interval      int;
    v_count         int;
    v_new_interval  int;
    v_new_review_at timestamptz;
    v_new_count     int;
BEGIN
    uid := auth.uid();
    IF uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication required.';
    END IF;

    IF p_node_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'node_id is required';
    END IF;

    IF p_passed IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'passed is required';
    END IF;

    -- Resolve roadmap for lock key.
    SELECT rn.roadmap_id
    INTO v_roadmap_id
    FROM public.roadmap_nodes rn
    JOIN public.roadmaps r ON r.id = rn.roadmap_id
    JOIN public.goals g ON g.id = r.goal_id
    WHERE rn.id = p_node_id
      AND g.user_id = uid;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Node not found or access denied'
            USING ERRCODE = '42501';
    END IF;

    -- Serialize review scheduling per roadmap.
    PERFORM pg_advisory_xact_lock(hashtext(v_roadmap_id::text));

    -- Read fresh mutable values after lock.
    SELECT rn.status, rn.review_interval_days, rn.review_count
    INTO v_status, v_interval, v_count
    FROM public.roadmap_nodes rn
    JOIN public.roadmaps r ON r.id = rn.roadmap_id
    JOIN public.goals g ON g.id = r.goal_id
    WHERE rn.id = p_node_id
      AND g.user_id = uid
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Node not found or access denied'
            USING ERRCODE = '42501';
    END IF;

    IF v_status <> 'completed' THEN
        RAISE EXCEPTION 'Only completed nodes can be reviewed'
            USING ERRCODE = '22023';
    END IF;

    IF p_passed THEN
        v_new_interval := LEAST(GREATEST(v_interval * 2, 2), 30);
        v_new_count := v_count + 1;
    ELSE
        v_new_interval := 1;
        v_new_count := v_count;
    END IF;

    v_new_review_at := now() + (v_new_interval || ' days')::interval;

    UPDATE public.roadmap_nodes
    SET review_interval_days = v_new_interval,
        review_count = v_new_count,
        next_review_at = v_new_review_at,
        last_review_at = now()
    WHERE id = p_node_id;

    RETURN QUERY SELECT v_new_review_at, v_new_interval, v_new_count;
END;
$$;

REVOKE ALL ON FUNCTION public.review_node_v1(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_node_v1(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.review_node_v1(uuid, boolean) TO authenticated;

COMMIT;
