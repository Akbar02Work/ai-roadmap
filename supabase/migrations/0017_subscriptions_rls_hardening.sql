BEGIN;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscriptions_owner_all ON public.subscriptions;
DROP POLICY IF EXISTS subscriptions_select_own ON public.subscriptions;

CREATE POLICY subscriptions_select_own
  ON public.subscriptions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

REVOKE INSERT, UPDATE, DELETE ON public.subscriptions FROM authenticated;

COMMIT;
