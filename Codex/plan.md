# Plan / Backlog (AI Roadmap)

This file is a living plan/backlog. Keep items small, actionable, and sorted by priority.

## P0 (Fix Before Sharing Widely)
- Auth: Fix password reset flow stuck on "Loading..." (Supabase recovery should go through `/api/auth/callback`).
- Onboarding: Prevent duplicate goal/session creation when users revisit onboarding.
- Roadmap correctness: Ensure target language collected in onboarding is used consistently (Korean should not generate Russian roadmap).
- Quiz generation: Make failures visible and actionable (rate limit vs LLM error vs data error).

## P1 (Improve UX)
- Roadmap creation UX: After generating a roadmap, route user into it (or show a clear CTA) and preserve the onboarding chat transcript.
- Dashboard: Reduce layout shifts and add skeleton loading patterns across pages (Telegram-like placeholders).
- Billing: Show "Coming soon" when Stripe isn't configured; hide/disable upgrade buttons.
- Remove or rethink "+10 min" button (unclear value).
- Reduce mixed language UI (RU/EN) and improve i18n consistency for v2.

## P2 (Product / v2)
- Roadmaps: Separate "my roadmaps" vs global/template library; add screens for both.
- Learning loop: "Puzzles" concept redesign (generator should also teach + check, not only check).
- Performance: Cache common reads, avoid refetch storms, prefetch, and add proper skeletons.
- Observability: Add Vercel Speed Insights + Web Analytics (mobile + desktop) and define a minimal error budget dashboard.
- Security hygiene before public launch: Rotate leaked secrets (OpenRouter/Upstash/DB), confirm RLS policies, tighten error messages.

