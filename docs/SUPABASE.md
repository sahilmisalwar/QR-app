# Supabase connection and production handoff

These instructions cover provisioning a new environment. If you are connecting to an existing event, use its project settings and event ID.

## Database and access

The migrations create `ops` private tables and expose one `api.call` function through an invoker wrapper. Its private dispatcher runs with the non-login, non-bypass-RLS `rih_executor` role, checks the authenticated user's live session and active event membership, and enforces station scope. Browser roles have no direct table access. Table RLS and explicit grants protect the private data. A unique partial index permits one active claim per team, event day and checkpoint.

Hosted Auth protects `auth.sessions` with RLS. A narrowly scoped private `ops.session_is_active()` helper owned by the migration role returns only whether the caller's own signed user/session pair exists. Its execution is granted only to the application executor, which cannot read Auth session rows directly. The executor inherits the standard authenticated role for Auth schema usage; browser users do not inherit the executor. The migration role retains ownership-management membership. Vault decryption permission is granted only to this trusted executor. The PostgREST authenticator exposes only `api`.

Every successful confirmation saves its claim, receipt and audit entry together. A 60-second preview is bound to the actor, session, assignment, roster, pass version and service revision. Retries use the same request ID. Replacing a pass revokes the old digest while preserving team history. Supabase Vault encrypts each pass payload for authorized re-download. Include Vault in the recovery plan.

1. Create or choose the organizer's Supabase project and inspect its existing schema before applying this migration. Back up any existing data. Use the pinned Supabase CLI and inspect command help before invoking remote operations. The project must support Supabase Vault and Postgres 17-compatible SQL.
2. Apply the migration in `supabase/migrations/` through the project's approved migration process. Run Supabase Security Advisor afterward. The script is designed for a new schema, so inspect name collisions before using an existing database.
3. In Data API settings, expose the `api` schema. Keep `ops` unexposed. For local Supabase the checked-in configuration already exposes only `api`.
4. Disable public signup and anonymous sign-in. Provision staff in Supabase Auth using an organizer-controlled process, with verified email/reset delivery. Do not share administrator credentials.
5. Create one event and its staff memberships using the SQL editor or a trusted operator process. Event IDs and Auth user IDs must be real UUIDs.

```sql
insert into ops.events (name, active)
values ('Rising India Hackathon 2.0', true)
returning id;

-- Replace the two UUID placeholders before executing.
insert into ops.staff (event_id, id, name, role)
values ('EVENT_UUID', 'AUTH_ADMIN_UUID', 'Event Administrator', 'admin');

insert into ops.staff (event_id, id, name, role, mode, day)
values ('EVENT_UUID', 'AUTH_VOLUNTEER_UUID', 'Volunteer Name', 'volunteer', 'lunch', 1);
```

6. Create exactly one schedule row for each configured day and checkpoint. Use the organizer-approved opening and closing instants with an explicit time offset. All team categories can use every open checkpoint. Keep unapproved services disabled. Example shape follows. The placeholders deliberately require actual event decisions.

```sql
insert into ops.schedules
  (event_id, day, mode, opens, closes, enabled)
values
  ('EVENT_UUID', 1, 'lunch', 'APPROVED_OPEN_TIME', 'APPROVED_CLOSE_TIME', false);
```

7. Copy `.env.example` to `.env.local`. Set `VITE_DATA_MODE=supabase`, the project URL, its publishable key and event UUID. Restart the dev server. The publishable key is intended for the browser. Service-role keys, database passwords and Vault secrets must stay server-side.
8. Sign in as the administrator, import the approved roster through CSV, confirm schedule rules and assign volunteers. Team codes are the CSV upsert key for this first build. Keep a stable mapping to external registration IDs before adding the automatic registration adapter.

## Required live verification

Test that a user without event membership is rejected, disabled staff cannot act, volunteer tokens cannot export or update settings, assignments cannot be switched client-side, and private tables are inaccessible. Use two real sessions to confirm the same pass simultaneously and verify one active claim. Test lost responses, QR rotation during preview, session expiry, midnight service windows and schedule changes. Verify secure key handling and actual Vault decryption under the deployed function owner.

PGlite tests mock Auth and Vault for transactional validation. Hosted transactional checks separately verify actual database permissions and Vault. Administrator MFA is enforced in the deployed dispatcher and has been enrolled in the real account. Browser Auth contract tests use intercepted responses, so they do not certify email delivery, live logout or real concurrent database connections. Finish SMTP/redirect setup, rate limiting, preview cleanup, registration integration, incident reconciliation and backup restore verification before deploying for participants. Read the release checklist in README.md.

Email recovery is disabled in the app until verified. Supabase's default email service only sends to project-team addresses; the app administrator's email differs from the project owner's email. Configure custom SMTP, add the actual HTTPS app origin to Auth redirect URLs, test a complete reset flow and only then set `VITE_EMAIL_RECOVERY_ENABLED=true`. See [Supabase SMTP guidance](https://supabase.com/docs/guides/auth/auth-smtp).

## Backups and retention

CSV download is an operational report. Use the organization's Supabase backup or an encrypted logical dump with documented Auth and Vault recovery. Test a restore outside production and verify claims, revocations and staff access. Agree retention for participant names, paper incident logs, audit and pass records. Rotate or retire event access after final reconciliation.

Provider references used in implementation are [Database functions](https://supabase.com/docs/guides/database/functions), [Securing the Data API](https://supabase.com/docs/guides/api/securing-your-api), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Vault](https://supabase.com/docs/guides/database/vault) and [Backups](https://supabase.com/docs/guides/platform/backups).
