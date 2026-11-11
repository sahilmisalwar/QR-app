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
