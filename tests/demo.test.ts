import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoGateway } from "../src/lib/demo";
import type { Gateway, Team } from "../src/lib/types";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

async function fixture() {
  let time = Date.parse("2026-11-10T10:00:00Z");
  const databaseName = `rih-test-${crypto.randomUUID()}`;
  const gateway = () =>
    createDemoGateway({
      databaseName,
      storage: new MemoryStorage(),
      now: () => time,
    });
  const admin = gateway();
  await admin.demoLogin("admin");
  return {
    admin,
    gateway,
    advance(milliseconds: number) {
      time += milliseconds;
    },
  };
}

async function activeCount(gateway: Gateway) {
  const state = await gateway.snapshot();
  return state.claims.filter((claim) => claim.status === "confirmed").length;
}

test("seed totals and category denominators match the approved dashboard", async () => {
  const { admin } = await fixture();
  const snapshot = await admin.snapshot();
  assert.equal(snapshot.teams.length, 350);
  assert.deepEqual(
    ["A", "B", "C"].map(
      (category) =>
        snapshot.teams.filter((team) => team.category === category).length,
    ),
    [140, 130, 80],
  );
  assert.deepEqual(
    ["entry", "lunch", "dinner"].map(
      (mode) => snapshot.claims.filter((claim) => claim.mode === mode).length,
    ),
    [344, 287, 172],
  );
});

test("preview and cancel change neither claims nor operational audit", async () => {
  const { admin } = await fixture();
  const before = await admin.snapshot();
  const preview = await admin.preview("RIH-DEMO-C-080", 1, "lunch");
  assert.equal(preview.decision, "ELIGIBLE");
  assert.equal(preview.team.members.length, 4);
  const after = await admin.snapshot();
  assert.deepEqual(after.claims, before.claims);
  assert.deepEqual(after.audit, before.audit);
});

test("concurrent station confirmations yield one claim and repeat requests return its receipt", async () => {
  const { admin, gateway } = await fixture();
  const stationOne = gateway();
  const stationTwo = gateway();
  await stationOne.demoLogin("volunteer", "lunch");
  await stationTwo.demoLogin("volunteer", "lunch");
  const [one, two] = await Promise.all([
    stationOne.preview("RIH-DEMO-C-080", 1, "lunch"),
    stationTwo.preview("RIH-DEMO-C-080", 1, "lunch"),
  ]);
  const requestOne = crypto.randomUUID();
  const requestTwo = crypto.randomUUID();
  const before = await activeCount(admin);
  const results = await Promise.all([
    stationOne.confirm(one.id, requestOne, [0, 1, 2, 3]),
    stationTwo.confirm(two.id, requestTwo, [0, 1, 2, 3]),
  ]);
  assert.deepEqual(results.map((result) => result.code).sort(), [
    "ALREADY_CONFIRMED",
    "CONFIRMED",
  ]);
  assert.equal(results[0].claim.id, results[1].claim.id);
  assert.equal(await activeCount(admin), before + 1);
  assert.deepEqual(
    await stationOne.confirm(one.id, requestOne, [0, 1, 2, 3]),
    results[0],
  );
  assert.deepEqual(await stationOne.commandStatus(requestOne), results[0]);
  assert.equal(await activeCount(admin), before + 1);
  await assert.rejects(stationOne.confirm(two.id, requestOne, [0, 1, 2, 3]), {
    code: "REQUEST_REUSED",
  });
});

test("member selection, session binding and volunteer scope are enforced", async () => {
  const { admin, gateway } = await fixture();
  const volunteer = gateway();
  await volunteer.demoLogin("volunteer", "lunch");
  const preview = await volunteer.preview("RIH-DEMO-C-080", 1, "lunch");
  await assert.rejects(volunteer.confirm(preview.id, crypto.randomUUID(), []), {
    code: "MEMBERS_REQUIRED",
  });
  await assert.rejects(volunteer.preview("RIH-DEMO-C-080", 1, "dinner"), {
    code: "FORBIDDEN",
  });
  await assert.rejects(volunteer.preview("RIH-DEMO-C-080", 2, "lunch"), {
    code: "FORBIDDEN",
  });
  await assert.rejects(volunteer.getPass("demo-C-080"), { code: "FORBIDDEN" });
  await assert.rejects(volunteer.exportData(), { code: "FORBIDDEN" });
  const visible = await volunteer.snapshot();
  assert.ok(visible.teams.every((team) => team.members.length === 0));
  assert.ok(
    visible.claims.every((claim) => claim.mode === "lunch" && claim.day === 1),
  );
  assert.equal(visible.audit.length, 0);
  await volunteer.logout();
  await volunteer.demoLogin("volunteer", "lunch");
  await assert.rejects(
    volunteer.confirm(preview.id, crypto.randomUUID(), [0, 1, 2, 3]),
    { code: "PREVIEW_INVALID" },
  );
  assert.equal(await activeCount(admin), 803);
});

