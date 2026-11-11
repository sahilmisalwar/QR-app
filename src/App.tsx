import { useCallback, useEffect, useState } from "react";
import { ArrowRight, ShieldCheck, WifiOff, LoaderCircle } from "lucide-react";
import type { Gateway, Staff, Snapshot, Mode, Role } from "./lib/types";
import { AppError, labels, modes } from "./lib/types";
import { createDemoGateway } from "./lib/demo";
import { createSupabaseGateway } from "./lib/supabase";
import { Brand, ModeIcon } from "./components/shared";
import { Admin } from "./components/Admin";
import { Volunteer } from "./components/Volunteer";
import { AdminVerification, PasswordSetup } from "./components/Account";

const live =
  import.meta.env.MODE === "supabase" ||
  (import.meta.env.MODE !== "demo" &&
    import.meta.env.VITE_DATA_MODE === "supabase");
const emailRecoveryEnabled =
  import.meta.env.VITE_EMAIL_RECOVERY_ENABLED === "true";
let configuredGateway: Gateway | undefined;
let configurationError = "";
try {
  configuredGateway = live
    ? createSupabaseGateway(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        import.meta.env.VITE_EVENT_ID,
      )
    : createDemoGateway();
} catch (error) {
  configurationError = (error as Error).message;
}

export function App() {
  if (!configuredGateway)
    return (
      <div className="loading">
        <ShieldCheck size={36} />
        <h1>Complete the event connection</h1>
        <p>{configurationError}</p>
        <p>Configuration instructions are in the project README.</p>
      </div>
    );
  return <Workspace gateway={configuredGateway} />;
}

