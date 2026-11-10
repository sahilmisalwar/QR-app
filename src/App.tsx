import { useCallback, useEffect, useState } from "react";
import { ArrowRight, ShieldCheck, WifiOff, LoaderCircle } from "lucide-react";
import type { Gateway, Staff, Snapshot, Mode, Role } from "./lib/types";
import { labels, modes } from "./lib/types";
import { createDemoGateway } from "./lib/demo";
import { createSupabaseGateway } from "./lib/supabase";
import { Brand, ModeIcon } from "./components/shared";
import { Admin } from "./components/Admin";
import { Volunteer } from "./components/Volunteer";

const live = import.meta.env.VITE_DATA_MODE === "supabase";
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
  const userId = user?.id;
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
      setError((e as Error).message);
      throw e;
    }
  }, [gateway]);
  useEffect(() => {
    void gateway
      .session()
      .then(setUser)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [gateway]);
  useEffect(() => {
    if (!userId) return;
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
  }, [userId, refresh]);
  async function login(
    email: string,
    password: string,
    role?: Role,
    mode?: Mode,
  ) {
    setBusy(true);
    setError("");
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
    await gateway.logout();
    setUser(null);
    setData(null);
    setError("");
  }
  if (loading)
    return (
      <div className="loading">
        <LoaderCircle className="spin" />
        Opening event operations…
      </div>
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
            <h2>{live ? "Welcome back" : "Explore your event workspace"}</h2>
            <p>
              {live
                ? "Sign in with your organizer-provided account."
                : "Local rehearsal · 350 sample teams · Changes stay on this computer"}
            </p>
            {error && (
              <div className="error-banner" role="alert">
                {error}
              </div>
            )}
            {live ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void login(String(f.get("email")), String(f.get("password")));
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
                <label>
                  Password
                  <input
                    type="password"
                    name="password"
                    autoComplete="current-password"
                    required
                  />
                </label>
                <button className="button primary" disabled={busy}>
                  Sign in <ArrowRight size={18} />
                </button>
              </form>
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
    <>
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
    </>
  );
}
