export function getWinner(players, round) {
  const alive = players.filter(p => p.alive);
  const mafia = alive.filter(p => p.faction === "mafia").length;
  const hostileIndependent = alive.filter(p => p.faction === "independent" && p.hostile).length;
  const city = alive.filter(p => p.faction === "city").length;
  if (mafia === 0 && hostileIndependent === 0) return { winner: "city", reason: "all_threats_removed" };
  if (mafia > 0 && mafia >= city + hostileIndependent && hostileIndependent === 0) {
    return { winner: "mafia", reason: "parity_or_majority" };
  }
  const survivors = alive.filter(p => p.role === "survivor");
  if (round >= 4 && survivors.length) return { winner: "survivor", reason: "survived_four_rounds" };
  return null;
}
