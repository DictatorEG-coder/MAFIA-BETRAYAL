export function nominate(game, actorId, targetId) {
  if (game.phase !== "day" && game.phase !== "nomination") throw new Error("Nomination is closed");
  const actor = game.players.find(p => p.id === String(actorId) && p.alive);
  const target = game.players.find(p => p.id === String(targetId) && p.alive);
  if (!actor || !target || actor.id === target.id) throw new Error("Invalid nomination");
  game.nominations ??= {};
  if (game.nominations[actor.id]) throw new Error("Already nominated");
  game.nominations[actor.id] = target.id;
  game.phase = "nomination";
  game.stateVersion++;
  return game;
}

export function selectDefendant(game, random = Math.random) {
  if (game.phase !== "nomination") throw new Error("Nomination phase is not active");
  const counts = new Map();
  for (const target of Object.values(game.nominations ?? {})) counts.set(target, (counts.get(target) ?? 0) + 1);
  if (!counts.size) { game.phase = "night"; game.round++; game.nominations = {}; return { defendant:null, game }; }
  const highest = Math.max(...counts.values());
  const leaders = [...counts].filter(([, count]) => count === highest).map(([id]) => id);
  const defendant = leaders[Math.floor(random() * leaders.length)];
  game.defendant = defendant;
  game.phase = "defense";
  game.stateVersion++;
  return { defendant, game };
}
