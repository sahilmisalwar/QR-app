import { randomId } from "./id";
import { AppError, modes } from "./types";
import type {
  Audit,
  Category,
  Claim,
  Gateway,
  Mode,
  Preview,
  Receipt,
  Role,
  Schedule,
  Snapshot,
  Staff,
  Team,
} from "./types";

// This local rehearsal adapter contains synthetic data and is not an authentication boundary.
// Production authorization and duplicate protection belong to the Supabase adapter and database.
type LocalSession = { actorId: string; id: string };
type StoredPreview = Preview & {
  actorId: string;
  sessionId: string;
  assignment: string;
  assignmentRevision: number;
  teamRevision: number;
  scheduleRevision: number;
  tokenVersion: number;
  consumed: boolean;
};
type StoredReceipt = { fingerprint: string; receipt: Receipt };
type Token = { value: string; version: number; revoked: string[] };
type State = {
  teams: Team[];
  claims: Claim[];
  staff: Staff[];
  schedules: Schedule[];
  audit: Audit[];
  tokens: Record<string, Token>;
  teamRevisions: Record<string, number>;
  assignmentRevisions: Record<string, number>;
  previews: Record<string, StoredPreview>;
  receipts: Record<string, StoredReceipt>;
};
type DemoOptions = {
  storage?: Storage;
  databaseName?: string;
  now?: () => number;
};

