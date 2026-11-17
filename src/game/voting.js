export function resolveVote(votes, eligibleIds) {
  const eligible = new Set(eligibleIds.map(String));
  const counts = new Map();
  for (const [voter, target] of Object.entries(votes)) {
    if (!eligible.has(String(voter)) || !eligible.has(String(target)) || voter === target) continue;
    counts.set(String(target), (counts.get(String(target)) ?? 0) + 1);
  }
  if (!counts.size) return { eliminated: null, reason: "no_valid_votes", counts: Object.fromEntries(counts) };
  const max = Math.max(...counts.values());
  const leaders = [...counts].filter(([, count]) => count === max).map(([id]) => id);
  if (leaders.length !== 1) return { eliminated: null, reason: "tie", counts: Object.fromEntries(counts) };
  const validVotes = [...counts.values()].reduce((a, b) => a + b, 0);
  if (max <= validVotes / 2) return { eliminated: null, reason: "no_majority", counts: Object.fromEntries(counts) };
  return { eliminated: leaders[0], reason: "majority", counts: Object.fromEntries(counts) };
}
