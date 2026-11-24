// Compact, JSON-safe projections of a RoundRecord for the desktop (shared by the match, session and
// series scripts). Everything here is optional on the engine side: absent fields stay absent.
type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function compactEconomy(e: Obj) {
  return {
    credits: e.credits, ultPoints: e.ultPoints,
    ...(Array.isArray(e.players) ? { players: e.players.map((p: Obj) => ({ credits: p.credits, weapon: p.weapon ?? null, armor: p.armor ?? 0, ultPoints: p.ultPoints ?? 0 })) } : {}),
  };
}

export function compactBuy(b: Obj) {
  return {
    tier: b.tier, weapon: b.weapon,
    ...(b.plan !== undefined ? { plan: b.plan, cost: b.cost, loadoutValue: b.loadoutValue, vctTier: b.vctTier, drops: b.drops } : {}),
    ...(b.call ? { call: b.call } : {}),
    ...(Array.isArray(b.evaluation) ? { evaluation: b.evaluation.map((x: Obj) => ({ plan: x.plan, ultHold: !!x.ultHold, value: x.value, winNow: x.winNow })) } : {}),
    ...(Array.isArray(b.players) ? { players: b.players } : {}),
  };
}

/** Per-tick sight/gaze the sim decided (engine-truth), when the engine exposes it on the record. */
export function sightOf(r: Obj) {
  return r.sight ?? r.replay?.meta?.sight ?? null;
}

/** The engine's duel records of the round, when it exposes them on the record. */
export function engagementOf(r: Obj) {
  const e = r.engagementTrace ?? r.replay?.meta?.engagementTrace ?? null;
  return Array.isArray(e) ? e : null;
}
