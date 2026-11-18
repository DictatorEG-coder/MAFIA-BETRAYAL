const NIGHT_EVENTS = [
  { title: "همسات في الظلام", text: "وصلت إلى الشرطة رسالة مجهولة: «أحدهم لم يكن نائمًا هذه الليلة»." },
  { title: "نافذة مفتوحة", text: "عُثر على نافذة مفتوحة وآثار أقدام قرب أحد المنازل، لكن المطر محا بقية الأثر." },
  { title: "اتصال مقطوع", text: "تلقى أحد سكان المدينة اتصالًا صامتًا قبل الفجر بثوانٍ." },
  { title: "ظلّ عابر", text: "أفاد شاهد بأنه لمح ظلًا يعبر الشارع الخلفي، لكنه لم يستطع تمييز صاحبه." },
  { title: "رسالة ممزقة", text: "عُثر على قصاصة ورق تحمل تحذيرًا: «لا تثقوا بأقرب الناس إليكم»." }
];

export function chooseNightEvent(random = Math.random) {
  return NIGHT_EVENTS[Math.floor(random() * NIGHT_EVENTS.length)];
}

export function getNightActionReports(game, result) {
  const actions = Object.values(game.actions ?? {});
  const protectedIds = new Set(actions.filter(action => action.action === "protect").map(action => action.targetId));
  const reports = [];
  for (const action of actions) {
    if (action.action === "protect") {
      const wasTargeted = result.attackTarget === action.targetId;
      const survived = game.players.find(player => player.id === action.targetId)?.alive;
      reports.push({
        actorId: action.actorId,
        text: wasTargeted && survived
          ? "🛡️ نجحت حمايتك هذه الليلة. الشخص الذي اخترته نجا من الخطر."
          : wasTargeted
            ? "⚠️ لم تتمكن حمايتك من منع الخطر هذه المرة."
            : "🌙 لم يتعرض الشخص الذي اخترته لهجوم هذه الليلة. بقيت حمايتك دون اختبار."
      });
    } else if (action.action === "attack") {
      const attackSucceeded = result.attackTarget === action.targetId &&
        !protectedIds.has(action.targetId) &&
        result.deaths.includes(action.targetId);
      reports.push({
        actorId: action.actorId,
        text: attackSucceeded
          ? "🔪 نُفّذ الهجوم الليلي بنجاح."
          : result.attackTarget === action.targetId
            ? "⚠️ لم ينجح الهجوم في إسقاط الهدف. يبدو أن شيئًا ما أفشل الخطة."
            : "🕯️ لم يُعتمد الهدف الذي اخترته ضمن قرار المافيا هذه الليلة."
      });
    }
  }
  return reports;
}

export function appendPublicEvent(game, event) {
  game.history ??= [];
  game.history.push({
    round: game.round,
    phase: event.phase ?? game.phase,
    text: String(event.text ?? ""),
    at: Date.now()
  });
  if (game.history.length > 100) game.history.splice(0, game.history.length - 100);
}

export function getPublicHistory(game) {
  return (game.history ?? []).map(({ round, phase, text }) => ({ round, phase, text }));
}

export function getGameStats(game) {
  const players = game.players ?? [];
  const votes = Object.keys(game.votes ?? {}).length;
  const abstentions = Object.keys(game.abstentions ?? {}).length;
  return {
    rounds: game.round ?? 1,
    players: players.length,
    survivors: players.filter(player => player.alive).length,
    eliminated: players.filter(player => !player.alive).length,
    votes,
    abstentions,
    events: game.history?.length ?? 0
  };
}
