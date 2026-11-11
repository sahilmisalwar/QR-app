# Rising India Hackathon 2.0

A locally stored React and TypeScript web application for admin operations and volunteer team check-in. It uses the eight approved reference images and the three exact logo assets supplied by the organizer. Outfit headings and Plus Jakarta Sans body fonts are included locally, with soft teal, saffron and checkpoint-colored background gradients.

## Open the app

Double-click **Start App.cmd** in this folder. Keep its window open while using the app. The local address is **http://127.0.0.1:5173**. If the preview is already running, open that address directly.

The default launcher uses your configured Supabase project and requires an assigned staff login. Administrator access requires an authenticator code, enforced by the database.

For sample data, open **Start Rehearsal.cmd**, or run `npm run dev:demo`, at **http://127.0.0.1:5174**. This separate mode offers an admin workspace and three volunteer checkpoints with 350 synthetic teams stored in browser IndexedDB. It does not synchronize between devices or provide production authentication. Reset rehearsal from Admin → Settings.

Try **Unclaimed team** in a volunteer scanner to review members and explicitly confirm. Lunch and Dinner require the full-team checkbox. A second attempt displays the existing check-in. **CodeCrafters** demonstrates a duplicate. You can also generate a QR in Admin → QR Passes and scan its downloaded image in the volunteer flow.

## Included in this build

- Light admin dashboard with the reference masthead, teal navigation, progress rings, live totals and quick actions.
- Blue Entry, amber Lunch and purple Dinner volunteer layouts, camera scanning and QR image decoding, member verification, human confirmation, success, duplicate and connection recovery.
- Team search, editing, CSV validation and atomic imports, individual QR downloads and printable team passes.
- Locked volunteer assignments, day and category schedules, immutable original claims with audited corrections, QR replacement and CSV reports.
- Supabase adapter, private database schema, permissions, atomic confirmation, unique claim constraints, session checks, encrypted pass storage and SQL regression tests.

## Development

Requires Node.js 22.12 or newer. Commands run in this folder.

```powershell
npm ci
npm run dev
npm run build
npm test
```

The development server binds to this computer only. A phone needs a trusted HTTPS deployment or a separately configured local HTTPS connection for camera use. Avoid exposing the rehearsal mode as a production check-in service.

`npm test` runs the local data and Postgres integration regression tests. The database tests use PGlite with mocked Supabase Auth and Vault interfaces. Browser tests use installed Microsoft Edge: start rehearsal on port 5174 for `node tests/browser.mjs`, `node tests/browser-management.mjs` and `node tests/browser-navigation.mjs`. Start the connected app on port 5173 for `node tests/browser-auth.mjs`; it checks real public configuration and then intercepts sign-in traffic with test responses, without creating cloud users or sending mail. For a separate insecure-LAN rehearsal test, provide `DEMO_HTTP_URL` to `tests/mobile-http.mjs`. Physical phone cameras and venue capacity require HTTPS and an on-site rehearsal.

## Connect the event database

See [Supabase setup](docs/SUPABASE.md). After cloning, copy `.env.example` to `.env.supabase.local` and fill in your project URL, publishable key and event ID to use the connected app. Both `npm run dev` and `npm run build` select Supabase mode. Missing configuration shows a setup error. Use `npm run dev:demo` for local rehearsal or `npm run build:demo` for a rehearsal build. Keep secrets out of all variables beginning with `VITE_`.

Email password recovery is deliberately unavailable until custom SMTP, redirect URLs and real delivery are verified. The app directs staff to their organizer meanwhile. Recovery callback and password-update screens are implemented and covered by simulated Auth tests. Set `VITE_EMAIL_RECOVERY_ENABLED=true` only after the email setup is tested. The first administrator can request account recovery through the Supabase project owner; never share passwords or authenticator setup keys in chat.

## Before production release

Confirm actual dates, day 2 meals and category eligibility. Connect the existing registration source or import its approved CSV. Provision named staff accounts, complete Auth email configuration and publish a trusted HTTPS deployment for mobile cameras. Registration webhook integration, batch pass files, controlled manual incident reconciliation, export pagination and operational backup/restore automation remain subsequent release work. Apply request throttling and a preview-retention cleanup policy and run real concurrent-session load tests before event use. The current database serializes event operations with an event lock, which prioritizes correctness for the first build and must be measured at venue load.

CSV reports contain operational data. Full database recovery needs a separately managed backup, Vault recovery and tested restore procedure. Screens use the truthful status available to this build.

## Source map

- `src/components/Admin.tsx` and `src/styles.css` implement admin references 1, 2 and 8.
- `src/components/Volunteer.tsx` and `volunteer.css` implement Entry 3, Lunch 5, Dinner 6 and the two scan-flow references.
- `public/brand/` contains the exact provided event, NIT and Team Nexus PNGs.
- `reference/` retains all eight original UI images and the PRD for future implementation work.
- `src/lib/demo.ts` implements browser-local rehearsal data.
- `src/lib/supabase.ts` connects the app to the database RPC.
- `supabase/migrations/` contains the schema and protected transactions.

Keep the light admin surface and warm mobile cards aligned with the selected references. Screenshot sample dates and totals are illustrative. Database data and the published schedule control the functioning app.
