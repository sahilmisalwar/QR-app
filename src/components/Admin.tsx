import { useEffect, useRef, useState } from "react";
import {
  Home,
  Users,
  QrCode,
  History,
  UserRound,
  ChartNoAxesCombined,
  Settings,
  Layers,
  RefreshCw,
  ArrowRight,
  Plus,
  Download,
  Search,
  ShieldCheck,
  Clock3,
  Wifi,
  FileCheck2,
  RotateCcw,
  LockKeyhole,
  CalendarDays,
  LogOut,
  Menu,
  Check,
  X,
  Upload,
  ClipboardList,
  ChevronDown,
  Zap,
  CircleHelp,
} from "lucide-react";
import type {
  Gateway,
  Staff,
  Snapshot,
  Mode,
  Category,
  Team,
  Claim,
  Schedule,
} from "../lib/types";
import { modes, labels, categories, formatTime } from "../lib/types";
import { Brand, ModeIcon, Modal, downloadFile } from "./shared";
import { csvCell, parseRoster } from "../lib/csv";

type Page =
  | "overview"
  | "teams"
  | "passes"
  | "history"
  | "volunteers"
  | "operations"
  | "reports"
  | "settings";
type Dialog =
  | { type: "team"; team?: Team }
  | { type: "pass"; team: Team; token: string }
  | { type: "void"; claim: Claim }
  | { type: "schedule"; schedule: Schedule }
  | { type: "staff"; staff: Staff }
  | { type: "import"; teams: Array<Omit<Team, "id">> }
  | { type: "help" }
  | null;
interface Props {
  gateway: Gateway;
  user: Staff;
  snapshot: Snapshot;
  refresh: () => Promise<void>;
  onLogout: () => void;
}
const navigation = [
  { id: "overview", label: "Event Overview", icon: Home },
  { id: "teams", label: "Team Management", icon: Users },
  { id: "passes", label: "QR Passes", icon: QrCode },
  { id: "history", label: "Scanning History", icon: History },
  { id: "volunteers", label: "Volunteers", icon: UserRound },
  { id: "operations", label: "Event Operations", icon: Layers },
  { id: "reports", label: "Reports & Export", icon: ChartNoAxesCombined },
  { id: "settings", label: "Settings", icon: Settings },
] as const;
const descriptions: Record<Page, string> = {
  overview: "Real-time check-in and event progress",
  teams: "Your teams, ready for the big day",
  passes: "One team pass for every checkpoint.",
  history: "Every confirmation, with a clear trail",
  volunteers: "The people keeping your event moving",
  operations: "Checkpoint schedules and operational safeguards",
  reports: "Your event records, ready to take with you",
  settings: "Event setup and connection details",
};

