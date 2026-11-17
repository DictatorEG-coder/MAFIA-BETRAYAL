export const GAMBLER_MISSION_TEXT = Object.freeze({
  survive: "ابقَ حيًا حتى نهاية الجولة الحالية.",
  nominate: "رشّح اللاعب الذي سيصبح المتهم.",
  vote: "صوّت للاعب الذي سيتم إقصاؤه."
});
export function assignGamblerMission(random=Math.random, previous=null) {
  const missions=Object.keys(GAMBLER_MISSION_TEXT).filter(m=>m!==previous);
  return missions[Math.floor(random()*missions.length)];
}
export function evaluateGamblerMission(mission, result) {
  if(mission==="survive") return Boolean(result.alive);
  if(mission==="nominate") return Boolean(result.nominated);
  if(mission==="vote") return Boolean(result.votedForEliminated);
  return false;
}
export function gamblerMissionText(mission) {
  return GAMBLER_MISSION_TEXT[mission]??"أكمل مهمتك السرية.";
}