function Workspace({ gateway }: { gateway: Gateway }) {
  const [user, setUser] = useState<Staff | null>(null);
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recovering, setRecovering] = useState(
    gateway.account?.recoveryPending() ?? false,
  );
  const [verified, setVerified] = useState(false);
  const [resetForm, setResetForm] = useState(false);
  const [notice, setNotice] = useState("");
  const onVerified = useCallback(() => setVerified(true), []);
  const userId = user?.id;
  const needsVerification =
    !!gateway.account && user?.role === "admin" && !verified;
  const refresh = useCallback(async () => {
    try {
      const next = await gateway.snapshot();
      setData(next);
      setUser(
        (current) =>
          next.staff.find((person) => person.id === current?.id) ?? current,
      );
      setError("");
    } catch (e) {
      if (e instanceof AppError && e.code === "MFA_REQUIRED") {
        setData(null);
        setVerified(false);
      }
      if (
        e instanceof AppError &&
        ["SESSION_EXPIRED", "FORBIDDEN", "EVENT_CLOSED"].includes(e.code)
      ) {
        setUser(null);
        setData(null);
        setVerified(false);
      }
      setError((e as Error).message);
      throw e;
    }
  }, [gateway]);
  useEffect(() => {
    return gateway.account?.subscribe((event) => {
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      if (event === "SIGNED_OUT") {
        setUser(null);
        setData(null);
        setVerified(false);
        setRecovering(false);
      }
    });
  }, [gateway]);
  useEffect(() => {
    void gateway
      .session()
      .then(setUser)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [gateway]);
  useEffect(() => {
    if (!userId || needsVerification || recovering) return;
    const update = () => {
      if (document.visibilityState === "visible")
        void refresh().catch(() => {});
    };
    update();
    const timer = setInterval(update, 5000);
    window.addEventListener("online", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [userId, refresh, needsVerification, recovering]);
  async function login(
    email: string,
    password: string,
    role?: Role,
    mode?: Mode,
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    setVerified(false);
    try {
      setUser(
        role
          ? await gateway.demoLogin(role, mode)
          : await gateway.login(email, password),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      await gateway.logout();
      setUser(null);
      setData(null);
      setError("");
      setRecovering(false);
      setVerified(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function requestReset(email: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await gateway.account!.requestReset(email);
      setNotice(
        "If this address has an account, a password reset link will arrive shortly. Contact the organizer if it does not arrive.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <div className="loading">
        <LoaderCircle className="spin" />
        Opening event operations…
      </div>
    );
  if (needsVerification && gateway.account)
    return (
      <AdminVerification
        account={gateway.account}
        sessionError={error}
        onVerified={onVerified}
        onLogout={() => void logout()}
      />
    );
  if (recovering && gateway.account)
    return (
      <PasswordSetup
        account={gateway.account}
        sessionError={error}
        onLogout={() => void logout()}
        onDone={() => {
          setUser(null);
          setData(null);
          setRecovering(false);
          setVerified(false);
          setNotice("Password saved. Sign in with your new password.");
        }}
      />
    );
  if (!user)
    return (
      <div className="login-page">
        <div className="login-top">
          <Brand />
        </div>
        <div className="login-layout">
          <section className="login-intro">
            <span className="eyebrow">RISING INDIA HACKATHON 2.0</span>
            <h1>
              Every team.
              <br />
              Every checkpoint.
              <br />
              <em>One seamless day.</em>
            </h1>
            <p>
              The event operations workspace for team entry, meal verification
              and the people who make it all happen.
            </p>
            <div className="login-checkpoints">
              {modes.map((m) => (
                <span className={`mode-tag ${m}`} key={m}>
                  <ModeIcon mode={m} />
                  {labels[m]}
                </span>
              ))}
            </div>
            <div className="login-note">
              <ShieldCheck />
              Scan. Verify the team. Confirm together.
            </div>
          </section>
          <section className="login-card">
            <span className="eyebrow">EVENT OPERATIONS</span>
            <h2>
              {live
                ? resetForm
                  ? "Account recovery"
                  : "Welcome back"
                : "Explore your event workspace"}
            </h2>
            <p>
              {resetForm && !emailRecoveryEnabled
                ? "Contact the event organizer to restore access to your staff account."
                : live
                  ? "Sign in with your organizer-provided account."
                  : "Local rehearsal · 350 sample teams · Changes stay on this computer"}
            </p>
            {error && (
              <div className="error-banner" role="alert">
                {error}
              </div>
            )}
            {notice && (
              <div className="account-notice" role="status">
                {notice}
              </div>
            )}
            {live ? (
              <>
                {(!resetForm || emailRecoveryEnabled) && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      if (resetForm) void requestReset(String(f.get("email")));
                      else
                        void login(
                          String(f.get("email")),
                          String(f.get("password")),
                        );
                    }}
                  >
                    <label>
                      Email
                      <input
                        type="email"
                        name="email"
                        autoComplete="username"
                        required
                      />
                    </label>
                    {!resetForm && (
                      <label>
                        Password
                        <input
                          type="password"
                          name="password"
                          autoComplete="current-password"
                          required
                        />
                      </label>
                    )}
                    <button className="button primary" disabled={busy}>
                      {busy
                        ? "Please wait…"
                        : resetForm
                          ? "Send reset link"
                          : "Sign in"}{" "}
                      <ArrowRight size={18} />
                    </button>
                  </form>
                )}
                <button
                  className="button account-back"
                  disabled={busy}
                  onClick={() => {
                    setResetForm(!resetForm);
                    setError("");
                    setNotice("");
                  }}
                >
                  {resetForm ? "Back to sign in" : "Forgot password?"}
                </button>
                <p className="login-footnote">
                  Private staff workspace · Access is assigned by the event
                  organizer.
                </p>
              </>
            ) : (
              <>
                <button
                  className="demo-admin"
                  onClick={() => void login("", "", "admin")}
                  disabled={busy}
                >
                  <div className="admin-avatar">
                    <ShieldCheck />
                  </div>
                  <span>
                    <strong>Open admin workspace</strong>
                    <small>Teams, live progress and event controls</small>
                  </span>
                  <ArrowRight />
                </button>
                <div className="divider-label">VOLUNTEER CHECKPOINTS</div>
                <div className="demo-stations">
                  {modes.map((mode) => (
                    <button
                      key={mode}
                      className={`station-choice ${mode}`}
                      onClick={() => void login("", "", "volunteer", mode)}
                      disabled={busy}
                    >
                      <ModeIcon mode={mode} />
                      <span>{labels[mode]}</span>
                      <ArrowRight size={16} />
                    </button>
                  ))}
                </div>
                <p className="login-footnote">
                  Use a sample pass to try scanning and confirmation. Production
                  access uses assigned staff accounts.
                </p>
              </>
            )}
          </section>
        </div>
        <footer className="login-footer">
          Built for the teams building tomorrow.
          <span>NIT Nagpur · Team Nexus</span>
        </footer>
      </div>
    );
  if (!data)
    return (
      <div className="loading">
        <LoaderCircle className="spin" />
        <p>{error || "Loading your workspace…"}</p>
        <button className="button" onClick={() => void logout()}>
          Back to sign in
        </button>
      </div>
    );
  return (
    <div className={user.role === "admin" ? "admin-workspace" : undefined}>
      {error && (
        <div className="connection-banner" role="status">
          <WifiOff size={16} />
          Updates paused · {error}
        </div>
      )}
      {user.role === "admin" ? (
        <Admin
          gateway={gateway}
          user={user}
          snapshot={data}
          refresh={refresh}
          onLogout={() => void logout()}
        />
      ) : (
        <Volunteer
          gateway={gateway}
          user={user}
          snapshot={data}
          refresh={refresh}
          onLogout={() => void logout()}
        />
      )}
    </div>
  );
}