function StatCard({
  mode,
  count,
  total,
}: {
  mode: Mode;
  count: number;
  total: number;
}) {
  const percent = total ? Math.round((count / total) * 100) : 0;
  return (
    <article className={`stat-card ${mode}`}>
      <div className="stat-title">
        <span className="stat-icon">
          <ModeIcon mode={mode} />
        </span>
        <h3>{labels[mode]}</h3>
      </div>
      <div className="stat-values">
        <strong>
          {count}
          <span> / {total}</span>
        </strong>
        <div
          className="small-ring"
          style={{ "--progress": `${percent * 3.6}deg` } as React.CSSProperties}
        >
          <b>{total ? `${percent}%` : "—"}</b>
        </div>
      </div>
      <div className="stat-wave" />
    </article>
  );
}
function Badge({ mode }: { mode: Mode }) {
  return (
    <span className={`mode-tag ${mode}`}>
      <ModeIcon mode={mode} size={13} />
      {labels[mode]}
    </span>
  );
}
function HistoryTable({
  claims,
  onVoid,
}: {
  claims: Claim[];
  onVoid?: (c: Claim) => void;
}) {
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Team ID</th>
            <th>Team name</th>
            <th>Category</th>
            <th>Checkpoint</th>
            <th>Time</th>
            <th>Status</th>
            {onVoid && (
              <th>
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {claims.map((c) => (
            <tr key={c.id}>
              <td>
                <span className="team-code">{c.teamCode}</span>
              </td>
              <td className="team-name">{c.teamName}</td>
              <td>
                <span className={`category-badge cat-${c.category}`}>
                  {c.category}
                </span>
              </td>
              <td>
                <Badge mode={c.mode} />
              </td>
              <td className="muted nowrap">{formatTime(c.at)}</td>
              <td>
                {c.status === "confirmed" ? (
                  <span className="success-check" aria-label="Confirmed">
                    <Check size={13} />
                  </span>
                ) : (
                  <span className="status-void">Reversed</span>
                )}
              </td>
              {onVoid && (
                <td>
                  {c.status === "confirmed" && (
                    <button className="text-button" onClick={() => onVoid(c)}>
                      Correct
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!claims.length && (
        <div className="empty">
          <History />
          <h3>No activity in this view</h3>
          <p>Confirmed check-ins will appear here.</p>
        </div>
      )}
    </div>
  );
}

export function Admin({ gateway, user, snapshot, refresh, onLogout }: Props) {
  const [page, setPage] = useState<Page>("overview");
  const [day, setDay] = useState(1);
  const [category, setCategory] = useState("all");
  const [modeFilter, setModeFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [page]);

  useEffect(() => {
    if (!mobileMenu) return;
    const sidebar = sidebarRef.current!;
    const viewport = window.matchMedia("(max-width: 760px)");
    const closeOnDesktop = () => {
      if (!viewport.matches) setMobileMenu(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileMenu(false);
      }
      if (event.key === "Tab") {
        const buttons = sidebar.querySelectorAll<HTMLButtonElement>("button");
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    sidebar.querySelector<HTMLButtonElement>(".sidebar-close")?.focus();
    document.addEventListener("keydown", onKeyDown);
    viewport.addEventListener("change", closeOnDesktop);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      viewport.removeEventListener("change", closeOnDesktop);
      menuButtonRef.current?.focus({ preventScroll: true });
    };
  }, [mobileMenu]);
  const [limit, setLimit] = useState(25);
  const [qrImage, setQrImage] = useState("");
  const [rotateReason, setRotateReason] = useState("");
  const teamScope = snapshot.teams.filter(
    (t) => t.active && (category === "all" || t.category === category),
  );
  const totals = Object.fromEntries(
    modes.map((mode) => {
      const schedule = snapshot.schedules.find(
        (s) => s.day === day && s.mode === mode,
      );
      const teams = schedule?.enabled ? teamScope : [];
      const ids = new Set(teams.map((t) => t.id));
      return [
        mode,
        {
          total: teams.length,
          count: snapshot.claims.filter(
            (c) =>
              c.day === day &&
              c.mode === mode &&
              c.status === "confirmed" &&
              ids.has(c.teamId),
          ).length,
        },
      ];
    }),
  ) as Record<Mode, { total: number; count: number }>;
  const eligible = modes.reduce((sum, m) => sum + totals[m].total, 0);
  const completed = modes.reduce((sum, m) => sum + totals[m].count, 0);
  const overall = eligible ? Math.round((completed / eligible) * 100) : 0;
  const history = snapshot.claims
    .filter(
      (c) =>
        c.day === day &&
        (category === "all" || c.category === category) &&
        (modeFilter === "all" || c.mode === modeFilter) &&
        `${c.teamCode} ${c.teamName}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => b.at.localeCompare(a.at));
  const teams = teamScope.filter((t) =>
    `${t.code} ${t.name} ${t.college}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const recent =
    snapshot.serverTime &&
    Date.now() - new Date(snapshot.serverTime).getTime() < 15000;
  function navigate(next: Page) {
    setPage(next);
    setQuery("");
    setLimit(25);
    setMobileMenu(false);
    setError("");
  }
  async function run(action: () => Promise<void>, message?: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
      if (message) setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function openPass(team: Team) {
    await run(async () => {
      const token = await gateway.getPass(team.id);
      const QR = await import("qrcode");
      setQrImage(
        await QR.toDataURL(token, {
          width: 480,
          margin: 4,
          errorCorrectionLevel: "M",
        }),
      );
      setRotateReason("");
      setDialog({ type: "pass", team, token });
    });
  }
  async function exportRecords(kind: "claims" | "teams" | "audit") {
    await run(async () => {
      const exported = await gateway.exportData();
      let rows: unknown[][];
      if (kind === "claims")
        rows = [
          [
            "Team ID",
            "Team name",
            "Day",
            "Checkpoint",
            "Category",
            "Confirmed at UTC",
            "Operator",
            "Status",
            "Reason",
          ],
          ...exported.claims
            .filter(
              (c) =>
                c.day === day &&
                (category === "all" || c.category === category) &&
                (modeFilter === "all" || c.mode === modeFilter),
            )
            .map((c) => [
              c.teamCode,
              c.teamName,
              c.day,
              c.mode,
              c.category,
              c.at,
              c.actor,
              c.status,
              c.reason,
            ]),
        ];
      else if (kind === "teams")
        rows = [
          ["Team ID", "Team name", "College", "Category", "Members", "Active"],
          ...exported.teams
            .filter((t) => category === "all" || t.category === category)
            .map((t) => [
              t.code,
              t.name,
              t.college,
              t.category,
              t.members.length,
              t.active,
            ]),
        ];
      else
        rows = [
          ["Time UTC", "Operator", "Action", "Detail"],
          ...exported.audit.map((a) => [a.at, a.actor, a.action, a.detail]),
        ];
      downloadFile(
        `RIH-${kind}-day-${day}-${new Date().toISOString().slice(0, 10)}.csv`,
        "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n"),
      );
    }, "Export downloaded");
  }
  async function readImport(file?: File) {
    if (!file) return;
    try {
      setDialog({ type: "import", teams: parseRoster(await file.text()) });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const quickActions = [
    {
      label: "Generate Team Pass",
      icon: QrCode,
      tone: "teal",
      action: () => navigate("passes"),
    },
    {
      label: "Add New Team",
      icon: Users,
      tone: "blue",
      action: () => setDialog({ type: "team" }),
    },
    {
      label: "Export Reports",
      icon: Download,
      tone: "purple",
      action: () => navigate("reports"),
    },
    {
      label: "Correct Check-in",
      icon: RotateCcw,
      tone: "amber",
      action: () => navigate("history"),
    },
  ];
  return (
    <div className={`admin-app ${mobileMenu ? "menu-open" : ""}`}>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <header className="masthead">
        <div className="masthead-accent" />
        <Brand />
        <div className="masthead-end" />
      </header>
      {mobileMenu && (
        <button
          className="sidebar-backdrop"
          aria-label="Dismiss navigation"
          tabIndex={-1}
          onClick={() => setMobileMenu(false)}
        />
      )}
      <aside
        ref={sidebarRef}
        id="admin-navigation"
        className={`sidebar ${mobileMenu ? "is-open" : ""}`}
        role={mobileMenu ? "dialog" : undefined}
        aria-modal={mobileMenu ? true : undefined}
        aria-label="Admin navigation"
      >
        <button
          className="sidebar-close"
          aria-label="Close navigation"
          onClick={() => setMobileMenu(false)}
        >
          <X size={18} />
        </button>
        <div className="sidebar-title">
          <strong>
            RIH <span>2.0</span>
          </strong>
          <small>Admin workspace</small>
        </div>
        <nav aria-label="Main navigation">
          {navigation.map((n) => (
            <button
              key={n.id}
              onClick={() => navigate(n.id)}
              className={page === n.id ? "active" : ""}
              aria-current={page === n.id ? "page" : undefined}
            >
              <n.icon size={20} />
              {n.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-event">
          <span className="event-line" />
          <span className="eyebrow">BUILDING WHAT'S NEXT</span>
          <strong>
            Rising India
            <br />
            Hackathon 2.0
          </strong>
          <div>
            <span className="status-dot" />{" "}
            {gateway.kind === "demo"
              ? "Rehearsal workspace"
              : "Event operations"}
          </div>
          <small>NIT Nagpur · Team Nexus</small>
        </div>
        <button className="sidebar-signout" onClick={onLogout}>
          <LogOut size={17} />
          Sign out
        </button>
      </aside>
      <main ref={mainRef} id="main" className="admin-main" inert={mobileMenu}>
        <div className="page-heading">
          <div className="heading-group">
            <button
              className="mobile-menu icon-button"
              ref={menuButtonRef}
              aria-label="Toggle navigation"
              aria-expanded={mobileMenu}
              aria-controls="admin-navigation"
              onClick={() => setMobileMenu(!mobileMenu)}
            >
              <Menu />
            </button>
            <span className="heading-marker" />
            <div>
              <h1>{navigation.find((n) => n.id === page)?.label}</h1>
              <p>{descriptions[page]}</p>
            </div>
          </div>
          <button
            className="profile-control"
            onClick={() => setDialog({ type: "help" })}
          >
            <span className="avatar">{user.name[0]}</span>
            <span>
              <strong>{user.name}</strong>
              <small>Event administrator</small>
            </span>
            <ChevronDown size={17} />
          </button>
        </div>
        <div className="filter-toolbar">
          <div className="filter">
            <CalendarDays size={19} />
            <label htmlFor="event-day">Event Day</label>
            <select
              id="event-day"
              value={day}
              onChange={(e) => setDay(Number(e.target.value))}
            >
              <option value={1}>Day 1</option>
              <option value={2}>Day 2</option>
            </select>
          </div>
          <div className="filter">
            <Users size={19} />
            <label htmlFor="team-category">Team Category</label>
            <select
              id="team-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="all">All Categories (A + B + C)</option>
              {Object.entries(categories).map(([key, name]) => (
                <option key={key} value={key}>
                  {key} · {name}
                </option>
              ))}
            </select>
          </div>
          <div className="freshness">
            <span className={`live-badge ${recent ? "" : "stale"}`}>
              <span className="status-dot" />
              {gateway.kind === "demo"
                ? "Local demo"
                : recent
                  ? "Live"
                  : "Reconnecting"}
            </span>
            <small>Updated {formatTime(snapshot.serverTime)}</small>
            <button
              className="icon-button"
              aria-label="Refresh dashboard"
              disabled={busy}
              onClick={() => void run(refresh)}
            >
              <RefreshCw size={19} className={busy ? "spin" : ""} />
            </button>
          </div>
        </div>
        {gateway.kind === "demo" && (
          <div className="demo-notice">
            <span>REHEARSAL</span>Sample teams and schedules. Explore safely
            before connecting your event.
            <button onClick={() => navigate("settings")}>
              Setup details <ArrowRight size={13} />
            </button>
          </div>
        )}
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="toast" role="status">
            <Check size={16} />
            {notice}
            <button
              aria-label="Dismiss notification"
              onClick={() => setNotice("")}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {page === "overview" && (
          <>
            <section className="stats-grid">
              {modes.map((m) => (
                <StatCard key={m} mode={m} {...totals[m]} />
              ))}
              <article className="stat-card remaining">
                <div className="stat-title">
                  <span className="stat-icon">
                    <Users size={22} />
                  </span>
                  <h3>Remaining for Lunch</h3>
                </div>
                <div className="remaining-count">
                  {totals.lunch.total - totals.lunch.count}
                </div>
                <small>of {totals.lunch.total} eligible teams</small>
                <div className="stat-wave" />
              </article>
            </section>
            <div className="progress-grid">
              <section className="panel">
                <div className="panel-heading">
                  <h2>
                    <ChartNoAxesCombined />
                    Overall Progress
                  </h2>
                  <small>Across all checkpoints</small>
                </div>
                <div className="overall-content">
                  <div
                    className="large-ring"
                    style={
                      {
                        "--progress": `${overall * 3.6}deg`,
                      } as React.CSSProperties
                    }
                  >
                    <div>
                      <strong>{eligible ? overall + "%" : "—"}</strong>
                      <span>
                        Overall
                        <br />
                        completed
                      </span>
                    </div>
                  </div>
                  <div className="progress-metrics">
                    <div>
                      <span>
                        <Check className="green-icon" />
                        Completed
                      </span>
                      <strong>{completed.toLocaleString()}</strong>
                    </div>
                    <div>
                      <span>
                        <Clock3 />
                        Remaining
                      </span>
                      <strong>{(eligible - completed).toLocaleString()}</strong>
                    </div>
                    <div>
                      <span>
                        <Users />
                        Eligible actions
                      </span>
                      <strong>{eligible.toLocaleString()}</strong>
                    </div>
                  </div>
                </div>
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <h2>
                    <Layers />
                    Checkpoint Progress
                  </h2>
                </div>
                <div className="checkpoint-bars">
                  {modes.map((m) => (
                    <div className={`checkpoint-row ${m}`} key={m}>
                      <span>
                        <ModeIcon mode={m} />
                        {labels[m]}
                      </span>
                      <div className="progress-track">
                        <i
                          style={{
                            width: `${totals[m].total ? (totals[m].count / totals[m].total) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <strong>
                        {totals[m].total
                          ? Math.round(
                              (totals[m].count / totals[m].total) * 100,
                            ) + "%"
                          : "—"}
                      </strong>
                    </div>
                  ))}
                </div>
                <p className="panel-note">
                  Each team has one entitlement per checkpoint and event day.
                </p>
              </section>
            </div>
            <div className="overview-bottom">
              <section className="panel">
                <div className="panel-heading">
                  <h2>
                    <History />
                    Recent Scanning History
                  </h2>
                  <button
                    className="text-button"
                    onClick={() => navigate("history")}
                  >
                    View all <ArrowRight size={16} />
                  </button>
                </div>
                <HistoryTable claims={history.slice(0, 5)} />
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <h2>
                    <Zap className="amber-icon" />
                    Quick Actions
                  </h2>
                </div>
                <div className="quick-actions">
                  {quickActions.map((a) => (
                    <button key={a.label} className={a.tone} onClick={a.action}>
                      <a.icon size={29} />
                      <strong>{a.label}</strong>
                    </button>
                  ))}
                </div>
              </section>
            </div>
            <div className="workspace-footer">
              <span>
                <ShieldCheck size={14} />
                Human confirmed. Duplicate protected.
              </span>
              <button
                className="text-button"
                onClick={() => navigate("operations")}
              >
                View event safeguards <ArrowRight size={14} />
              </button>
            </div>
          </>
        )}
        {(page === "teams" || page === "passes") && (
          <section className="panel">
            <div className="section-toolbar">
              <div>
                <h2>
                  {page === "teams" ? "Registered teams" : "Team QR passes"}{" "}
                  <span className="count-chip">{teams.length}</span>
                </h2>
                <p>
                  {page === "teams"
                    ? "Search, verify and maintain your event roster."
                    : "The same pass works at every open checkpoint."}
                </p>
              </div>
              <div className="button-row">
                {page === "teams" && (
                  <>
                    <label className="button upload-label">
                      <Upload size={16} />
                      Import CSV
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        onChange={(e) => {
                          void readImport(e.target.files?.[0]);
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                    <button
                      className="button primary"
                      onClick={() => setDialog({ type: "team" })}
                    >
                      <Plus size={16} />
                      Add team
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="search-box">
              <Search size={18} />
              <input
                aria-label="Search teams"
                placeholder="Search by team ID, team name or college…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setLimit(25);
                }}
              />
              {page === "teams" && (
                <button
                  className="text-button"
                  onClick={() =>
                    downloadFile(
                      "team-import-template.csv",
                      "code,name,college,category,members\nA-351,Example Team,Example College,A,Member One|Member Two|Member Three|Member Four",
                    )
                  }
                >
                  Get CSV template
                </button>
              )}
            </div>
            <div className="table-scroll">
              <table className="data-table teams-table">
                <thead>
                  <tr>
                    <th>Team ID</th>
                    <th>Team / Institution</th>
                    <th>Category</th>
                    <th>Members</th>
                    <th>Day {day} status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {teams.slice(0, limit).map((t) => (
                    <tr key={t.id}>
                      <td>
                        <span className="team-code">{t.code}</span>
                      </td>
                      <td>
                        <strong>{t.name}</strong>
                        <small>{t.college}</small>
                      </td>
                      <td>
                        <span className={`category-badge cat-${t.category}`}>
                          {t.category}
                        </span>
                      </td>
                      <td>{t.members.length}</td>
                      <td>
                        <div className="team-status">
                          {modes.map((m) => (
                            <span
                              key={m}
                              title={`${labels[m]} ${snapshot.claims.some((c) => c.teamId === t.id && c.day === day && c.mode === m && c.status === "confirmed") ? "confirmed" : "pending"}`}
                              className={
                                snapshot.claims.some(
                                  (c) =>
                                    c.teamId === t.id &&
                                    c.day === day &&
                                    c.mode === m &&
                                    c.status === "confirmed",
                                )
                                  ? m
                                  : "pending"
                              }
                            >
                              <ModeIcon mode={m} size={14} />
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <div className="button-row">
                          <button
                            className="text-button"
                            onClick={() => void openPass(t)}
                          >
                            <QrCode size={15} />
                            Pass
                          </button>
                          {page === "teams" && (
                            <button
                              className="text-button"
                              onClick={() =>
                                setDialog({ type: "team", team: t })
                              }
                            >
                              Edit
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!teams.length && (
              <div className="empty">
                <Users />
                <h3>No teams match your search</h3>
                <p>Try another name or category.</p>
              </div>
            )}
            {teams.length > limit && (
              <button
                className="button load-more"
                onClick={() => setLimit(limit + 25)}
              >
                Show more teams
              </button>
            )}
          </section>
        )}
        {page === "history" && (
          <section className="panel">
            <div className="section-toolbar">
              <div>
                <h2>
                  Checkpoint history{" "}
                  <span className="count-chip">{history.length}</span>
                </h2>
                <p>
                  Reversals preserve the original record and require a reason.
                </p>
              </div>
              <button
                className="button"
                onClick={() => void exportRecords("claims")}
                disabled={busy}
              >
                <Download size={16} />
                Export this view
              </button>
            </div>
            <div className="history-filters">
              <div className="search-box">
                <Search size={17} />
                <input
                  aria-label="Search history"
                  placeholder="Find a team…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <select
                aria-label="Checkpoint filter"
                value={modeFilter}
                onChange={(e) => setModeFilter(e.target.value)}
              >
                <option value="all">All checkpoints</option>
                {modes.map((m) => (
                  <option key={m} value={m}>
                    {labels[m]}
                  </option>
                ))}
              </select>
            </div>
            <HistoryTable
              claims={history.slice(0, limit)}
              onVoid={(c) => setDialog({ type: "void", claim: c })}
            />
            {history.length > limit && (
              <button
                className="button load-more"
                onClick={() => setLimit(limit + 25)}
              >
                Show more activity
              </button>
            )}
          </section>
        )}
        {page === "volunteers" && (
          <>
            <section className="panel section-toolbar">
              <div>
                <h2>Volunteer assignments</h2>
                <p>Each volunteer is locked to one event day and checkpoint.</p>
              </div>
              <span className="security-pill">
                <LockKeyhole size={16} />
                Assigned access
              </span>
            </section>
            <div className="staff-grid">
              {snapshot.staff
                .filter((s) => s.role === "volunteer")
                .map((s) => (
                  <section className="panel staff-card" key={s.id}>
                    <div className="staff-card-top">
                      <span className={`staff-avatar ${s.mode}`}>
                        {s.name
                          .split(" ")
                          .map((p) => p[0])
                          .slice(0, 2)
                          .join("")}
                      </span>
                      <span className={s.active ? "live-badge" : "status-void"}>
                        {s.active ? "Active" : "Disabled"}
                      </span>
                    </div>
                    <h2>{s.name}</h2>
                    <p>Volunteer · Day {s.day}</p>
                    <Badge mode={s.mode} />
                    <div className="staff-card-bottom">
                      <span>
                        <LockKeyhole size={14} />
                        Checkpoint locked
                      </span>
                      <button
                        className="text-button"
                        onClick={() => setDialog({ type: "staff", staff: s })}
                      >
                        Manage <ArrowRight size={14} />
                      </button>
                    </div>
                  </section>
                ))}
            </div>
            <p className="panel-note">
              Provision staff accounts through your Supabase administrator. This
              screen manages existing event assignments.
            </p>
          </>
        )}
        {page === "operations" && (
          <>
            <div className="operations-grid">
              <section className="panel">
                <div className="panel-heading">
                  <h2>
                    <Clock3 />
                    Checkpoint Schedule
                  </h2>
                  <span className="count-chip">Day {day}</span>
                </div>
                <p className="muted">
                  Server time controls each service window.
                </p>
                {snapshot.schedules
                  .filter((s) => s.day === day)
                  .map((s) => (
                    <div className="schedule-row" key={s.id}>
                      <span className={`stat-icon ${s.mode}`}>
                        <ModeIcon mode={s.mode} />
                      </span>
                      <div>
                        <strong>{labels[s.mode]} Check-in</strong>
                        <small>
                          {formatTime(s.opens)} – {formatTime(s.closes)} IST
                        </small>
                        <small>All team categories</small>
                      </div>
                      <span
                        className={s.enabled ? "status-enabled" : "status-void"}
                      >
                        {s.enabled ? "Enabled" : "Closed"}
                      </span>
                      <button
                        className="text-button"
                        onClick={() =>
                          setDialog({ type: "schedule", schedule: s })
                        }
                      >
                        Edit
                      </button>
                    </div>
                  ))}
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <h2>
                    <ShieldCheck />
                    Operations & Safeguards
                  </h2>
                </div>
                {[
                  {
                    icon: LockKeyhole,
                    name: "Locked scanner assignments",
                    text: "Station permissions are checked on confirmation.",
                  },
                  {
                    icon: ShieldCheck,
                    name: "Duplicate protection",
                    text: "One active claim per team, day and service.",
                  },
                  {
                    icon: History,
                    name: "Correction & audit history",
                    text: "Reasons and original records stay traceable.",
                  },
                  {
                    icon: Wifi,
                    name: "Connection & failure protection",
                    text: "Uncertain submissions require verification.",
                  },
                  {
                    icon: QrCode,
                    name: "Lost / damaged QR recovery",
                    text: "Replace a pass without resetting meal history.",
                  },
                  {
                    icon: CalendarDays,
                    name: "Checkpoint scheduling",
                    text: "Checkpoint windows control when teams can check in.",
                  },
                  {
                    icon: Download,
                    name: "Reports & backup",
                    text: "Export records and follow the recovery runbook.",
                  },
                ].map((s) => (
                  <div className="safeguard" key={s.name}>
                    <s.icon />
                    <div>
                      <strong>{s.name}</strong>
                      <small>{s.text}</small>
                    </div>
                    <Check size={15} />
                  </div>
                ))}
              </section>
            </div>
            <section className="panel audit-panel">
              <div className="panel-heading">
                <h2>
                  <ClipboardList />
                  Recent Audit History
                </h2>
                <button
                  className="text-button"
                  onClick={() => void exportRecords("audit")}
                >
                  Export audit <Download size={15} />
                </button>
              </div>
              {snapshot.audit.slice(0, 12).map((a) => (
                <div className="audit-row" key={a.id}>
                  <ShieldCheck size={17} />
                  <div>
                    <strong>{a.action.replaceAll("_", " ")}</strong>
                    <span>{a.detail}</span>
                  </div>
                  <small>
                    {a.actor} · {formatTime(a.at)}
                  </small>
                </div>
              ))}
            </section>
          </>
        )}
        {page === "reports" && (
          <>
            <div className="report-grid">
              {[
                {
                  kind: "claims" as const,
                  title: "Check-in report",
                  text: "Entry and meal confirmations, reversals and operator records for your selected filters.",
                  icon: FileCheck2,
                },
                {
                  kind: "teams" as const,
                  title: "Team roster",
                  text: "Team codes, college, category and registered member count.",
                  icon: Users,
                },
                {
                  kind: "audit" as const,
                  title: "Audit trail",
                  text: "Corrections, pass replacements, schedule changes and export activity.",
                  icon: ShieldCheck,
                },
              ].map((r) => (
                <section className="panel report-card" key={r.kind}>
                  <span className="report-icon">
                    <r.icon size={30} />
                  </span>
                  <h2>{r.title}</h2>
                  <p>{r.text}</p>
                  <span className="file-label">
                    CSV · Spreadsheet compatible
                  </span>
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => void exportRecords(r.kind)}
                  >
                    <Download size={17} />
                    Download report
                  </button>
                </section>
              ))}
            </div>
            <section className="panel backup-panel">
              <div>
                <h2>
                  <ShieldCheck />
                  Event recovery
                </h2>
                <p>
                  Operational CSVs support reconciliation. A database backup and
                  tested restore procedure are required for production recovery.
                </p>
              </div>
              <div className="recovery-steps">
                <span>1. Baseline before opening</span>
                <span>2. Save at service boundaries</span>
                <span>3. Verify the final archive</span>
              </div>
            </section>
          </>
        )}
        {page === "settings" && (
          <div className="settings-grid">
            <section className="panel">
              <h2>Event workspace</h2>
              <dl className="settings-list">
                <div>
                  <dt>Event</dt>
                  <dd>Rising India Hackathon 2.0</dd>
                </div>
                <div>
                  <dt>Venue</dt>
                  <dd>Nagpur Institute of Technology</dd>
                </div>
                <div>
                  <dt>Timezone</dt>
                  <dd>Asia/Kolkata · IST</dd>
                </div>
                <div>
                  <dt>Data connection</dt>
                  <dd>
                    {gateway.kind === "demo"
                      ? "Local rehearsal database"
                      : "Supabase"}
                  </dd>
                </div>
                <div>
                  <dt>Operating days</dt>
                  <dd>
                    {snapshot.schedules.length
                      ? `${new Set(snapshot.schedules.map((s) => s.day)).size} configured event days`
                      : "Awaiting the event schedule"}
                  </dd>
                </div>
              </dl>
            </section>
            <section className="panel">
              <h2>Before event day</h2>
              <p>
                Confirm the actual dates, checkpoint windows and A/B/C
                eligibility with the event lead, then configure them in Event
                Operations.
              </p>
              <p>
                Import the approved registration roster before distributing real
                passes.
              </p>
              <button className="button" onClick={() => navigate("operations")}>
                Configure checkpoints <ArrowRight size={17} />
              </button>
            </section>
            {gateway.kind === "demo" && (
              <section className="panel">
                <h2>Reset rehearsal</h2>
                <p>
                  Restore the 350 sample teams and clear your rehearsal changes.
                </p>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Reset the local rehearsal data? This clears sample check-ins and changes.",
                      )
                    )
                      void run(async () => {
                        await gateway.resetDemo();
                      }, "Rehearsal data restored");
                  }}
                >
                  <RotateCcw size={16} />
                  Reset sample data
                </button>
              </section>
            )}
          </div>
        )}
        <footer className="page-footer">
          Rising India Hackathon 2.0
          <span>Built with care · Powered by Team Nexus</span>
        </footer>
      </main>
      {dialog && (
        <Modal
          title={
            dialog.type === "team"
              ? dialog.team
                ? "Edit team"
                : "Add a team"
              : dialog.type === "pass"
                ? "Team QR pass"
                : dialog.type === "void"
                  ? "Correct a check-in"
                  : dialog.type === "schedule"
                    ? "Edit checkpoint window"
                    : dialog.type === "staff"
                      ? "Manage assignment"
                      : dialog.type === "import"
                        ? "Review roster import"
                        : "Your event workspace"
          }
          onClose={() => {
            if (!busy) setDialog(null);
          }}
        >
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          {dialog.type === "team" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(async () => {
                  await gateway.saveTeam({
                    id: dialog.team?.id,
                    code: String(f.get("code")).trim().toUpperCase(),
                    name: String(f.get("name")).trim(),
                    college: String(f.get("college")).trim(),
                    category: f.get("category") as Category,
                    members: String(f.get("members"))
                      .split("\n")
                      .map((x) => x.trim())
                      .filter(Boolean),
                    active: true,
                  });
                  setDialog(null);
                }, "Team saved");
              }}
            >
              <div className="form-grid">
                <label>
                  Team ID
                  <input
                    name="code"
                    defaultValue={dialog.team?.code}
                    placeholder="A-351"
                    required
                    maxLength={30}
                  />
                </label>
                <label>
                  Category
                  <select
                    name="category"
                    defaultValue={dialog.team?.category || "A"}
                  >
                    {Object.entries(categories).map(([c, name]) => (
                      <option value={c} key={c}>
                        {c} · {name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Team name
                <input
                  name="name"
                  defaultValue={dialog.team?.name}
                  required
                  maxLength={120}
                />
              </label>
              <label>
                College
                <input
                  name="college"
                  defaultValue={dialog.team?.college}
                  required
                  maxLength={180}
                />
              </label>
              <label>
                Members <small>One name per line</small>
                <textarea
                  name="members"
                  defaultValue={dialog.team?.members.join("\n")}
                  required
                  rows={4}
                />
              </label>
              <p className="form-note">
                A meal confirmation applies to the entire registered team.
              </p>
              <button disabled={busy} className="button primary">
                {busy ? "Saving…" : "Save team"}
              </button>
            </form>
          )}
          {dialog.type === "pass" && (
            <div className="pass-content">
              <div className="print-pass">
                <img
                  className="pass-logo"
                  src="/brand/rising-india.png"
                  alt="Rising India Hackathon 2.0"
                />
                <span className="eyebrow">OFFICIAL TEAM PASS</span>
                <img
                  className="qr-image"
                  src={qrImage}
                  alt={`QR pass for ${dialog.team.code}`}
                />
                <h2>
                  {dialog.team.code} · {dialog.team.name}
                </h2>
                <p>{dialog.team.college}</p>
                <span className="mode-tag">
                  Category {dialog.team.category} · {dialog.team.members.length}{" "}
                  members
                </span>
                <p>Present this pass at each open checkpoint.</p>
              </div>
              <div className="button-row">
                <a
                  className="button primary"
                  href={qrImage}
                  download={`${dialog.team.code}-QR.png`}
                >
                  <Download size={16} />
                  Download QR
                </a>
                <button className="button" onClick={() => window.print()}>
                  Print pass / PDF
                </button>
              </div>
              <details>
                <summary>Replace a lost or exposed pass</summary>
                <p>
                  Verify the team’s identity before replacing its pass. Existing
                  check-ins remain recorded.
                </p>
                <label>
                  Reason
                  <input
                    value={rotateReason}
                    onChange={(e) => setRotateReason(e.target.value)}
                    placeholder="Identity verified by…"
                    minLength={5}
                  />
                </label>
                <button
                  className="button danger"
                  disabled={busy || rotateReason.trim().length < 5}
                  onClick={() =>
                    void run(async () => {
                      const token = await gateway.rotatePass(
                        dialog.team.id,
                        rotateReason,
                      );
                      const QR = await import("qrcode");
                      setQrImage(
                        await QR.toDataURL(token, { width: 480, margin: 4 }),
                      );
                      setDialog({ ...dialog, token });
                      setRotateReason("");
                    }, "Replacement issued. The previous QR is revoked.")
                  }
                >
                  Reissue pass
                </button>
              </details>
              {gateway.kind === "demo" && (
                <details>
                  <summary>Rehearsal token</summary>
                  <code className="token-display">{dialog.token}</code>
                </details>
              )}
            </div>
          )}
          {dialog.type === "void" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const reason = String(
                  new FormData(e.currentTarget).get("reason"),
                );
                void run(async () => {
                  await gateway.voidClaim(dialog.claim.id, reason);
                  setDialog(null);
                }, "Check-in reversed with audit history");
              }}
            >
              <p>
                Reverse{" "}
                <strong>
                  {dialog.claim.teamCode} · {dialog.claim.teamName}
                </strong>{" "}
                for {labels[dialog.claim.mode]} on Day {dialog.claim.day}.
              </p>
              <div className="warning-box">
                Confirm whether a meal or admission was already provided before
                reversing this record.
              </div>
              <label>
                Correction reason
                <textarea name="reason" required minLength={5} rows={3} />
              </label>
              <button className="button danger" disabled={busy}>
                Confirm reversal
              </button>
            </form>
          )}
          {dialog.type === "schedule" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(async () => {
                  await gateway.saveSchedule(
                    {
                      ...dialog.schedule,
                      opens: new Date(
                        String(f.get("opens")) + "+05:30",
                      ).toISOString(),
                      closes: new Date(
                        String(f.get("closes")) + "+05:30",
                      ).toISOString(),
                      enabled: f.get("enabled") === "on",
                    },
                    String(f.get("reason")),
                  );
                  setDialog(null);
                }, "Checkpoint schedule updated");
              }}
            >
              <p>
                {labels[dialog.schedule.mode]} · Day {dialog.schedule.day} · All
                times in IST
              </p>
              <label>
                Opens
                <input
                  name="opens"
                  type="datetime-local"
                  defaultValue={new Date(
                    new Date(dialog.schedule.opens).getTime() + 19800000,
                  )
                    .toISOString()
                    .slice(0, 16)}
                  required
                />
              </label>
              <label>
                Closes
                <input
                  name="closes"
                  type="datetime-local"
                  defaultValue={new Date(
                    new Date(dialog.schedule.closes).getTime() + 19800000,
                  )
                    .toISOString()
                    .slice(0, 16)}
                  required
                />
              </label>
              <label className="checkbox-label">
                <input
                  name="enabled"
                  type="checkbox"
                  defaultChecked={dialog.schedule.enabled}
                />
                Enable checkpoint
              </label>
              <p>All team categories can check in during this window.</p>
              <label>
                Reason
                <input name="reason" required minLength={5} />
              </label>
              <button className="button primary" disabled={busy}>
                Save schedule
              </button>
            </form>
          )}
          {dialog.type === "staff" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(async () => {
                  await gateway.assignStaff({
                    ...dialog.staff,
                    day: Number(f.get("day")),
                    mode: f.get("mode") as Mode,
                    active: f.get("active") === "on",
                  });
                  setDialog(null);
                }, "Volunteer assignment updated");
              }}
            >
              <p>{dialog.staff.name}</p>
              <label>
                Event day
                <select name="day" defaultValue={dialog.staff.day}>
                  <option value={1}>Day 1</option>
                  <option value={2}>Day 2</option>
                </select>
              </label>
              <label>
                Checkpoint
                <select name="mode" defaultValue={dialog.staff.mode}>
                  {modes.map((m) => (
                    <option key={m} value={m}>
                      {labels[m]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="active"
                  defaultChecked={dialog.staff.active}
                />
                Allow access
              </label>
              <p className="form-note">
                Existing previews become invalid when an assignment changes.
              </p>
              <button className="button primary" disabled={busy}>
                Save assignment
              </button>
            </form>
          )}
          {dialog.type === "import" && (
            <div>
              <p>
                <strong>{dialog.teams.length} teams</strong> passed file
                validation. Matching team codes update the existing roster and
                keep check-in history.
              </p>
              <div className="import-preview">
                {dialog.teams.slice(0, 8).map((t) => (
                  <div key={t.code}>
                    <b>{t.code}</b>
                    <span>{t.name}</span>
                    <small>{t.members.length} members</small>
                  </div>
                ))}
              </div>
              <button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await gateway.importTeams(dialog.teams);
                    setDialog(null);
                  }, "Roster imported")
                }
              >
                Confirm import
              </button>
            </div>
          )}
          {dialog.type === "help" && (
            <div>
              <p>
                Signed in as <strong>{user.name}</strong>.
              </p>
              <p>
                {gateway.kind === "demo"
                  ? "This rehearsal uses sample data stored locally in your browser. Return to the welcome screen to explore the assigned volunteer checkpoints."
                  : "Your administrator account can manage the event roster, schedules, staff and audit history."}
              </p>
              <div className="security-pill">
                <CircleHelp size={18} />
                Meals require the whole team to be present.
              </div>
              <button className="button" onClick={onLogout}>
                <LogOut size={16} />
                Sign out
              </button>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
