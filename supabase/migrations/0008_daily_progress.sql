-- Phase 6A: Daily practice progress table + log_practice_v1 RPC
-- Depends on: goals table, auth.uid()
-- Apply after 0005 (or after 0006/0007 if Phase 5 merged first)

BEGIN;

-- ============================================================
-- Table: daily_progress
-- One row per (goal_id, day). Tracks minutes practiced and nodes completed.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.daily_progress (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_id     uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
    day         date NOT NULL DEFAULT current_date,
    minutes     int  NOT NULL DEFAULT 0,
    nodes_completed int NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS daily_progress_goal_day_uq
    ON public.daily_progress(goal_id, day);

CREATE INDEX IF NOT EXISTS daily_progress_goal_day_idx
    ON public.daily_progress(goal_id, day DESC);

-- ============================================================
-- RLS: owner-only via goal chain
-- ============================================================

ALTER TABLE public.daily_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_progress_owner_all ON public.daily_progress;
CREATE POLICY daily_progress_owner_all
    ON public.daily_progress
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.goals g
            WHERE g.id = goal_id
              AND g.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.goals g
            WHERE g.id = goal_id
              AND g.user_id = auth.uid()
        )
    );

-- ============================================================
-- RPC: log_practice_v1
-- Upserts daily minutes for a goal. Returns streak + summary.
-- ============================================================

CREATE OR REPLACE FUNCTION public.log_practice_v1(
    p_goal_id       uuid,
    p_minutes_delta int,
    p_source        text DEFAULT 'manual'
)
RETURNS TABLE (
    today_minutes   int,
    week_minutes    bigint,
    streak_current  int,
    streak_best     int
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    uid         uuid;
    v_today     date := current_date;
    v_today_min int;
    v_week_min  bigint;
    v_streak    int := 0;
    v_best      int := 0;
    v_day       date;
    v_prev_day  date;
    v_min_daily int := 10; -- MIN_DAILY_MINUTES threshold
    v_max_daily int := 240; -- cap per day
BEGIN
    uid := auth.uid();
    IF uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication required.';
    END IF;

    -- Ownership check
    PERFORM 1 FROM public.goals g
    WHERE g.id = p_goal_id AND g.user_id = uid;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Goal not found or access denied.';
    END IF;

    -- Validate delta
    IF p_minutes_delta IS NULL OR p_minutes_delta <= 0 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'minutes_delta must be > 0';
    END IF;

    -- Serialize concurrent upserts for same (goal, day)
    PERFORM pg_advisory_xact_lock(hashtext(p_goal_id::text || v_today::text));

    -- Upsert today's row
    INSERT INTO public.daily_progress (goal_id, day, minutes, updated_at)
    VALUES (p_goal_id, v_today, LEAST(p_minutes_delta, v_max_daily), now())
    ON CONFLICT (goal_id, day) DO UPDATE
        SET minutes = LEAST(daily_progress.minutes + p_minutes_delta, v_max_daily),
            updated_at = now();

    -- Get today's total
    SELECT dp.minutes INTO v_today_min
    FROM public.daily_progress dp
    WHERE dp.goal_id = p_goal_id AND dp.day = v_today;

    -- Get week total (last 7 days)
    SELECT COALESCE(SUM(dp.minutes), 0) INTO v_week_min
    FROM public.daily_progress dp
    WHERE dp.goal_id = p_goal_id
      AND dp.day >= v_today - 6;

    -- Calculate streak: count consecutive days going backwards from today
    -- A day is "done" if minutes >= MIN_DAILY_MINUTES OR nodes_completed > 0
    v_prev_day := v_today;
    FOR v_day IN (
        SELECT dp.day
        FROM public.daily_progress dp
        WHERE dp.goal_id = p_goal_id
          AND dp.day <= v_today
          AND (dp.minutes >= v_min_daily OR dp.nodes_completed > 0)
        ORDER BY dp.day DESC
    ) LOOP
        IF v_day = v_prev_day THEN
            v_streak := v_streak + 1;
            v_prev_day := v_day - 1;
        ELSE
            EXIT;
        END IF;
    END LOOP;

    -- Calculate best streak (scan all days)
    DECLARE
        v_cur_streak int := 0;
        v_scan_prev  date := null;
        v_scan_day   date;
    BEGIN
        FOR v_scan_day IN (
            SELECT dp.day
            FROM public.daily_progress dp
            WHERE dp.goal_id = p_goal_id
              AND (dp.minutes >= v_min_daily OR dp.nodes_completed > 0)
            ORDER BY dp.day ASC
        ) LOOP
            IF v_scan_prev IS NULL OR v_scan_day = v_scan_prev + 1 THEN
                v_cur_streak := v_cur_streak + 1;
            ELSE
                v_cur_streak := 1;
            END IF;
            IF v_cur_streak > v_best THEN
                v_best := v_cur_streak;
            END IF;
            v_scan_prev := v_scan_day;
        END LOOP;
    END;

    RETURN QUERY SELECT v_today_min, v_week_min, v_streak, v_best;
END;
$$;

REVOKE ALL ON FUNCTION public.log_practice_v1(uuid, int, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_practice_v1(uuid, int, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.log_practice_v1(uuid, int, text) TO authenticated;

COMMIT;