const SESSION_KEY = "rih-demo-session-v1";
const STORE = "event";
const STATE_KEY = "state";
const REQUEST_ID = /^[\w-]{8,128}$/;

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `RIH-${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function makeSeed(now: number): State {
  const teams: Team[] = [];
  const groups: [Category, number][] = [
    ["A", 140],
    ["B", 130],
    ["C", 80],
  ];
  const names = [
    "Code",
    "Byte",
    "Tech",
    "Algo",
    "Pixel",
    "Logic",
    "Circuit",
    "Cloud",
    "Data",
    "Quantum",
  ];
  const endings = [
    "Pioneers",
    "Makers",
    "Rangers",
    "Innovators",
    "Builders",
    "Explorers",
    "Pilots",
  ];
  const overrides: Record<string, string> = {
    "A-034": "CodeCrafters",
    "B-067": "ByteBenders",
    "C-021": "TechNomads",
    "A-029": "AlgoRangers",
    "B-056": "NullPointers",
    "C-080": "NextGen Builders",
  };
  for (const [category, count] of groups) {
    for (let number = 1; number <= count; number++) {
      const code = `${category}-${String(number).padStart(3, "0")}`;
      teams.push({
        id: `demo-${code}`,
        code,
        category,
        active: true,
        name:
          overrides[code] ??
          `${names[number % names.length]}${endings[number % endings.length]} ${number}`,
        college:
          category === "C"
            ? "Nagpur Institute of Technology"
            : category === "B"
              ? "Nagpur College of Engineering"
              : "Vishwakarma Institute of Technology, Pune",
        members: [
          "Aarav Sharma",
          "Isha Kulkarni",
          "Aditya Patil",
          "Sneha Rane",
        ],
      });
    }
  }
  const staff: Staff[] = [
    {
      id: "demo-admin",
      name: "Event Administrator",
      role: "admin",
      mode: "entry",
      day: 1,
      active: true,
    },
    {
      id: "demo-entry",
      name: "Rohit Khadse",
      role: "volunteer",
      mode: "entry",
      day: 1,
      active: true,
    },
    {
      id: "demo-lunch",
      name: "Sneha Patil",
      role: "volunteer",
      mode: "lunch",
      day: 1,
      active: true,
    },
    {
      id: "demo-dinner",
      name: "Amit Deshmukh",
      role: "volunteer",
      mode: "dinner",
      day: 1,
      active: true,
    },
  ];
  const schedules: Schedule[] = [1, 2].flatMap((day) =>
    modes.map((mode) => ({
      id: `demo-${day}-${mode}`,
      day,
      mode,
      opens: new Date(now - 86400000).toISOString(),
      closes: new Date(now + 7 * 86400000).toISOString(),
      enabled: true,
      revision: 1,
    })),
  );
  const claims: Claim[] = [];
  const totals: Record<Mode, number> = { entry: 344, lunch: 287, dinner: 172 };
  for (const mode of modes) {
    const selected = teams.slice(0, totals[mode]);
    if (mode === "dinner")
      selected[selected.length - 1] = teams.find(
        (team) => team.code === "C-021",
      )!;
    selected.forEach((team, index) =>
      claims.push({
        id: `seed-${mode}-${team.id}`,
        teamId: team.id,
        teamCode: team.code,
        teamName: team.name,
        category: team.category,
        mode,
        day: 1,
        at: new Date(
          now - 60000 - (selected.length - index) * 15000,
        ).toISOString(),
        actor: staff.find(
          (person) => person.mode === mode && person.role === "volunteer",
        )!.name,
        status: "confirmed",
      }),
    );
  }
  // Place the familiar examples at the top without changing the total count.
  for (const [code, mode, offset] of [
    ["A-034", "lunch", 0],
    ["B-067", "entry", 1],
    ["C-021", "dinner", 2],
    ["A-029", "entry", 3],
    ["B-056", "lunch", 4],
  ] as const) {
    const claim = claims.find(
      (item) => item.teamCode === code && item.mode === mode,
    )!;
    claim.at = new Date(now - (offset + 1) * 60000).toISOString();
  }
  return {
    teams,
    claims,
    staff,
    schedules,
    audit: [
      {
        id: "demo-initialized",
        at: new Date(now).toISOString(),
        actor: "Rehearsal workspace",
        action: "Demo initialized",
        detail:
          "350 synthetic teams. Sample service windows are open for rehearsal.",
      },
    ],
    tokens: Object.fromEntries(
      teams.map((team) => [
        team.id,
        { value: `RIH-DEMO-${team.code}`, version: 1, revoked: [] },
      ]),
    ),
    teamRevisions: Object.fromEntries(teams.map((team) => [team.id, 1])),
    assignmentRevisions: Object.fromEntries(
      staff.map((person) => [person.id, 1]),
    ),
    previews: {},
    receipts: {},
  };
}

function online() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new AppError(
      "OFFLINE",
      "You are offline. Reconnect before verifying or confirming a team.",
    );
  }
}

function reasonText(reason: string) {
  const value = reason.trim();
  if (value.length < 3 || value.length > 500)
    throw new AppError(
      "REASON_REQUIRED",
      "Enter a reason between 3 and 500 characters.",
    );
  return value;
}

function assignment(staff: Staff) {
  return `${staff.role}/${staff.mode}/${staff.day}/${staff.active}`;
}

function requireActor(
  state: State,
  session: LocalSession | null,
  admin = false,
): Staff {
  const actor = state.staff.find(
    (person) => person.id === session?.actorId && person.active,
  );
  if (!actor)
    throw new AppError(
      "UNAUTHENTICATED",
      "Sign in to continue. Your assignment may have changed.",
    );
  if (admin && actor.role !== "admin")
    throw new AppError(
      "FORBIDDEN",
      "This action requires an event administrator.",
    );
  return actor;
}

function requireStation(actor: Staff, day: number, mode: Mode) {
  if (!modes.includes(mode) || ![1, 2].includes(day))
    throw new AppError(
      "INVALID_CONTEXT",
      "Choose a valid event day and checkpoint.",
    );
  if (
    actor.role === "volunteer" &&
    (actor.day !== day || actor.mode !== mode)
  ) {
    throw new AppError(
      "FORBIDDEN",
      "Your account is locked to its assigned day and checkpoint.",
    );
  }
}

function requireEligibility(
  state: State,
  team: Team,
  day: number,
  mode: Mode,
  now: number,
) {
  const schedule = state.schedules.find(
    (item) => item.day === day && item.mode === mode,
  );
  if (!team.active)
    throw new AppError(
      "INACTIVE_TEAM",
      "This team is inactive. Refer the team to the help desk.",
    );
  if (
    !schedule?.enabled ||
    now < Date.parse(schedule.opens) ||
    now >= Date.parse(schedule.closes)
  ) {
    throw new AppError(
      "WINDOW_CLOSED",
      "This checkpoint is closed. Ask an administrator to verify the schedule.",
    );
  }
  return schedule;
}

function addAudit(
  state: State,
  actor: Staff,
  action: string,
  detail: string,
  now: number,
) {
  state.audit.unshift({
    id: randomId(),
    at: new Date(now).toISOString(),
    actor: actor.name,
    action,
    detail,
  });
}

function effectiveReceipt(state: State, receipt: Receipt): Receipt {
  const claim = state.claims.find((item) => item.id === receipt.claim.id);
  if (!claim)
    throw new AppError(
      "RECEIPT_MISSING",
      "The recorded result could not be found. Contact an administrator.",
    );
  return { code: claim.status === "voided" ? "VOIDED" : receipt.code, claim };
}

function snapshotFor(state: State, actor: Staff, now: number): Snapshot {
  const admin = actor.role === "admin";
  return {
    teams: admin
      ? state.teams
      : state.teams.map((team) => ({ ...team, members: [] })),
    claims: state.claims
      .filter(
        (claim) =>
          admin || (claim.day === actor.day && claim.mode === actor.mode),
      )
      .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)),
    staff: admin ? state.staff : [actor],
    schedules: state.schedules.filter(
      (item) => admin || (item.day === actor.day && item.mode === actor.mode),
    ),
    audit: admin ? state.audit : [],
    serverTime: new Date(now).toISOString(),
  };
}

function saveTeamRecord(
  state: State,
  input: Omit<Team, "id"> & { id?: string },
  actor: Staff,
  now: number,
) {
  const code = input.code.trim().toUpperCase();
  if (
    !/^[A-Z0-9-]{2,24}$/.test(code) ||
    !input.name.trim() ||
    input.name.length > 120 ||
    !input.college.trim() ||
    input.college.length > 200 ||
    typeof input.active !== "boolean"
  ) {
    throw new AppError(
      "INVALID_TEAM",
      "Enter a valid team code, team name, college and active status.",
    );
  }
  if (
    !["A", "B", "C"].includes(input.category) ||
    input.members.length < 1 ||
    input.members.length > 20 ||
    input.members.some((name) => !name.trim() || name.length > 100)
  ) {
    throw new AppError(
      "INVALID_TEAM",
      "Select A, B or C and enter between 1 and 20 member names.",
    );
  }
  const existing = input.id
    ? state.teams.find((team) => team.id === input.id)
    : undefined;
  if (input.id && !existing)
    throw new AppError(
      "TEAM_NOT_FOUND",
      "This team no longer exists. Refresh the roster.",
    );
  if (state.teams.some((team) => team.code === code && team.id !== input.id))
    throw new AppError(
      "DUPLICATE_TEAM",
      "This team code is already registered.",
    );
  const team: Team = {
    id: existing?.id ?? randomId(),
    code,
    name: input.name.trim(),
    college: input.college.trim(),
    category: input.category,
    members: input.members.map((name) => name.trim()),
    active: input.active,
  };
  if (existing) Object.assign(existing, team);
  else {
    state.teams.push(team);
    state.tokens[team.id] = { value: randomToken(), version: 1, revoked: [] };
  }
  state.teamRevisions[team.id] = (state.teamRevisions[team.id] ?? 0) + 1;
  addAudit(
    state,
    actor,
    existing ? "Team updated" : "Team registered",
    `${team.code} · ${team.name}`,
    now,
  );
}

export function createDemoGateway(options: DemoOptions = {}): Gateway {
  const databaseName = options.databaseName ?? "rising-india-rehearsal-v1";
  const now = options.now ?? Date.now;
  const storage = () => options.storage ?? sessionStorage;
  let database: Promise<IDBDatabase> | undefined;

  function getSession(): LocalSession | null {
    try {
      return JSON.parse(
        storage().getItem(SESSION_KEY) ?? "null",
      ) as LocalSession | null;
    } catch {
      return null;
    }
  }

  function openDatabase() {
    database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          new AppError(
            "STORAGE_UNAVAILABLE",
            "Rehearsal storage is unavailable. Allow browser storage and try again.",
          ),
        );
    });
    return database;
  }

  async function transaction<T>(operation: (state: State) => T): Promise<T> {
    online();
    const execute = async () => {
      const db = await openDatabase();
      return new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const request = store.get(STATE_KEY);
        let result: T;
        let failure: unknown;
        request.onsuccess = () => {
          try {
            const state: State = request.result ?? makeSeed(now());
            state.assignmentRevisions ??= Object.fromEntries(
              state.staff.map((person) => [person.id, 1]),
            );
            result = operation(state);
            store.put(state, STATE_KEY);
          } catch (error) {
            failure = error;
            tx.abort();
          }
        };
        tx.oncomplete = () => resolve(structuredClone(result));
        tx.onerror = () =>
          reject(
            failure ??
              new AppError(
                "STORAGE_ERROR",
                "The local save failed. Keep this screen open and try again.",
              ),
          );
        tx.onabort = () =>
          reject(
            failure ??
              new AppError(
                "STORAGE_ERROR",
                "The local save was interrupted. Keep this screen open and try again.",
              ),
          );
      });
    };
    // IndexedDB also serializes the read/write store transaction if Web Locks is unavailable.
    if (typeof navigator !== "undefined" && navigator.locks)
      return navigator.locks.request(databaseName, execute);
    return execute();
  }

  return {
    kind: "demo",
    async session() {
      const session = getSession();
      if (!session) return null;
      return transaction(
        (state) =>
          state.staff.find(
            (person) => person.id === session.actorId && person.active,
          ) ?? null,
      );
    },
    async login() {
      throw new AppError(
        "DEMO_MODE",
        "Use a rehearsal account below. Staff email sign-in becomes available when Supabase is configured.",
      );
    },
    async demoLogin(role: Role, mode: Mode = "entry") {
      const actor = await transaction((state) => {
        const id = role === "admin" ? "demo-admin" : `demo-${mode}`;
        const person = state.staff.find(
          (item) => item.id === id && item.active,
        );
        if (!person)
          throw new AppError(
            "ACCOUNT_DISABLED",
            "This rehearsal account has been disabled by an administrator.",
          );
        return person;
      });
      storage().setItem(
        SESSION_KEY,
        JSON.stringify({ actorId: actor.id, id: randomId() }),
      );
      return actor;
    },
    async logout() {
      storage().removeItem(SESSION_KEY);
    },
    async snapshot() {
      return transaction((state) =>
        snapshotFor(state, requireActor(state, getSession()), now()),
      );
    },
    async preview(token: string, day: number, mode: Mode) {
      return transaction((state) => {
        const session = getSession();
        const actor = requireActor(state, session);
        requireStation(actor, day, mode);
        const normalized = token.trim();
        const tokenPair = Object.entries(state.tokens).find(
          ([, item]) => item.value === normalized,
        );
        if (!tokenPair) {
          const revoked = Object.values(state.tokens).some((item) =>
            item.revoked.includes(normalized),
          );
          throw new AppError(
            revoked ? "QR_REVOKED" : "INVALID_QR",
            revoked
              ? "This QR was replaced. Use the team’s latest pass."
              : "This QR is not a valid team pass. Rescan or contact the help desk.",
          );
        }
        const [teamId, currentToken] = tokenPair;
        const team = state.teams.find((item) => item.id === teamId)!;
        const schedule = requireEligibility(state, team, day, mode, now());
        const previous = state.claims.find(
          (item) =>
            item.teamId === teamId &&
            item.day === day &&
            item.mode === mode &&
            item.status === "confirmed",
        );
        const preview: Preview = {
          id: randomId(),
          team,
          mode,
          day,
          expires: new Date(now() + 60000).toISOString(),
          decision: previous ? "ALREADY_CONFIRMED" : "ELIGIBLE",
          previous,
        };
        for (const [id, stored] of Object.entries(state.previews)) {
          if (Date.parse(stored.expires) < now() - 86400000)
            delete state.previews[id];
        }
        state.previews[preview.id] = {
          ...preview,
          actorId: actor.id,
          sessionId: session!.id,
          assignment: assignment(actor),
          assignmentRevision: state.assignmentRevisions[actor.id],
          teamRevision: state.teamRevisions[teamId],
          scheduleRevision: schedule.revision,
          tokenVersion: currentToken.version,
          consumed: false,
        };
        return preview;
      });
    },
    async confirm(previewId: string, requestId: string, fullTeam: boolean) {
      return transaction((state) => {
        const session = getSession();
        const actor = requireActor(state, session);
        if (!REQUEST_ID.test(requestId))
          throw new AppError(
            "INVALID_REQUEST",
            "The request identifier is invalid. Scan again.",
          );
        const key = `${actor.id}/${requestId}`;
        const fingerprint = JSON.stringify([previewId, fullTeam]);
        const prior = state.receipts[key];
        if (prior) {
          if (prior.fingerprint !== fingerprint)
            throw new AppError(
              "REQUEST_REUSED",
              "This confirmation identifier was already used for a different action.",
            );
          requireStation(
            actor,
            prior.receipt.claim.day,
            prior.receipt.claim.mode,
          );
          return effectiveReceipt(state, prior.receipt);
        }
        const preview = state.previews[previewId];
        if (
          !preview ||
          preview.actorId !== actor.id ||
          preview.sessionId !== session!.id
        )
          throw new AppError(
            "PREVIEW_INVALID",
            "Scan this team again before confirming.",
          );
        requireStation(actor, preview.day, preview.mode);
        if (
          assignment(actor) !== preview.assignment ||
          state.assignmentRevisions[actor.id] !== preview.assignmentRevision
        )
          throw new AppError(
            "CONTEXT_CHANGED",
            "Your assignment changed. Scan the team again.",
          );
        if (preview.mode !== "entry" && fullTeam !== true)
          throw new AppError(
            "FULL_TEAM_REQUIRED",
            "Verify that every registered member is present before confirming a meal.",
          );
        if (Date.parse(preview.expires) <= now())
          throw new AppError(
            "PREVIEW_EXPIRED",
            "This verification expired. Scan the QR again.",
          );
        const team = state.teams.find((item) => item.id === preview.team.id)!;
        const currentToken = state.tokens[team.id];
        if (currentToken.version !== preview.tokenVersion)
          throw new AppError(
            "QR_REVOKED",
            "This QR was replaced after the scan. Ask for the new pass.",
          );
        const schedule = requireEligibility(
          state,
          team,
          preview.day,
          preview.mode,
          now(),
        );
        if (
          state.teamRevisions[team.id] !== preview.teamRevision ||
          schedule.revision !== preview.scheduleRevision
        )
          throw new AppError(
            "CONTEXT_CHANGED",
            "The roster or schedule changed. Verify the team again.",
          );
        const existing = state.claims.find(
          (item) =>
            item.teamId === team.id &&
            item.day === preview.day &&
            item.mode === preview.mode &&
            item.status === "confirmed",
        );
        let receipt: Receipt;
        if (existing) {
          receipt = { code: "ALREADY_CONFIRMED", claim: existing };
          addAudit(
            state,
            actor,
            "Duplicate blocked",
            `${team.code} · Day ${preview.day} · ${preview.mode}`,
            now(),
          );
        } else {
          if (preview.consumed)
            throw new AppError(
              "PREVIEW_CONSUMED",
              "This scan was already used. Start a fresh scan.",
            );
          const claim: Claim = {
            id: randomId(),
            teamId: team.id,
            teamCode: team.code,
            teamName: team.name,
            category: team.category,
            mode: preview.mode,
            day: preview.day,
            at: new Date(now()).toISOString(),
            actor: actor.name,
            status: "confirmed",
          };
          state.claims.push(claim);
          receipt = { code: "CONFIRMED", claim };
          addAudit(
            state,
            actor,
            "Check-in confirmed",
            `${team.code} · Day ${preview.day} · ${preview.mode}${preview.mode === "entry" ? "" : " · full team present"}`,
            now(),
          );
        }
        preview.consumed = true;
        state.receipts[key] = { fingerprint, receipt };
        return receipt;
      });
    },
    async commandStatus(requestId: string) {
      return transaction((state) => {
        const actor = requireActor(state, getSession());
        const stored = state.receipts[`${actor.id}/${requestId}`];
        if (!stored) return null;
        requireStation(
          actor,
          stored.receipt.claim.day,
          stored.receipt.claim.mode,
        );
        return effectiveReceipt(state, stored.receipt);
      });
    },
    async saveTeam(input) {
      return transaction((state) => {
        const actor = requireActor(state, getSession(), true);
        saveTeamRecord(state, input, actor, now());
      });
    },
    async importTeams(teams) {
      return transaction((state) => {
        const actor = requireActor(state, getSession(), true);
        if (!teams.length || teams.length > 5000)
          throw new AppError(
            "INVALID_BATCH",
            "Import between 1 and 5,000 teams at a time.",
          );
        const codes = teams.map((team) => team.code.trim().toUpperCase());
        if (new Set(codes).size !== codes.length)
          throw new AppError(
            "DUPLICATE_TEAM",
            "The import contains duplicate team codes.",
          );
        teams.forEach((team, index) => {
          const existing = state.teams.find(
            (item) => item.code === codes[index],
          );
          saveTeamRecord(state, { ...team, id: existing?.id }, actor, now());
        });
        addAudit(
          state,
          actor,
          "Roster imported",
          `${teams.length} reviewed team records`,
          now(),
        );
      });
    },
    async getPass(teamId: string) {
      return transaction((state) => {
        const actor = requireActor(state, getSession(), true);
        const team = state.teams.find((item) => item.id === teamId);
        if (!team || !team.active)
          throw new AppError(
            "TEAM_NOT_FOUND",
            "Select an active registered team.",
          );
        addAudit(state, actor, "Team pass downloaded", team.code, now());
        return state.tokens[teamId].value;
      });
    },
    async rotatePass(teamId: string, reason: string) {
      return transaction((state) => {
        const actor = requireActor(state, getSession(), true);
        const explanation = reasonText(reason);
        const token = state.tokens[teamId];
        const team = state.teams.find((item) => item.id === teamId);
        if (!token || !team?.active)
          throw new AppError(
            "TEAM_NOT_FOUND",
            "Select an active registered team.",
          );
        token.revoked.push(token.value);
        token.value = randomToken();
        token.version++;
        addAudit(
          state,
          actor,
          "QR reissued",
          `${team.code} · ${explanation}`,
          now(),
        );
        return token.value;
      });
    },
    async voidClaim(claimId: string, reason: string) {
      return transaction((state) => {
        const actor = requireActor(state, getSession(), true);
        const explanation = reasonText(reason);
        const claim = state.claims.find((item) => item.id === claimId);
        if (!claim)
          throw new AppError(
            "CLAIM_NOT_FOUND",
            "This check-in could not be found.",
          );
        if (claim.status === "voided")
          throw new AppError(
            "ALREADY_VOIDED",
            "This check-in has already been reversed.",
          );
        claim.status = "voided";
        claim.reason = explanation;
        addAudit(
          state,
          actor,
          "Check-in corrected",
          `${claim.teamCode} · ${claim.mode} · ${explanation}`,
          now(),
        );
      });
    },
    async saveSchedule(input: Schedule, reason: string) {
      return transaction((state) => {
        const actor = requireActor(state, getSession(), true);
        const explanation = reasonText(reason);
        const existing = state.schedules.find((item) => item.id === input.id);
        if (
          !existing ||
          existing.day !== input.day ||
          existing.mode !== input.mode
        )
          throw new AppError(
            "INVALID_SCHEDULE",
            "The event day and checkpoint identity cannot be changed.",
          );
        if (input.revision !== existing.revision)
          throw new AppError(
            "CONFLICT",
            "This schedule was edited elsewhere. Refresh before saving.",
          );
        if (
          !Number.isFinite(Date.parse(input.opens)) ||
          !Number.isFinite(Date.parse(input.closes)) ||
          Date.parse(input.opens) >= Date.parse(input.closes)
        )
          throw new AppError(
            "INVALID_SCHEDULE",
            "The closing time must be after the opening time.",
          );
        Object.assign(existing, input, {
          revision: existing.revision + 1,
        });
        addAudit(
          state,
          actor,
          "Schedule updated",
          `Day ${input.day} · ${input.mode} · ${explanation}`,
          now(),
        );
      });
    },
    async assignStaff(input: Staff) {
      return transaction((state) => {
        const actor = requireActor(state, getSession(), true);
        const existing = state.staff.find((person) => person.id === input.id);
        if (
          !existing ||
          existing.role !== "volunteer" ||
          input.role !== "volunteer"
        )
          throw new AppError(
            "FORBIDDEN",
            "Only existing volunteer assignments can be changed here.",
          );
        if (!modes.includes(input.mode) || ![1, 2].includes(input.day))
          throw new AppError(
            "INVALID_ASSIGNMENT",
            "Choose a valid event day and checkpoint.",
          );
        existing.mode = input.mode;
        existing.day = input.day;
        existing.active = input.active;
        state.assignmentRevisions[existing.id] =
          (state.assignmentRevisions[existing.id] ?? 1) + 1;
        addAudit(
          state,
          actor,
          "Volunteer assignment updated",
          `${existing.name} · Day ${input.day} · ${input.mode}${input.active ? "" : " · disabled"}`,
          now(),
        );
      });
    },
    async exportData() {
      return transaction((state) => {
        const actor = requireActor(state, getSession(), true);
        addAudit(
          state,
          actor,
          "Operational data exported",
          "Roster, check-ins, schedules and audit history",
          now(),
        );
        return snapshotFor(state, actor, now());
      });
    },
    async resetDemo() {
      return transaction((state) => {
        requireActor(state, getSession(), true);
        Object.assign(state, makeSeed(now()));
      });
    },
  };
}

export const demoGateway = createDemoGateway();
