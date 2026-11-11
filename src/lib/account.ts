import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, type AccountAccess } from "./types";

export function createAccountAccess(client: SupabaseClient): AccountAccess {
  const recoveryKey = "rih-password-recovery";
  let recovering = sessionStorage.getItem(recoveryKey) === "yes";
  const listeners = new Set<(event: string) => void>();
  // Keep callbacks synchronous: another Auth call here could deadlock the SDK.
  client.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") {
      recovering = true;
      sessionStorage.setItem(recoveryKey, "yes");
    }
    if (event === "SIGNED_OUT") {
      recovering = false;
      sessionStorage.removeItem(recoveryKey);
    }
    listeners.forEach((listener) => listener(event));
  });
  function check(error: { message: string } | null) {
    if (error) throw new AppError("ACCOUNT_ERROR", error.message);
  }
  return {
    recoveryPending: () => recovering,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async requestReset(email) {
      const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/`,
      });
      check(error);
    },
    async updatePassword(password) {
      if (password.length < 12)
        throw new AppError("WEAK_PASSWORD", "Use at least 12 characters.");
      const { error } = await client.auth.updateUser({ password });
      check(error);
      // Password recovery ends all sessions; the next visit requires a fresh login.
      const result = await client.auth.signOut({ scope: "global" });
      check(result.error);
    },
    async mfaStatus() {
      const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
      check(assurance.error);
      const factors = await client.auth.mfa.listFactors();
      check(factors.error);
      return {
        verified: assurance.data?.currentLevel === "aal2",
        factorId: factors.data?.totp[0]?.id,
      };
    },
    async enrollMfa() {
      const factors = await client.auth.mfa.listFactors();
      check(factors.error);
      // Clean up only abandoned, unverified enrollments from this account.
      for (const factor of factors.data?.all ?? []) {
        if (factor.factor_type === "totp" && factor.status === "unverified") {
          const result = await client.auth.mfa.unenroll({
            factorId: factor.id,
          });
          check(result.error);
        }
      }
      const { data, error } = await client.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "RIH event administrator",
        issuer: "Rising India Hackathon",
      });
      check(error);
      if (!data)
        throw new AppError(
          "MFA_FAILED",
          "Could not prepare your authenticator. Try again.",
        );
      return { id: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
    },
    async verifyMfa(factorId, code) {
      const { error } = await client.auth.mfa.challengeAndVerify({
        factorId,
        code,
      });
      check(error);
    },
  };
}
