-- Phase 6B: SRS-lite review scheduling for completed nodes
-- Adds review columns to roadmap_nodes, review_node_v1 RPC,
-- and updates complete_node_v1 to schedule first review.

BEGIN;

-- ============================================================
-- Add review columns to roadmap_nodes
-- ============================================================

ALTER TABLE public.roadmap_nodes
    ADD COLUMN IF NOT EXISTS next_review_at      timestamptz,
    ADD COLUMN IF NOT EXISTS last_review_at      timestamptz,
    ADD COLUMN IF NOT EXISTS review_interval_days int NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS review_count         int NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS roadmap_nodes_review_due_idx
    ON public.roadmap_nodes(next_review_at ASC)
    WHERE status = 'completed' AND next_review_at IS NOT NULL;

-- ============================================================
-- CREATE OR REPLACE complete_node_v1
-- Now also schedules first SRS review at +2 days on completion
-- and increments daily_progress.nodes_completed (if table exists)
-- ============================================================

CREATE OR REPLACE FUNCTION public.complete_node_v1(
    p_node_id uuid
)
RETURNS TABLE(next_node_id uuid) AS $$
DECLARE
    v_roadmap_id uuid;
    v_goal_id    uuid;
    v_sort_order int;
    v_current_status text;
    v_next_id uuid;
BEGIN
    -- 1. Ownership check: node → roadmap → goal → user_id = auth.uid()
    SELECT rn.roadmap_id, rn.sort_order, rn.status, r.goal_id
    INTO v_roadmap_id, v_sort_order, v_current_status, v_goal_id
    FROM public.roadmap_nodes rn
    JOIN public.roadmaps r ON r.id = rn.roadmap_id
    JOIN public.goals g ON g.id = r.goal_id
    WHERE rn.id = p_node_id
      AND g.user_id = auth.uid();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Node not found or access denied'
            USING ERRCODE = '42501';
    END IF;

    -- Serialize concurrent completions on same roadmap
    PERFORM pg_advisory_xact_lock(hashtext(v_roadmap_id::text));

    -- 2. Idempotent: if already completed, just find next node
    IF v_current_status = 'completed' THEN
        SELECT rn2.id INTO v_next_id
        FROM public.roadmap_nodes rn2
        WHERE rn2.roadmap_id = v_roadmap_id
          AND rn2.sort_order > v_sort_order
        ORDER BY rn2.sort_order ASC
        LIMIT 1;

        RETURN QUERY SELECT v_next_id;
        RETURN;
    END IF;

    -- 3. Mark current node as completed + schedule SRS review
    UPDATE public.roadmap_nodes
    SET status = 'completed',
        next_review_at = now() + interval '2 days',
        review_interval_days = 2,
        review_count = 0,
        last_review_at = now()
    WHERE id = p_node_id;

    -- 4. Find and activate next locked node
    SELECT rn2.id INTO v_next_id
    FROM public.roadmap_nodes rn2
    WHERE rn2.roadmap_id = v_roadmap_id
      AND rn2.sort_order > v_sort_order
      AND rn2.status = 'locked'
    ORDER BY rn2.sort_order ASC
    LIMIT 1;

    IF v_next_id IS NOT NULL THEN
        UPDATE public.roadmap_nodes
        SET status = 'active'
        WHERE id = v_next_id;
    END IF;

    -- 5. Increment nodes_completed in daily_progress (best-effort)
    BEGIN
        INSERT INTO public.daily_progress (goal_id, day, minutes, nodes_completed, updated_at)
        VALUES (v_goal_id, current_date, 0, 1, now())
        ON CONFLICT (goal_id, day) DO UPDATE
            SET nodes_completed = daily_progress.nodes_completed + 1,
                updated_at = now();
    EXCEPTION WHEN undefined_table THEN
        -- daily_progress table doesn't exist yet — skip gracefully
        NULL;
    END;

    RETURN QUERY SELECT v_next_id;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;

REVOKE ALL ON FUNCTION public.complete_node_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_node_v1(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_node_v1(uuid) TO authenticated;

-- ============================================================
-- RPC: review_node_v1(p_node_id uuid, p_passed boolean)
-- Updates SRS schedule for a completed node after review.
-- ============================================================

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
    v_roadmap_id    uuid;
    v_status        text;
    v_interval      int;
    v_count         int;
    v_new_interval  int;
    v_new_review_at timestamptz;
    v_new_count     int;
BEGIN
    -- 1. Ownership check
    SELECT rn.roadmap_id, rn.status, rn.review_interval_days, rn.review_count
    INTO v_roadmap_id, v_status, v_interval, v_count
    FROM public.roadmap_nodes rn
    JOIN public.roadmaps r ON r.id = rn.roadmap_id
    JOIN public.goals g ON g.id = r.goal_id
    WHERE rn.id = p_node_id
      AND g.user_id = auth.uid();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Node not found or access denied'
            USING ERRCODE = '42501';
    END IF;

    -- 2. Only completed nodes can be reviewed
    IF v_status <> 'completed' THEN
        RAISE EXCEPTION 'Only completed nodes can be reviewed'
            USING ERRCODE = '22023';
    END IF;

    -- Serialize concurrent reviews on same roadmap
    PERFORM pg_advisory_xact_lock(hashtext(v_roadmap_id::text));

    -- 3. Calculate new schedule
    IF p_passed THEN
        -- Increase interval: double it (capped at 30 days)
        v_new_interval := LEAST(GREATEST(v_interval * 2, 2), 30);
        v_new_count := v_count + 1;
    ELSE
        -- Failed: reset to 1 day
        v_new_interval := 1;
        v_new_count := v_count; -- don't increment on failure
    END IF;

    v_new_review_at := now() + (v_new_interval || ' days')::interval;

    -- 4. Update node
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
