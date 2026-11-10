# Rising India Hackathon 2.0

A locally stored React and TypeScript web application for admin operations and volunteer team check-in. It uses the eight approved reference images and the three exact logo assets supplied by the organizer. Manrope and Sora fonts are included locally.

## Open the app

Double-click **Start App.cmd** in this folder. Keep its window open while using the app. The local address is **http://127.0.0.1:5173**. If the preview is already running, open that address directly.

The default welcome screen offers an admin workspace and three assigned volunteer checkpoints. This mode uses 350 synthetic teams stored in the browser's IndexedDB. It is a rehearsal environment. It does not synchronize data between different devices or provide production authentication. Reset it from Admin → Settings.

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

`npm test` runs the local data and Postgres integration regression tests. The database tests use PGlite with mocked Supabase Auth and Vault interfaces. Live Supabase behavior, physical phone cameras and venue network capacity require a connected deployment and an on-site rehearsal. Browser tests use the installed Microsoft Edge and a running development server. Run `node tests/browser.mjs` and `node tests/browser-management.mjs`.

## Connect the event database

See [Supabase setup](docs/SUPABASE.md). Set the public configuration in `.env.local`, provision staff and the event, and restart. Keep secrets out of all variables beginning with `VITE_`.

The current default is local rehearsal. No cloud project has been created or changed, no real roster has been imported and no paid service has been purchased.

## Before production release

Confirm actual dates, day 2 meals and category eligibility. Connect the existing registration source or import its approved CSV. Provision named staff accounts and complete Auth email configuration. Admin MFA enrollment and enforcement, registration webhook integration, batch pass files, controlled manual incident reconciliation, export pagination and operational backup/restore automation remain subsequent release work. Apply request throttling and a preview-retention cleanup policy and run real concurrent-session load tests before event use. The current database serializes event operations with an event lock, which prioritizes correctness for the first build and must be measured at venue load.

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
