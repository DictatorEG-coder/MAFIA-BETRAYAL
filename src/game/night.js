import { getWinner } from "./win-conditions.js";
const NIGHT_PERMISSIONS = { detective:["investigate"], doctor:["protect"], guard:["protect"], boss:["attack"], killer:["attack"], spy:["sabotage"] };
export function submitNightAction(game, actorId, action, targetId) {
 if(game.phase!=="night") throw new Error("Night actions are closed");
 const actor=game.players.find(p=>p.id===String(actorId)&&p.alive);
 const target=game.players.find(p=>p.id===String(targetId)&&p.alive);
 if(!actor||!target||actor.id===target.id) throw new Error("Invalid actor or target");
 if(!(NIGHT_PERMISSIONS[actor.role]??[]).includes(action)) throw new Error("Role cannot perform this action");
 const key=actor.id+":"+action;
 if(game.actions[key]) throw new Error("Action already submitted");
 game.actions[key]={actorId:actor.id,action,targetId:target.id}; game.stateVersion++; return game;
}
export function resolveNight(game) {
 if(game.phase!=="night") throw new Error("Night is not active");
 const actions=Object.values(game.actions);
 const protectedIds=new Set(actions.filter(a=>a.action==="protect").map(a=>a.targetId));
 const investigations=actions.filter(a=>a.action==="investigate").map(a=>{
  const target=game.players.find(p=>p.id===a.targetId);
  return {actorId:a.actorId,targetId:a.targetId,result:target?.faction==="mafia"?"suspicious":"not_suspicious"};
 });
 const counts=new Map();
 for(const a of actions.filter(a=>a.action==="attack")) counts.set(a.targetId,(counts.get(a.targetId)??0)+1);
 const max=counts.size?Math.max(...counts.values()):0;
 const leaders=[...counts].filter(([,n])=>n===max).map(([id])=>id);
 const attackTarget=leaders.length===1?leaders[0]:null;
 const deaths=[];
 if(attackTarget&&!protectedIds.has(attackTarget)){
  const target=game.players.find(p=>p.id===attackTarget&&p.alive);
  if(target){if(target.armor>0) target.armor--; else {target.alive=false;target.health=0;deaths.push(attackTarget);}}
 }
 game.actions={}; game.winner=getWinner(game.players,game.round);
 if(game.winner){game.phase="ended";game.endedAt=Date.now();} else game.phase="day";
 game.stateVersion++;
 return {game,deaths,investigations,attackTarget};
}
