import { createClient } from "@supabase/supabase-js";
import { AppError } from "./types";
import type { Gateway, Staff, Snapshot, Preview, Receipt } from "./types";

export function createSupabaseGateway(
  url: string,
  publishableKey: string,
  eventId: string,
): Gateway {
  if (!url || !publishableKey || !eventId) {
    throw new AppError(
      "CONFIGURATION",
      "Set the Supabase URL, publishable key and event ID before connecting.",
    );
  }
  const client = createClient(url, publishableKey);

  async function call<T>(operation: string, payload: object = {}): Promise<T> {
    if (!navigator.onLine)
      throw new AppError("OFFLINE", "Reconnect before continuing.");
    const { data, error } = await client.schema("api").rpc("call", {
      p_event: eventId,
      p_operation: operation,
      p_payload: payload,
    });
    if (error) {
      const [code, ...message] = error.message.split("|");
      throw new AppError(
        message.length ? code : "REQUEST_FAILED",
        message.length
          ? message.join("|")
          : "The service could not verify this request. Check the connection and try again.",
      );
    }
    return data as T;
  }

  return {
    kind: "supabase",
    async session() {
      const { data, error } = await client.auth.getSession();
      if (error || !data.session) return null;
      return call<Staff>("context");
    },
    async login(email, password) {
      const { error } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw new AppError("SIGN_IN_FAILED", error.message);
      return call<Staff>("context");
    },
    async demoLogin() {
      throw new AppError("FORBIDDEN", "Use your assigned staff account.");
    },
    async logout() {
      await client.auth.signOut();
    },
    snapshot: () => call<Snapshot>("snapshot"),
    preview: (token, day, mode) =>
      call<Preview>("preview", { token, day, mode }),
    confirm: (previewId, requestId, fullTeam) =>
      call<Receipt>("confirm", { previewId, requestId, fullTeam }),
    commandStatus: (requestId) =>
      call<Receipt | null>("receipt", { requestId }),
    async saveTeam(team) {
      await call("save_team", { team });
    },
    async importTeams(teams) {
      await call("import_teams", { teams });
    },
    getPass: (teamId) => call<string>("pass", { teamId }),
    rotatePass: (teamId, reason) => call<string>("rotate", { teamId, reason }),
    async voidClaim(claimId, reason) {
      await call("void", { claimId, reason });
    },
    async saveSchedule(schedule, reason) {
      await call("schedule", { schedule, reason });
    },
    async assignStaff(staff) {
      await call("assign", { staff });
    },
    exportData: () => call<Snapshot>("export"),
    async resetDemo() {
      throw new AppError(
        "FORBIDDEN",
        "Production data cannot be reset from this app.",
      );
    },
  };
}
