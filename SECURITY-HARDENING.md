# Security hardening (2026-11-02) – migration 20261102000002_hardening.sql

- Trial: source of truth = SQL RPC `access_status()` (security definer; trial_end = trial_started_at + trial_days, admin extensions via `admin_extend_trial`). Client can't update trial/admin columns (column grants; verified). Client paywall only on explicit server `active=false`; on server error it fails OPEN so the chat + client-side crisis layer are never blocked. `/api/access` exposes the same status; `api/_access.js#requireActive` must gate every future AI/server endpoint (never the crisis path).
- Handoffs: direct inserts revoked; only RPC `request_handoff()` which builds the summary server-side from allowlisted onboarding fields + enum metadata. Trigger `handoffs_guard` enforces max 2 per rolling 30 days per user (config/handoff.yaml), with per-user advisory lock, and allowlists summary keys. localStorage handoff list is only a cache of server timestamps.
- Onboarding: CHECK `profiles_onboarding_allowlist` – only the 10 onboarding keys, typed, length-limited.
- admin_extend_trial: is_admin() + extra_days 1..90 + target must exist.

## Remaining limitation
The conversation engine runs fully client-side, so a modified client can still use the local engine after the trial ends. Real enforcement arrives once AI replies go through server endpoints that call `requireActive()`.
