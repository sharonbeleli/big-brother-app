# Security hardening (2026-11-02) – migration 20261102000002_hardening.sql

- Trial: source of truth = SQL RPC `access_status()` (security definer; trial_end = trial_started_at + trial_days, admin extensions via `admin_extend_trial`). Client can't update trial/admin columns (column grants; verified). Client paywall only on explicit server `active=false`; on server error it fails OPEN so the chat + client-side crisis layer are never blocked. `/api/access` exposes the same status; `api/_access.js#requireActive` must gate every future AI/server endpoint (never the crisis path).
- Handoffs: direct inserts revoked; only RPC `request_handoff()` which builds the summary server-side from allowlisted onboarding fields + enum metadata. Trigger `handoffs_guard` enforces max 2 per rolling 30 days per user (config/handoff.yaml), with per-user advisory lock, and allowlists summary keys. localStorage handoff list is only a cache of server timestamps.
- Onboarding: CHECK `profiles_onboarding_allowlist` – only the 10 onboarding keys, typed, length-limited.
- admin_extend_trial: is_admin() + extra_days 1..90 + target must exist.

## Remaining limitation
The conversation engine runs fully client-side, so a modified client can still use the local engine after the trial ends. Real enforcement arrives once AI replies go through server endpoints that call `requireActive()`.

## AI layer (2026-11-02) – /api/ai
- Order: client rule engine + client crisis layer run first on every message; a rule crisis is rendered immediately and AI is never called. AI (`app/ai.js`) runs only on non-crisis results and can only escalate (crisis>0 → crisis screen + hotlines, session locked); it can never unlock/de-escalate.
- `/api/ai`: POST only; `requireActive()` (401/402) before any paid work; per-user in-memory rate limit (8/min, 120/day, 10 insights/day; per warm instance); output caps 300 (turn) / 500 (insight) tokens; ≤12 messages × 600 chars; profile allowlist (name, ageRange, occupation, tone, length); `store:false` to OpenAI; no message text logged or persisted. Missing key → 503 → client falls back silently.
- Models: small `gpt-6-luna` (turn: classify/convergence/2nd crisis layer/phrasing), strong `gpt-6.1-terra` (final insight). Override via AI_MODEL_SMALL / AI_MODEL_STRONG env.
- 2026-11-02 live: the OpenAI account currently returns `credit_balance_exhausted` for every model except `gpt-6-luna`, so Vercel env sets `AI_MODEL_STRONG=gpt-6-luna` (insight also on luna). Remove that env var to return to `gpt-6.1-terra` once the account has access/credits.
- AI rate limit in DB (migration 20261102000003_ai_rate_limit.sql): table `ai_usage` (RLS on, no policies, all client grants revoked) + security-definer RPC `ai_rate_hit(p_mode)` with per-user row lock (atomic check+increment): 8/min, 120/day (UTC), 10 insights/day. `/api/ai` calls it with the user's JWT; on any DB error it falls back to the in-memory limiter. Crisis path never calls it. Row is deleted with the auth user (FK cascade).
- person_type: AI must return one of 3 types (or `unknown` early); client stabilises it with recency-weighted votes (≥2 votes, flip only on clear lead), keeps it in the in-memory session only and sends it back as an internal hint; never rendered or stored.

## Payments – MOCK ONLY (2026-11-02) – migration 20261102000004_payments.sql
- No real clearing anywhere. `PAYMENTS_MODE=mock` (Vercel env) enables a simulated checkout (Hebrew, marked "הדמיה/מצב בדיקה", no card fields). Unset/`off` → UI shows "בקרוב", `/api/payments` POST and webhook return 503.
- Tables `subscriptions`, `purchases` (ledger, unique (provider, provider_ref) = idempotency), `session_credits`, `credit_events`: RLS on, client SELECT own only (admins all), no client writes. Single write path `bb_apply_payment()` – service_role only. Admin RPCs `admin_grant_subscription / admin_revoke_subscription / admin_adjust_credits` (is_admin()).
- `access_status()`: active = admin OR trial OR active subscription; returns `subscription`, `credits`, `reason`. Free human handoffs (2/30d) only while active; beyond that (or when not active) `request_handoff()` atomically consumes 1 session credit (`handoffs.paid`). Crisis screens/hotlines are client-side and never gated; every gate/paywall screen shows hotlines.
- `/api/payments` (GET products/mode; POST mock checkout, auth required, client idempotency UUID). `/api/webhooks/payments`: adapter `verifyWebhook` (mock = HMAC-SHA256 `x-bb-signature`, secret `PAYMENTS_WEBHOOK_SECRET`). `api/_payments.js` has a disabled Paddle stub (interface only). Prices are placeholders (PRICE_MONTHLY_AGOROT / PRICE_SESSION_AGOROT).
- Going live later = implement a real adapter + legal/tax setup; mock rows are `is_test=true` / provider `mock`|`admin` and should be purged before launch.
