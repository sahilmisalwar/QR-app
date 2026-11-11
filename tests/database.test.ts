import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const event = "10000000-0000-0000-0000-000000000001";
const admin = "20000000-0000-0000-0000-000000000001";
const volunteer = "20000000-0000-0000-0000-000000000002";
const session = "30000000-0000-0000-0000-000000000001";
let teamId: string;
let token: string;

async function actor(id: string, aal = "aal2") {
  await db.exec("reset role");
  await db.query(
    `select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)`,
    [id, JSON.stringify({ session_id: session, aal })],
  );
  await db.query("update auth.sessions set user_id=$1 where id=$2", [
    id,
    session,
  ]);
  await db.exec("set role authenticated");
}
async function call(operation: string, payload: object = {}): Promise<any> {
  const result = await db.query<{ data: unknown }>(
    "select api.call($1::uuid,$2,$3::jsonb) as data",
    [event, operation, JSON.stringify(payload)],
  );
  return result.rows[0].data;
}

before(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create schema vault;
    create table auth.users(id uuid primary key);
    create table auth.sessions(id uuid primary key, user_id uuid);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
    create table vault.decrypted_secrets(id uuid primary key default gen_random_uuid(),name text,decrypted_secret text);
    create function vault.create_secret(secret text, name text default null, description text default '', key uuid default null)
      returns uuid language plpgsql security definer as $$declare generated uuid; begin
      insert into vault.decrypted_secrets(name,decrypted_secret) values(name,secret) returning id into generated; return generated; end$$;
  `);
  const folder = new URL("../supabase/migrations/", import.meta.url);
  const migrations = (await readdir(folder))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of migrations) {
    const sql = (await readFile(new URL(file, folder), "utf8")).replace(
      "create extension if not exists supabase_vault with schema vault;",
      "",
    );
    await db.exec(sql);
  }
  await db.query("insert into auth.users values ($1),($2)", [admin, volunteer]);
  await db.query("insert into auth.sessions values ($1,$2)", [session, admin]);
  await db.query(
    `insert into ops.events(id,name,active) values($1,'Test event',true)`,
    [event],
  );
  await db.query(
    `insert into ops.staff(event_id,id,name,role,mode) values($1,$2,'Admin','admin','entry'),($1,$3,'Volunteer','volunteer','lunch')`,
    [event, admin, volunteer],
  );
  await db.query(
    `insert into ops.schedules(event_id,day,mode,opens,closes,enabled,categories)
    select $1,day,mode,now()-interval '1 day',now()+interval '1 day',true,array['B'] from generate_series(1,2) day cross join unnest(array['entry','lunch','dinner']) mode`,
    [event],
  );
  await actor(admin);
  await call("save_team", {
    team: {
      code: "A-001",
      name: "Test Team",
      college: "Test College",
      category: "A",
      members: ["One", "Two"],
      active: true,
    },
  });
  teamId = (await call("snapshot")).teams[0].id;
  token = await call("pass", { teamId });
});
after(async () => {
  await db.close();
});

test("administrator data requires MFA, while context permits enrollment", async () => {
  await actor(admin, "aal1");
  assert.equal((await call("context")).role, "admin");
  await assert.rejects(call("snapshot"), /MFA_REQUIRED/);
  await assert.rejects(call("export"), /MFA_REQUIRED/);
  await assert.rejects(call("save_team", { team: {} }), /MFA_REQUIRED/);
  await actor(admin);
  assert.equal((await call("snapshot")).teams.length, 1);
});

test("private tables are inaccessible and volunteers receive scoped fields", async () => {
  await actor(volunteer);
  await assert.rejects(
    db.query("select * from ops.teams"),
    /permission denied/,
  );
  await assert.rejects(call("export"), /FORBIDDEN/);
  await assert.rejects(
    call("preview", { token, day: 1, mode: "entry" }),
    /FORBIDDEN/,
  );
  const snapshot = await call("snapshot");
  assert.deepEqual(snapshot.teams[0].members, []);
  assert.equal(snapshot.staff.length, 1);
  assert.equal(snapshot.schedules.length, 1);
  assert.deepEqual(snapshot.audit, []);
});

test("preview is read-only for claims and explicit full-team confirmation is required", async () => {
  await actor(volunteer);
  const draft = await call("preview", { token, day: 1, mode: "lunch" });
  assert.equal(draft.decision, "ELIGIBLE");
  assert.deepEqual(draft.team.members, ["One", "Two"]);
  assert.equal((await call("snapshot")).claims.length, 0);
  await assert.rejects(
    call("confirm", {
      previewId: draft.id,
      requestId: crypto.randomUUID(),
      fullTeam: false,
    }),
    /FULL_TEAM_REQUIRED/,
  );
  assert.equal((await call("snapshot")).claims.length, 0);
});

test("competing previews create one active claim and retries return the same receipt", async () => {
  await actor(volunteer);
  const first = await call("preview", { token, day: 1, mode: "lunch" });
  const second = await call("preview", { token, day: 1, mode: "lunch" });
  const requestId = crypto.randomUUID();
  const receipt = await call("confirm", {
    previewId: first.id,
    requestId,
    fullTeam: true,
  });
  assert.equal(receipt.code, "CONFIRMED");
  const duplicate = await call("confirm", {
    previewId: second.id,
    requestId: crypto.randomUUID(),
    fullTeam: true,
  });
  assert.equal(duplicate.code, "ALREADY_CONFIRMED");
  assert.equal(duplicate.claim.id, receipt.claim.id);
  assert.deepEqual(
    await call("confirm", { previewId: first.id, requestId, fullTeam: true }),
    receipt,
  );
  assert.deepEqual(await call("receipt", { requestId }), receipt);
  await assert.rejects(
    call("confirm", { previewId: second.id, requestId, fullTeam: true }),
    /REQUEST_CONFLICT/,
  );
  assert.equal((await call("snapshot")).claims.length, 1);
  await actor(admin);
  await call("void", {
    claimId: receipt.claim.id,
    reason: "Mistaken confirmation during test",
  });
  await actor(volunteer);
  assert.equal((await call("receipt", { requestId })).code, "VOIDED");
});

test("QR reissue invalidates old tokens and preexisting previews while preserving claims", async () => {
  await actor(volunteer);
  const draft = await call("preview", { token, day: 1, mode: "lunch" });
  await actor(admin);
  const replacement = await call("rotate", {
    teamId,
    reason: "Lost printed team pass",
  });
  assert.notEqual(replacement, token);
  assert.equal(await call("pass", { teamId }), replacement);
  await actor(volunteer);
  await assert.rejects(
    call("preview", { token, day: 1, mode: "lunch" }),
    /INVALID_QR/,
  );
  await assert.rejects(
    call("confirm", {
      previewId: draft.id,
      requestId: crypto.randomUUID(),
      fullTeam: true,
    }),
    /CONTEXT_CHANGED/,
  );
  token = replacement;
  assert.equal((await call("snapshot")).claims.length, 1);
});

test("assignment revocation and schedule revision invalidate a preview", async () => {
  await actor(volunteer);
  const draft = await call("preview", { token, day: 1, mode: "lunch" });
  await actor(admin);
  const staff = (await call("snapshot")).staff.find(
    (s: any) => s.id === volunteer,
  );
  await call("assign", { staff: { ...staff, mode: "dinner" } });
  await actor(volunteer);
  await assert.rejects(
    call("confirm", {
      previewId: draft.id,
      requestId: crypto.randomUUID(),
      fullTeam: true,
    }),
    /CONTEXT_CHANGED/,
  );
  await actor(admin);
  const snapshot = await call("snapshot");
  const schedule = snapshot.schedules.find(
    (s: any) => s.mode === "dinner" && s.day === 1,
  );
  await actor(volunteer);
  const dinner = await call("preview", { token, day: 1, mode: "dinner" });
  await actor(admin);
  await call("schedule", {
    schedule: { ...schedule, enabled: false },
    reason: "Close for test rehearsal",
  });
  await actor(volunteer);
  await assert.rejects(
    call("confirm", {
      previewId: dinner.id,
      requestId: crypto.randomUUID(),
      fullTeam: true,
    }),
    /CONTEXT_CHANGED/,
  );
  await assert.rejects(
    call("preview", { token, day: 1, mode: "dinner" }),
    /WINDOW_CLOSED/,
  );
});

test("roster import is atomic and preserves existing team and QR identity", async () => {
  await actor(admin);
  const valid = {
    code: "A-001",
    name: "Updated Team",
    college: "Test College",
    category: "A",
    members: ["One", "Two"],
    active: true,
  };
  await assert.rejects(
    call("import_teams", {
      teams: [valid, { ...valid, code: "B-002", category: "INVALID" }],
    }),
  );
  assert.equal((await call("snapshot")).teams[0].name, "Test Team");
  await call("import_teams", { teams: [valid] });
  assert.equal((await call("snapshot")).teams[0].id, teamId);
  assert.equal(await call("pass", { teamId }), token);
});
