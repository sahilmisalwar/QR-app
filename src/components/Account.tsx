import { useEffect, useState, type ReactNode } from "react";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import type { AccountAccess } from "../lib/types";
import { Brand } from "./shared";

export function AccountFrame({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="login-page account-page">
      <div className="login-top">
        <Brand />
      </div>
      <main className="login-card account-card">
        <span className="eyebrow">RISING INDIA · STAFF ACCESS</span>
        <h1>{title}</h1>
        {children}
      </main>
    </div>
  );
}

export function AdminVerification({
  account,
  sessionError,
  onVerified,
  onLogout,
}: {
  account: AccountAccess;
  sessionError?: string;
  onVerified: () => void;
  onLogout: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [factorId, setFactorId] = useState("");
  const [enrollment, setEnrollment] = useState<{
    qr: string;
    secret: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    void account
      .mfaStatus()
      .then((status) => {
        if (!current) return;
        if (status.verified) onVerified();
        else setFactorId(status.factorId ?? "");
      })
      .catch((e: Error) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [account, onVerified, retry]);
  async function enroll() {
    setBusy(true);
    setError("");
    try {
      const next = await account.enrollMfa();
      setFactorId(next.id);
      setEnrollment(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    setBusy(true);
    setError("");
    try {
      await account.verifyMfa(factorId, code);
      onVerified();
    } catch (e) {
      setError((e as Error).message);
      setCode("");
    } finally {
      setBusy(false);
    }
  }
  return (
    <AccountFrame title="Protect your event workspace">
      <div className="account-icon">
        <ShieldCheck size={28} />
      </div>
      <p>Administrator access requires a code from your authenticator app.</p>
      {(error || sessionError) && (
        <div className="error-banner" role="alert">
          {error || sessionError}
        </div>
      )}
      {loading ? (
        <p role="status">
          <LoaderCircle className="spin" size={20} /> Checking verification…
        </p>
      ) : factorId ? (
        <>
          {enrollment && (
            <div className="auth-enrollment">
              <p>
                Scan this QR in your authenticator app, then enter its six-digit
                code.
              </p>
              <img
                src={enrollment.qr}
                alt="Authenticator setup QR code"
                width="220"
                height="220"
              />
              <details>
                <summary>Enter a setup key instead</summary>
                <code>{enrollment.secret}</code>
              </details>
              <p className="muted">
                Keep this setup key private. Save it securely for account
                recovery.
              </p>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void verify();
            }}
          >
            <label>
              Authenticator code
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                required
              />
            </label>
            <button className="button primary" disabled={busy}>
              {busy ? "Verifying…" : "Verify and continue"}
            </button>
          </form>
        </>
      ) : error ? (
        <button
          className="button"
          onClick={() => {
            setError("");
            setRetry((x) => x + 1);
          }}
        >
          Retry verification
        </button>
      ) : (
        <button
          className="button primary"
          disabled={busy}
          onClick={() => void enroll()}
        >
          {busy ? "Preparing…" : "Set up authenticator"}
        </button>
      )}
      <button
        className="button account-back"
        disabled={busy}
        onClick={onLogout}
      >
        Back to sign in
      </button>
    </AccountFrame>
  );
}

export function PasswordSetup({
  account,
  sessionError,
  onDone,
  onLogout,
}: {
  account: AccountAccess;
  sessionError?: string;
  onDone: () => void;
  onLogout: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  return (
    <AccountFrame title="Choose a new password">
      <p>
        Use a unique password with at least 12 characters. You’ll sign in again
        after saving it.
      </p>
      {(error || sessionError) && (
        <div className="error-banner" role="alert">
          {error || sessionError}
        </div>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          if (password !== confirmation) {
            setError("The passwords do not match.");
            return;
          }
          setBusy(true);
          try {
            await account.updatePassword(password);
            onDone();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          New password
          <input
            type="password"
            autoComplete="new-password"
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <label>
          Confirm password
          <input
            type="password"
            autoComplete="new-password"
            minLength={12}
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            required
          />
        </label>
        <button className="button primary" disabled={busy}>
          {busy ? "Saving…" : "Save password"}
        </button>
      </form>
      <button
        className="button account-back"
        disabled={busy}
        onClick={onLogout}
      >
        Cancel and sign out
      </button>
    </AccountFrame>
  );
}
