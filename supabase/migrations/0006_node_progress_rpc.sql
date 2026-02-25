-- Phase 5: Node progress tracking RPC
-- Atomically completes a node and activates the next one.
-- Apply after 0005_roadmap_idempotency.sql

BEGIN;

-- ============================================================
-- complete_node_v1(p_node_id uuid)
-- Ownership check via auth.uid() → node → roadmap → goal → user_id
-- Idempotent: re-completing an already-completed node is a no-op.
-- Returns: next_node_id (null if last node or no next locked node)
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_node_v1(
    p_node_id uuid
)
RETURNS TABLE(next_node_id uuid) AS $$
DECLARE
    v_roadmap_id uuid;
    v_sort_order int;
    v_current_status text;
    v_next_id uuid;
BEGIN
    -- 1. Ownership check: node → roadmap → goal → user_id = auth.uid()
    SELECT rn.roadmap_id, rn.sort_order, rn.status
    INTO v_roadmap_id, v_sort_order, v_current_status
    FROM public.roadmap_nodes rn
    JOIN public.roadmaps r ON r.id = rn.roadmap_id
    JOIN public.goals g ON g.id = r.goal_id
    WHERE rn.id = p_node_id
      AND g.user_id = auth.uid();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Node not found or access denied'
            USING ERRCODE = '42501';
    END IF;

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

    -- 3. Mark current node as completed
    UPDATE public.roadmap_nodes
    SET status = 'completed'
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

    RETURN QUERY SELECT v_next_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.complete_node_v1(uuid) TO authenticated;

COMMIT;
