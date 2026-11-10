export type Mode = "entry" | "lunch" | "dinner";
export type Category = "A" | "B" | "C";
export type Role = "admin" | "volunteer";
export interface Staff {
  id: string;
  name: string;
  role: Role;
  mode: Mode;
  day: number;
  active: boolean;
}
export interface Team {
  id: string;
  code: string;
  name: string;
  college: string;
  category: Category;
  members: string[];
  active: boolean;
}
export interface Claim {
  id: string;
  teamId: string;
  teamCode: string;
  teamName: string;
  category: Category;
  mode: Mode;
  day: number;
  at: string;
  actor: string;
  status: "confirmed" | "voided";
  reason?: string;
}
export interface Schedule {
  id: string;
  day: number;
  mode: Mode;
  opens: string;
  closes: string;
  enabled: boolean;
  categories: Category[];
  revision: number;
}
export interface Audit {
  id: string;
  at: string;
  actor: string;
  action: string;
  detail: string;
}
export interface Snapshot {
  teams: Team[];
  claims: Claim[];
  staff: Staff[];
  schedules: Schedule[];
  audit: Audit[];
  serverTime: string;
}
export interface Preview {
  id: string;
  team: Team;
  mode: Mode;
  day: number;
  expires: string;
  decision: "ELIGIBLE" | "ALREADY_CONFIRMED";
  previous?: Claim;
}
export interface Receipt {
  code: "CONFIRMED" | "ALREADY_CONFIRMED" | "VOIDED";
  claim: Claim;
}
export interface Gateway {
  kind: "demo" | "supabase";
  session(): Promise<Staff | null>;
  login(email: string, password: string): Promise<Staff>;
  demoLogin(role: Role, mode?: Mode): Promise<Staff>;
  logout(): Promise<void>;
  snapshot(): Promise<Snapshot>;
  preview(token: string, day: number, mode: Mode): Promise<Preview>;
  confirm(
    previewId: string,
    requestId: string,
    fullTeam: boolean,
  ): Promise<Receipt>;
  commandStatus(requestId: string): Promise<Receipt | null>;
  saveTeam(team: Omit<Team, "id"> & { id?: string }): Promise<void>;
  importTeams(teams: Array<Omit<Team, "id">>): Promise<void>;
  getPass(teamId: string): Promise<string>;
  rotatePass(teamId: string, reason: string): Promise<string>;
  voidClaim(claimId: string, reason: string): Promise<void>;
  saveSchedule(schedule: Schedule, reason: string): Promise<void>;
  assignStaff(staff: Staff): Promise<void>;
  exportData(): Promise<Snapshot>;
  resetDemo(): Promise<void>;
}
export const modes: Mode[] = ["entry", "lunch", "dinner"];
export const labels: Record<Mode, string> = {
  entry: "Entry",
  lunch: "Lunch",
  dinner: "Dinner",
};
export const categories: Record<Category, string> = {
  A: "Outside Nagpur",
  B: "Nagpur (Non-NIT)",
  C: "NIT Students",
};
export function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
