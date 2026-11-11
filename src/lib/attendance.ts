import type { Claim, Mode, Team } from "./types";

export function memberCount(team: Team) {
  return team.memberCount ?? team.members.length;
}

export function confirmedMembers(
  claims: Claim[],
  team: Team,
  day: number,
  mode: Mode,
) {
  const checked = new Set<number>();
  for (const claim of claims) {
    if (
      claim.teamId !== team.id ||
      claim.day !== day ||
      claim.mode !== mode ||
      claim.status !== "confirmed"
    )
      continue;
    const indices =
      claim.memberIndices ??
      Array.from({ length: memberCount(team) }, (_, index) => index);
    for (const index of indices) checked.add(index);
  }
  return checked;
}

export function memberProgress(
  claims: Claim[],
  teams: Team[],
  day: number,
  mode: Mode,
) {
  let total = 0;
  let count = 0;
  let completeTeams = 0;
  for (const team of teams) {
    const size = memberCount(team);
    const checked = confirmedMembers(claims, team, day, mode).size;
    total += size;
    count += checked;
    if (size > 0 && checked === size) completeTeams++;
  }
  return { total, count, completeTeams, teamCount: teams.length };
}
