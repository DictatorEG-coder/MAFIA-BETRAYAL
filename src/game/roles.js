export const ROLE_SETS = {
  5: ["detective", "doctor", "citizen", "boss", "survivor"],
  6: ["detective", "doctor", "citizen", "boss", "killer", "survivor"],
  7: ["detective", "doctor", "guard", "citizen", "boss", "spy", "survivor"],
  8: ["detective", "doctor", "guard", "citizen", "boss", "killer", "survivor", "gambler"],
  9: ["detective", "doctor", "guard", "avenger", "citizen", "boss", "killer", "survivor", "gambler"],
  10: ["detective", "doctor", "guard", "avenger", "citizen", "boss", "killer", "spy", "survivor", "gambler"]
};

export const ROLE_FACTIONS = {
  detective: "city", doctor: "city", guard: "city", avenger: "city", citizen: "city",
  boss: "mafia", killer: "mafia", spy: "mafia",
  survivor: "independent", lone_killer: "independent", gambler: "independent"
};

export function assignRoles(playerIds, random = Math.random) {
  const ids = [...playerIds];
  if (ids.length < 5 || ids.length > 10) throw new RangeError("Players must be between 5 and 10");
  const roles = [...ROLE_SETS[ids.length]];
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }
  return Object.fromEntries(ids.map((id, i) => [String(id), roles[i]]));
}
