const NIGHT_PERMISSIONS = {
  detective: ["investigate"],
  doctor: ["protect"],
  guard: ["protect"],
  boss: ["attack"],
  killer: ["attack"],
  spy: ["sabotage"]
};

export function submitNightAction(game, actorId, action, targetId) {
  if (game.phase !== "night") throw new Error("Night actions are closed");
  const actor = game.players.find(p => p.id === String(actorId) && p.alive);
  const target = game.players.find(p => p.id === String(targetId) && p.alive);
  if (!actor || !target || actor.id === target.id) throw new Error("Invalid actor or target");
  if (!(NIGHT_PERMISSIONS[actor.role] ?? []).includes(action)) throw new Error("Role cannot perform this action");
  const key = actor.id + ":" + action;
  if (game.actions[key]) throw new Error("Action already submitted");
  game.actions[key] = { actorId: actor.id, action, targetId: target.id };
  game.stateVersion++;
  return game;
}

export function resolveNight(game) {
  if (game.phase !== "night") throw new Error("Night is not active");
  const actions = Object.values(game.actions);
  const protectedIds = new Set(actions.filter(a => a.action === "protect").map(a => a.targetId));
  const investigations = actions.filter(a => a.action === "investigate").map(a => {
    const target = game.players.find(p => p.id === a.targetId);
    return { actorId: a.actorId, targetId: a.targetId, result: target?.faction === "mafia" ? "suspicious" : "not_suspicious" };
  });
  const attacks = actions.filter(a => a.action === "attack");
  const attacked = [...new Set(attacks.map(a => a.targetId))];
  const deaths = [];
  for (const targetId of attacked) {
    if (protectedIds.has(targetId)) continue;
    const target = game.players.find(p => p.id === targetId && p.alive);
    if (!target) continue;
    if (target.armor > 0) { target.armor--; continue; }
    target.alive = false;
    target.health = 0;
    deaths.push(targetId);
  }
  game.actions = {};
  game.phase = "day";
  game.stateVersion++;
  return { game, deaths, investigations };
}
