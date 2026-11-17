const TRANSITIONS = Object.freeze({
  lobby: ["role_delivery", "cancelled"], role_delivery: ["night", "cancelled"],
  night: ["day", "ended"], day: ["nomination", "ended"],
  nomination: ["defense", "night", "ended"], defense: ["voting", "night", "ended"],
  voting: ["night", "ended"], ended: [], cancelled: []
});
export function transition(state, nextPhase, now = Date.now()) {
  const allowed = TRANSITIONS[state.phase] ?? [];
  if (!allowed.includes(nextPhase)) throw new Error("Invalid phase transition: " + state.phase + " -> " + nextPhase);
  return { ...state, phase: nextPhase, stateVersion: (state.stateVersion ?? 0) + 1, phaseStartedAt: now };
}
export function allowedTransitions(phase) { return [...(TRANSITIONS[phase] ?? [])]; }