test("QR rotation invalidates old previews and preserves previous check-ins", async () => {
  const { admin } = await fixture();
  const preview = await admin.preview("RIH-DEMO-C-080", 1, "lunch");
  const replacement = await admin.rotatePass(
    preview.team.id,
    "Original pass was lost",
  );
  await assert.rejects(admin.preview("RIH-DEMO-C-080", 1, "lunch"), {
    code: "QR_REVOKED",
  });
  await assert.rejects(
    admin.confirm(preview.id, crypto.randomUUID(), [0, 1, 2, 3]),
    {
      code: "QR_REVOKED",
    },
  );
  const fresh = await admin.preview(replacement, 1, "lunch");
  await admin.confirm(fresh.id, crypto.randomUUID(), [0, 1, 2, 3]);
  const secondReplacement = await admin.rotatePass(
    preview.team.id,
    "Replacement pass was exposed",
  );
  assert.equal(
    (await admin.preview(secondReplacement, 1, "lunch")).decision,
    "ALREADY_CONFIRMED",
  );
});

test("voids retain history and an idempotent replay reports the current voided status", async () => {
  const { admin } = await fixture();
  const preview = await admin.preview("RIH-DEMO-C-080", 1, "entry");
  const request = crypto.randomUUID();
  const receipt = await admin.confirm(preview.id, request, [0, 1, 2, 3]);
  await admin.voidClaim(receipt.claim.id, "Mistaken team selection");
  assert.equal(
    (await admin.confirm(preview.id, request, [0, 1, 2, 3])).code,
    "VOIDED",
  );
  assert.equal((await admin.commandStatus(request))?.code, "VOIDED");
  await assert.rejects(
    admin.confirm(preview.id, crypto.randomUUID(), [0, 1, 2, 3]),
    {
      code: "PREVIEW_CONSUMED",
    },
  );
  const newPreview = await admin.preview("RIH-DEMO-C-080", 1, "entry");
  assert.equal(
    (await admin.confirm(newPreview.id, crypto.randomUUID(), [0, 1, 2, 3]))
      .code,
    "CONFIRMED",
  );
  const history = (await admin.snapshot()).claims.filter(
    (claim) => claim.teamCode === "C-080",
  );
  assert.deepEqual(history.map((claim) => claim.status).sort(), [
    "confirmed",
    "voided",
  ]);
});

test("expired previews, closed windows and assignment changes stop confirmation", async () => {
  const { admin, gateway, advance } = await fixture();
  const volunteer = gateway();
  await volunteer.demoLogin("volunteer", "lunch");
  const expired = await volunteer.preview("RIH-DEMO-C-080", 1, "lunch");
  advance(60000);
  await assert.rejects(
    volunteer.confirm(expired.id, crypto.randomUUID(), [0, 1, 2, 3]),
    { code: "PREVIEW_EXPIRED" },
  );
  const preview = await volunteer.preview("RIH-DEMO-C-080", 1, "lunch");
  const snapshot = await admin.snapshot();
  const person = snapshot.staff.find((item) => item.id === "demo-lunch")!;
  await admin.assignStaff({ ...person, mode: "dinner" });
  await assert.rejects(
    volunteer.confirm(preview.id, crypto.randomUUID(), [0, 1, 2, 3]),
    { code: "FORBIDDEN" },
  );
  await admin.assignStaff(person);
  await assert.rejects(
    volunteer.confirm(preview.id, crypto.randomUUID(), [0, 1, 2, 3]),
    { code: "CONTEXT_CHANGED" },
  );
  const window = snapshot.schedules.find(
    (item) => item.day === 1 && item.mode === "lunch",
  )!;
  await admin.saveSchedule(
    { ...window, enabled: false },
    "Service has finished",
  );
  await assert.rejects(admin.preview("RIH-DEMO-C-080", 1, "lunch"), {
    code: "WINDOW_CLOSED",
  });
});

test("bulk import is atomic and updates preserve pass and claim identity", async () => {
  const { admin } = await fixture();
  const before = await admin.snapshot();
  const team = before.teams[0];
  const token = await admin.getPass(team.id);
  const update: Omit<Team, "id"> = { ...team, name: "Updated team name" };
  const invalid = { ...update, code: "Z-NEW", members: [] };
  await assert.rejects(admin.importTeams([update, invalid]), {
    code: "INVALID_TEAM",
  });
  assert.equal(
    (await admin.snapshot()).teams.find((item) => item.id === team.id)?.name,
    team.name,
  );
  await admin.importTeams([update]);
  assert.equal(
    (await admin.snapshot()).teams.find((item) => item.id === team.id)?.name,
    "Updated team name",
  );
  assert.equal(await admin.getPass(team.id), token);
  assert.deepEqual((await admin.snapshot()).claims, before.claims);
});

test("offline confirmations fail before a state change", async () => {
  const { admin } = await fixture();
  const preview = await admin.preview("RIH-DEMO-C-080", 1, "lunch");
  const initial = await activeCount(admin);
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  try {
    await assert.rejects(
      admin.confirm(preview.id, crypto.randomUUID(), [0, 1, 2, 3]),
      {
        code: "OFFLINE",
      },
    );
  } finally {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
  }
  assert.equal(await activeCount(admin), initial);
});
