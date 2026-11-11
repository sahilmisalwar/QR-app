import { confirmedMembers, memberCount } from "../lib/attendance";
import { randomId } from "../lib/id";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  DoorOpen,
  History,
  Home,
  ImagePlus,
  Info,
  Landmark,
  LockKeyhole,
  LogOut,
  Moon,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Tag,
  UserRound,
  UsersRound,
  Utensils,
  Wifi,
  WifiOff,
  X,
  XCircle,
} from "lucide-react";
import type { Gateway, Preview, Receipt, Snapshot, Staff } from "../lib/types";
import { AppError, categories, formatTime, labels } from "../lib/types";
import "./volunteer.css";

interface Props {
  gateway: Gateway;
  user: Staff;
  snapshot: Snapshot;
  refresh: () => Promise<void>;
  onLogout: () => void;
}
interface PendingCommand {
  previewId: string;
  requestId: string;
  memberIndices: number[];
}
type Screen = "home" | "scan" | "verify" | "result" | "pending";
type Tab = "home" | "history" | "profile";

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "We could not verify this action. Please try again.";
}

export function Volunteer({
  gateway,
  user,
  snapshot,
  refresh,
  onLogout,
}: Props) {
  const [tab, setTab] = useState<Tab>("home");
  const [screen, setScreen] = useState<Screen>("home");
  const [online, setOnline] = useState(navigator.onLine);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [token, setToken] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [selectedMembers, setSelectedMembers] = useState<number[]>([]);
  const [seconds, setSeconds] = useState(0);
  const pendingKey = `rih:pending:${user.id}`;
  const [pending, setPending] = useState<PendingCommand | null>(() => {
    try {
      return JSON.parse(
        sessionStorage.getItem(pendingKey) || "null",
      ) as PendingCommand | null;
    } catch {
      return null;
    }
  });
  const video = useRef<HTMLVideoElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const focusArea = useRef<HTMLDivElement>(null);
  const cameraControls = useRef<{ stop: () => void } | null>(null);
  const cameraGeneration = useRef(0);
  const decodeBusy = useRef(false);
  const mode = user.mode;
  const label = labels[mode];
  const CheckpointIcon =
    mode === "entry" ? DoorOpen : mode === "lunch" ? Utensils : Moon;
  const schedule = snapshot.schedules.find(
    (item) => item.day === user.day && item.mode === mode,
  );
  const eligible = schedule?.enabled
    ? snapshot.teams.filter((team) => team.active)
    : [];
  const history = snapshot.claims
    .filter((claim) => claim.day === user.day && claim.mode === mode)
    .sort((a, b) => b.at.localeCompare(a.at));
  const claims = history.filter((claim) => claim.status === "confirmed");
  const completed = eligible.filter(
    (team) =>
      confirmedMembers(claims, team, user.day, mode).size === memberCount(team),
  ).length;
  const percent = eligible.length
    ? Math.round((completed / eligible.length) * 100)
    : 0;
  const last = claims[0];
  const meal = mode !== "entry";
  const fresh = Date.now() - new Date(snapshot.serverTime).getTime() < 20000;
  const healthy = online && fresh;

  const stopCamera = useCallback(() => {
    cameraGeneration.current += 1;
    cameraControls.current?.stop();
    cameraControls.current = null;
    const stream = video.current?.srcObject;
    if (stream instanceof MediaStream)
      stream.getTracks().forEach((track) => track.stop());
    setCameraActive(false);
  }, []);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      stopCamera();
    };
  }, [stopCamera]);

  useEffect(() => {
    if (pending) setScreen("pending");
  }, [pending]);

  useEffect(() => {
    if (!preview || screen !== "verify") return;
    const update = () =>
      setSeconds(
        Math.max(
          0,
          Math.ceil((new Date(preview.expires).getTime() - Date.now()) / 1000),
        ),
      );
    update();
    const interval = window.setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [preview, screen]);

  useEffect(() => {
    if (screen === "home") return;
    const area = focusArea.current;
    area?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !area) return;
      const controls = Array.from(
        area.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), [href]",
        ),
      );
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) return;
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === area)
      ) {
        event.preventDefault();
        last.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [screen]);

  const clearPending = () => {
    sessionStorage.removeItem(pendingKey);
    setPending(null);
  };

  const reset = () => {
    stopCamera();
    setError("");
    setCameraError("");
    setPreview(null);
    setReceipt(null);
    setToken("");
    setSelectedMembers([]);
    setScreen("home");
  };

  const resolveToken = useCallback(
    async (value: string) => {
      if (decodeBusy.current) return;
      decodeBusy.current = true;
      stopCamera();
      setBusy(true);
      setError("");
      try {
        if (!navigator.onLine)
          throw new Error(
            "You are offline. Restore your connection before verifying a team.",
          );
        const next = await gateway.preview(value.trim(), user.day, user.mode);
        setPreview(next);
        setSelectedMembers([]);
        if (next.decision === "ALREADY_CONFIRMED" && next.previous) {
          setReceipt({ code: "ALREADY_CONFIRMED", claim: next.previous });
          setScreen("result");
        } else {
          setScreen("verify");
        }
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setBusy(false);
        decodeBusy.current = false;
      }
    },
    [gateway, stopCamera, user.day, user.mode],
  );

  const startCamera = useCallback(async () => {
    stopCamera();
    setCameraError("");
    const generation = cameraGeneration.current;
    if (!video.current) return;
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      if (generation !== cameraGeneration.current || !video.current) return;
      const reader = new BrowserQRCodeReader();
      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } }, audio: false },
        video.current,
        (result) => {
          if (result && generation === cameraGeneration.current)
            void resolveToken(result.getText());
        },
      );
      if (generation !== cameraGeneration.current) {
        controls.stop();
        return;
      }
      cameraControls.current = controls;
      setCameraActive(true);
    } catch (cause) {
      setCameraActive(false);
      const name = cause instanceof Error ? cause.name : "";
      setCameraError(
        name === "NotAllowedError"
          ? "Allow camera access in your browser, then try again. You can also scan a QR image."
          : "Camera unavailable. Connect a camera or choose a QR image below.",
      );
    }
  }, [resolveToken, stopCamera]);

  useEffect(() => {
    if (screen === "scan" && online) void startCamera();
    return () => {
      if (screen === "scan") stopCamera();
    };
  }, [screen, online, startCamera, stopCamera]);

  const readImage = async (selected?: File) => {
    if (!selected) return;
    stopCamera();
    setError("");
    const url = URL.createObjectURL(selected);
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const reader = new BrowserQRCodeReader();
      const result = await reader.decodeFromImageUrl(url);
      await resolveToken(result.getText());
    } catch {
      setError(
        "No readable QR code found. Choose a clear image of the team pass.",
      );
    } finally {
      URL.revokeObjectURL(url);
      if (file.current) file.current.value = "";
    }
  };

  const confirm = async (command: PendingCommand) => {
    if (!navigator.onLine) {
      setError("Restore your connection before confirming.");
      return;
    }
    setBusy(true);
    setError("");
    sessionStorage.setItem(pendingKey, JSON.stringify(command));
    setPending(command);
    try {
      const result = await gateway.confirm(
        command.previewId,
        command.requestId,
        command.memberIndices,
      );
      setReceipt(result);
      clearPending();
      setScreen("result");
      void refresh().catch(() => undefined);
    } catch (cause) {
      const definitive = new Set([
        "PREVIEW_EXPIRED",
        "PREVIEW_CONSUMED",
        "PREVIEW_INVALID",
        "CONTEXT_CHANGED",
        "WINDOW_CLOSED",
        "MEMBERS_REQUIRED",
        "INVALID_MEMBERS",
        "MEMBERS_ALREADY_CHECKED_IN",
        "REQUEST_CONFLICT",
        "FORBIDDEN",
      ]);
      if (cause instanceof AppError && definitive.has(cause.code)) {
        clearPending();
        setScreen(preview ? "verify" : "home");
      } else {
        setScreen("pending");
      }
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const retryPending = async () => {
    if (!pending || !online) return;
    setBusy(true);
    setError("");
    try {
      const result = await gateway.commandStatus(pending.requestId);
      if (result) {
        setReceipt(result);
        clearPending();
        setScreen("result");
        void refresh().catch(() => undefined);
      } else {
        await confirm(pending);
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const openScanner = () => {
    setError("");
    setCameraError("");
    setToken("");
    setScreen("scan");
  };

  const brand = (
    <div
      className="v-brand"
      aria-label="Rising India Hackathon, Nagpur Institute of Technology and Team Nexus"
    >
      <img src="/brand/rising-india.png" alt="Rising India Hackathon 2.0" />
      <span />
      <img src="/brand/nit.png" alt="Nagpur Institute of Technology" />
      <span />
      <img src="/brand/nexus.png" alt="Team Nexus" />
    </div>
  );
  const status = (
    <span className={`v-connection ${healthy ? "" : "v-connection-off"}`}>
      <span />
      {!online
        ? "Offline"
        : fresh
          ? gateway.kind === "demo"
            ? "Demo online"
            : "Online"
          : "Refreshing"}
    </span>
  );
  const title =
    screen === "scan"
      ? `Scan ${label} QR`
      : screen === "verify"
        ? "Verify team details"
        : screen === "pending"
          ? "Verify your last action"
          : "Check-in result";

  return (
    <div className={`v-stage v-mode-${mode}`}>
      <div className="v-app">
        {gateway.kind === "demo" && (
          <div className="v-demo">
            LOCAL DEMO <span>Sample teams · day {user.day}</span>
          </div>
        )}
        {brand}
        {screen === "home" ? (
          <>
            <main className="v-main">
              <header className="v-heading">
                <div className="v-heading-icon">
                  <CheckpointIcon size={29} />
                </div>
                <div>
                  <p>RIH 2.0 · Volunteer</p>
                  <h1>
                    {tab === "history"
                      ? "Scan history"
                      : tab === "profile"
                        ? "My station"
                        : `${label} Check-in`}
                  </h1>
                  <span>
                    {tab === "home"
                      ? meal
                        ? "Meal verification & access"
                        : "Verify team passes and manage entry"
                      : `Day ${user.day} · ${label} checkpoint`}
                  </span>
                </div>
              </header>
              <div className="v-assigned-strip">
                <LockKeyhole size={16} />
                <span>
                  Assigned scanner <strong>{label}</strong>
                </span>
                {status}
              </div>
              {tab === "home" && (
                <>
                  <section
                    className="v-progress-card"
                    aria-label={`${completed} of ${eligible.length} eligible teams checked in`}
                  >
                    <div className="v-progress-caption">
                      {label} progress <CheckpointIcon size={24} />
                    </div>
                    <div className="v-progress-numbers">
                      <div>
                        <strong>{completed}</strong>
                        <span> / {eligible.length}</span>
                        <small>Teams checked in</small>
                      </div>
                      <div className="v-percent">
                        <strong>
                          {percent}
                          <span>%</span>
                        </strong>
                        <small>Completed</small>
                      </div>
                    </div>
                    <div className="v-progress-track">
                      <span style={{ width: `${percent}%` }} />
                    </div>
                    <div className="v-progress-foot">
                      <span>
                        <CheckCircle2 size={17} />
                        {completed} completed
                      </span>
                      <span>
                        <Clock3 size={17} />
                        {Math.max(0, eligible.length - completed)} remaining
                      </span>
                    </div>
                  </section>
                  <section className="v-scanner-card">
                    <div className="v-scanner-corners" />
                    <div className="v-qr-symbol">
                      <QrCode size={40} />
                    </div>
                    <h2>Ready to Scan</h2>
                    <p>
                      Scan a team’s QR pass to confirm {label.toLowerCase()}
                    </p>
                    <button
                      className="v-primary"
                      onClick={openScanner}
                      disabled={!online}
                    >
                      <Camera size={24} />
                      Open Scanner
                      <ArrowRight size={23} />
                    </button>
                  </section>
                  <section className="v-last-card">
                    <span className="v-last-icon">
                      <Check size={26} />
                    </span>
                    <div>
                      <span>Last successful check-in</span>
                      <strong>
                        {last
                          ? `${last.teamCode} · ${last.teamName}`
                          : "Your next team is ready"}
                      </strong>
                    </div>
                    {last && <time>{formatTime(last.at)}</time>}
                  </section>
                  <section className="v-lock-card">
                    <LockKeyhole size={24} />
                    <div>
                      <span>Scanner assignment</span>
                      <strong>{label} Check-in</strong>
                    </div>
                    <span className="v-locked">LOCKED</span>
                  </section>
                  {!healthy && (
                    <div className="v-notice">
                      <WifiOff size={18} />
                      <p>
                        {!online
                          ? "Scanning is paused until your connection returns."
                          : "Progress is awaiting a fresh server update."}
                      </p>
                    </div>
                  )}
                  <p className="v-refreshed">
                    Last refreshed {formatTime(snapshot.serverTime)} IST{" "}
                    <button
                      aria-label="Refresh station"
                      onClick={() => {
                        void refresh().catch((cause) =>
                          setError(errorMessage(cause)),
                        );
                      }}
                    >
                      <RefreshCw size={13} />
                    </button>
                  </p>
                </>
              )}
              {tab === "history" && (
                <section className="v-section">
                  <div className="v-section-title">
                    <h2>Recent {label.toLowerCase()} activity</h2>
                    <span>{history.length} records</span>
                  </div>
                  {history.length === 0 ? (
                    <div className="v-empty">
                      <History size={38} />
                      <h3>No check-ins yet</h3>
                      <p>Confirmed teams will appear here.</p>
                    </div>
                  ) : (
                    <div className="v-history-list">
                      {history.slice(0, 75).map((claim) => (
                        <article key={claim.id}>
                          <span
                            className={`v-record-status ${claim.status === "voided" ? "is-voided" : ""}`}
                          >
                            {claim.status === "confirmed" ? (
                              <Check size={18} />
                            ) : (
                              <X size={18} />
                            )}
                          </span>
                          <div>
                            <strong>
                              {claim.teamCode} · {claim.teamName}
                            </strong>
                            <small>
                              {claim.status === "confirmed"
                                ? "Confirmed"
                                : "Corrected by admin"}{" "}
                              · Category {claim.category}
                            </small>
                          </div>
                          <time>{formatTime(claim.at)}</time>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              )}
              {tab === "profile" && (
                <section className="v-section">
                  <div className="v-profile-avatar">
                    <UserRound size={35} />
                  </div>
                  <h2>{user.name}</h2>
                  <p className="v-muted">
                    Volunteer · Rising India Hackathon 2.0
                  </p>
                  <dl className="v-profile-details">
                    <div>
                      <dt>Assigned checkpoint</dt>
                      <dd>
                        <CheckpointIcon size={18} />
                        {label}
                      </dd>
                    </div>
                    <div>
                      <dt>Event day</dt>
                      <dd>Day {user.day}</dd>
                    </div>
                    <div>
                      <dt>Access</dt>
                      <dd>
                        <LockKeyhole size={16} />
                        Locked to your station
                      </dd>
                    </div>
                    <div>
                      <dt>Schedule</dt>
                      <dd>
                        {schedule?.enabled
                          ? `${formatTime(schedule.opens)} – ${formatTime(schedule.closes)} IST`
                          : "Checkpoint closed"}
                      </dd>
                    </div>
                  </dl>
                  <div className="v-help">
                    <ShieldCheck size={22} />
                    <div>
                      <strong>Every team needs your confirmation</strong>
                      <p>
                        {meal
                          ? "Select the members receiving their meal now."
                          : "Select the members entering now."}{" "}
                        Contact the event administrator for corrections or lost
                        passes.
                      </p>
                    </div>
                  </div>
                  <button className="v-secondary v-signout" onClick={onLogout}>
                    <LogOut size={18} />
                    Sign out of station
                  </button>
                </section>
              )}
              {error && (
                <div className="v-error" role="alert">
                  <Info size={18} />
                  {error}
                </div>
              )}
            </main>
            <nav className="v-bottom-nav" aria-label="Volunteer navigation">
              {(
                [
                  { id: "home", label: "Home", icon: Home },
                  { id: "history", label: "Scan History", icon: History },
                  { id: "profile", label: "Profile", icon: UserRound },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  className={tab === item.id ? "is-active" : ""}
                  aria-current={tab === item.id ? "page" : undefined}
                  onClick={() => {
                    setError("");
                    setTab(item.id);
                  }}
                >
                  <item.icon size={24} />
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>
          </>
        ) : (
          <div
            className="v-flow"
            role="dialog"
            aria-modal="true"
            aria-labelledby="v-flow-title"
            ref={focusArea}
            tabIndex={-1}
          >
            <div className="v-flow-heading">
              <button
                aria-label="Back to station"
                disabled={busy || screen === "pending"}
                onClick={reset}
              >
                <ArrowLeft size={21} />
              </button>
              <div>
                <span>
                  DAY {user.day} · {label.toUpperCase()}
                </span>
                <h1 id="v-flow-title">{title}</h1>
              </div>
              <CheckpointIcon size={22} />
            </div>
            {screen === "scan" && (
              <>
                <div className="v-camera">
                  <video
                    ref={video}
                    muted
                    playsInline
                    aria-label="Live QR scanner camera"
                  />
                  <div className="v-camera-overlay">
                    <div className="v-camera-frame">
                      <span />
                    </div>
                    <p>
                      {busy
                        ? "Verifying team…"
                        : cameraActive
                          ? "Align the team QR within the frame"
                          : "Preparing your camera"}
                    </p>
                  </div>
                </div>
                {cameraError && (
                  <div className="v-notice">
                    <Camera size={20} />
                    <p>{cameraError}</p>
                  </div>
                )}
                <div className="v-camera-actions">
                  <button
                    className="v-secondary"
                    onClick={() => void startCamera()}
                    disabled={busy || !online}
                  >
                    <RefreshCw size={18} />
                    Retry camera
                  </button>
                  <button
                    className="v-secondary"
                    onClick={() => file.current?.click()}
                    disabled={busy || !online}
                  >
                    <ImagePlus size={18} />
                    QR image
                  </button>
                  <input
                    type="file"
                    accept="image/*"
                    ref={file}
                    hidden
                    onChange={(event) =>
                      void readImage(event.target.files?.[0])
                    }
                  />
                </div>
                <p className="v-scan-explainer">
                  <ShieldCheck size={16} />
                  Scanning only opens the team details. You confirm the
                  check-in.
                </p>
                {gateway.kind === "demo" && (
                  <div className="v-demo-tools">
                    <strong>Try the check-in flow</strong>
                    <p>Sample passes work without a camera.</p>
                    <div>
                      <button
                        onClick={() => void resolveToken("RIH-DEMO-A-034")}
                        disabled={busy || !online}
                      >
                        CodeCrafters <ChevronRight size={15} />
                      </button>
                      <button
                        onClick={() => void resolveToken("RIH-DEMO-C-080")}
                        disabled={busy || !online}
                      >
                        Unclaimed team <ChevronRight size={15} />
                      </button>
                    </div>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (token.trim()) void resolveToken(token);
                      }}
                    >
                      <input
                        value={token}
                        onChange={(event) => setToken(event.target.value)}
                        placeholder="Paste a demo pass token"
                        aria-label="Demo pass token"
                      />
                      <button
                        aria-label="Verify demo pass token"
                        disabled={busy || !online || !token.trim()}
                      >
                        <ArrowRight size={19} />
                      </button>
                    </form>
                  </div>
                )}
              </>
            )}
            {screen === "verify" && preview && (
              <section className="v-team-card">
                <span className="v-checkpoint-pill">
                  <CheckpointIcon size={16} />
                  {label} Check-in · Day {user.day}
                </span>
                <div className="v-team-avatar">
                  <UsersRound size={36} />
                </div>
                <span className="v-team-code">{preview.team.code}</span>
                <h2>{preview.team.name}</h2>
                <p className="v-college">
                  <Landmark size={19} />
                  {preview.team.college}
                </p>
                <div className="v-team-meta">
                  <span>
                    <Tag size={16} />
                    Category {preview.team.category}
                  </span>
                  <span>
                    <UsersRound size={16} />
                    {preview.team.members.length} members
                  </span>
                </div>
                <div className="v-members">
                  <h3>Verify team members</h3>
                  <p>Select the members present now.</p>
                  {preview.team.members.map((member, index) => {
                    const checkedIn =
                      preview.checkedMemberIndices?.includes(index) ?? false;
                    return (
                      <label className="v-attestation" key={index}>
                        <input
                          type="checkbox"
                          disabled={checkedIn || busy}
                          checked={checkedIn || selectedMembers.includes(index)}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setSelectedMembers((current) =>
                              checked
                                ? [...current, index].sort((a, b) => a - b)
                                : current.filter((item) => item !== index),
                            );
                          }}
                        />
                        <span>
                          {member}{" "}
                          {checkedIn && <small>Already checked in</small>}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <div className="v-eligibility">
                  <ShieldCheck size={21} />
                  <div>
                    <strong>{label} is available</strong>
                    <span>
                      {categories[preview.team.category]} ·{" "}
                      {seconds > 0
                        ? `Confirmation expires in ${seconds}s`
                        : "Preview expired. Scan the pass again."}
                    </span>
                  </div>
                </div>
                <button
                  className="v-primary"
                  onClick={() =>
                    void confirm({
                      previewId: preview.id,
                      requestId: randomId(),
                      memberIndices: selectedMembers,
                    })
                  }
                  disabled={
                    busy ||
                    !online ||
                    seconds <= 0 ||
                    selectedMembers.length === 0
                  }
                >
                  <CheckCircle2 size={21} />
                  {busy ? "Confirming…" : `Confirm ${label} Check-in`}
                </button>
                <button
                  className="v-text-button"
                  onClick={reset}
                  disabled={busy}
                >
                  Cancel and return to station
                </button>
                <p className="v-confirm-note">
                  <LockKeyhole size={14} />
                  Each member can check in once per checkpoint and event day
                </p>
              </section>
            )}
            {screen === "result" && receipt && (
              <section
                className={`v-result v-result-${receipt.code.toLowerCase()}`}
              >
                <div className="v-result-icon">
                  {receipt.code === "CONFIRMED" ? (
                    <Check size={44} />
                  ) : receipt.code === "VOIDED" ? (
                    <Info size={44} />
                  ) : (
                    <X size={44} />
                  )}
                </div>
                <h2>
                  {receipt.code === "CONFIRMED"
                    ? "Check-in Successful!"
                    : receipt.code === "VOIDED"
                      ? "Check-in Corrected"
                      : "Already Checked In"}
                </h2>
                <p>
                  {receipt.code === "CONFIRMED"
                    ? (receipt.claim.quantity ?? 0) +
                      (receipt.claim.quantity === 1
                        ? " member checked in. "
                        : " members checked in. ") +
                      (receipt.remainingCount === 0
                        ? "Everyone has checked in for this checkpoint."
                        : (receipt.remainingCount ?? 0) +
                          " remaining can use the same QR.")
                    : receipt.code === "VOIDED"
                      ? "An administrator reversed this action. Please contact the event desk before serving."
                      : `${label} was already recorded for this team on Day ${receipt.claim.day}.`}
                </p>
                <div className="v-result-team">
                  <UsersRound size={28} />
                  <div>
                    <strong>{receipt.claim.teamName}</strong>
                    <span>
                      {receipt.claim.teamCode} · Category{" "}
                      {receipt.claim.category}
                    </span>
                  </div>
                </div>
                <div className="v-receipt-time">
                  <Clock3 size={20} />
                  <div>
                    <span>
                      {receipt.code === "CONFIRMED"
                        ? "Confirmed at"
                        : "Original check-in"}
                    </span>
                    <strong>
                      {formatTime(receipt.claim.at)} IST · Day{" "}
                      {receipt.claim.day}
                    </strong>
                  </div>
                </div>
                <p className="v-receipt-id">
                  Receipt {receipt.claim.id.slice(0, 12)}
                </p>
                <button
                  className="v-primary"
                  onClick={() => {
                    reset();
                    setScreen("scan");
                  }}
                >
                  <QrCode size={22} />
                  Scan Next Team
                  <ArrowRight size={20} />
                </button>
                <button className="v-text-button" onClick={reset}>
                  Back to dashboard
                </button>
              </section>
            )}
            {screen === "pending" && (
              <section className="v-pending">
                <div className="v-pending-icon">
                  <WifiOff size={42} />
                </div>
                <h2>Verification pending</h2>
                <p>
                  The connection interrupted the response. Your check-in may
                  already be recorded.
                </p>
                <div className="v-help">
                  <ShieldCheck size={22} />
                  <p>
                    Wait for a verified result before admitting the team or
                    handing over a meal. Checking again uses the original
                    request.
                  </p>
                </div>
                <button
                  className="v-primary"
                  onClick={() => void retryPending()}
                  disabled={busy || !online}
                >
                  <RefreshCw size={21} />
                  {busy ? "Checking record…" : "Check original result"}
                </button>
                <p className="v-muted">
                  If the connection stays unavailable, contact the event
                  administrator with this reference.
                </p>
                <code>{pending?.requestId}</code>
              </section>
            )}
            {error && (
              <div className="v-error" role="alert">
                <XCircle size={19} />
                {error}
              </div>
            )}
            {!online && (
              <div className="v-notice" role="status">
                <WifiOff size={18} />
                <p>You are offline. Reconnect to continue safely.</p>
              </div>
            )}
            <div className="v-flow-footer">
              {online ? <Wifi size={15} /> : <WifiOff size={15} />}
              <span>
                {online ? "Connection available" : "Connection unavailable"}
              </span>
              <BadgeCheck size={16} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
