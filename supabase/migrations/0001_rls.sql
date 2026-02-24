-- Phase 1 baseline RLS policies.
-- Apply after base schema/tables are created.

BEGIN;

ALTER TABLE IF EXISTS public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.roadmaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.roadmap_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ai_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.onboarding_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.chat_messages ENABLE ROW LEVEL SECURITY;

-- profiles: users can read/update only their own profile
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- goals: owner-only access
DROP POLICY IF EXISTS goals_owner_all ON public.goals;
CREATE POLICY goals_owner_all
  ON public.goals
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- roadmaps: access only through owned goal
DROP POLICY IF EXISTS roadmaps_owner_all ON public.roadmaps;
CREATE POLICY roadmaps_owner_all
  ON public.roadmaps
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.goals g
      WHERE g.id = goal_id
        AND g.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.goals g
      WHERE g.id = goal_id
        AND g.user_id = auth.uid()
    )
  );

-- roadmap_nodes: access only through roadmap -> owned goal
DROP POLICY IF EXISTS roadmap_nodes_owner_all ON public.roadmap_nodes;
CREATE POLICY roadmap_nodes_owner_all
  ON public.roadmap_nodes
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.roadmaps r
      JOIN public.goals g ON g.id = r.goal_id
      WHERE r.id = roadmap_id
        AND g.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.roadmaps r
      JOIN public.goals g ON g.id = r.goal_id
      WHERE r.id = roadmap_id
        AND g.user_id = auth.uid()
    )
  );

-- attempts/usage/events/ai_logs/subscriptions: owner-only by user_id
DROP POLICY IF EXISTS attempts_owner_all ON public.attempts;
CREATE POLICY attempts_owner_all
  ON public.attempts
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS usage_owner_all ON public.usage;
CREATE POLICY usage_owner_all
  ON public.usage
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS events_owner_all ON public.events;
CREATE POLICY events_owner_all
  ON public.events
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS ai_logs_owner_all ON public.ai_logs;
CREATE POLICY ai_logs_owner_all
  ON public.ai_logs
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS subscriptions_owner_all ON public.subscriptions;
CREATE POLICY subscriptions_owner_all
  ON public.subscriptions
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- onboarding_sessions/chat_messages: access through owned goal
DROP POLICY IF EXISTS onboarding_sessions_owner_all ON public.onboarding_sessions;
CREATE POLICY onboarding_sessions_owner_all
  ON public.onboarding_sessions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.goals g
      WHERE g.id = goal_id
        AND g.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.goals g
      WHERE g.id = goal_id
        AND g.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS chat_messages_owner_all ON public.chat_messages;
CREATE POLICY chat_messages_owner_all
  ON public.chat_messages
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.onboarding_sessions s
      JOIN public.goals g ON g.id = s.goal_id
      WHERE s.id = session_id
        AND g.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.onboarding_sessions s
      JOIN public.goals g ON g.id = s.goal_id
      WHERE s.id = session_id
        AND g.user_id = auth.uid()
    )
  );

COMMIT;
