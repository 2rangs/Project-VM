/**
 * Route intent — how a move order should be routed, decided by its PURPOSE.
 *
 * The policy picks the goal (a zone). The navigation layer finds the path. This file is the link
 * between them: it reads what an order is for (its role, its source, its pace) and what the team
 * BELIEVES about the map, and attaches a `routePreference` and belief-based `zoneCosts` to the
 * order. It never chooses a destination and never reads true enemy positions — only the view's
 * belief (`threatZones`) and the teammates' own announced routes.
 *
 *   entry / execute / retake / defuser / spike recovery / rotation  → FASTEST   (be there first)
 *   saving with a weapon worth keeping                                → SAFEST    (away from where the enemy is believed to be)
 *   saving with a cheap weapon                                        → TACTICAL
 *   the lurker's own lurk order (while the team plays slow)           → SAFEST, and off the lanes the rest of the team is using
 *   walking (a quiet approach)                                        → STEALTH   (walks, and keeps clear of believed enemies)
 *   chase                                                             → FASTEST   (the policy sends the chaser to the ground the
 *                                                                                  attackers fall back to — the believed escape —
 *                                                                                  and it gets there first by the fastest route)
 *
 * Two things this deliberately does not do. Once the team commits to a site the lurker's orders
 * are the execute's, and it comes the fast way: the execute waits for it, so a detour there stalls
 * the whole round (measured: time-expired rounds 9 % → 28 % when every order of the lurker was
 * routed as a lurk). And the spike carrier is never routed as a lurker.
 *
 * Most plan orders name the NEXT zone of the policy's own route (planRoute), not the final goal,
 * so for those the preference decides how the floor between two neighbouring zones is crossed;
 * save, chase, retake and rotate orders name the goal itself, and there it decides the whole way.
 */
import type { ActionCommand, PolicyView } from "@pv/shared-types";

export type RouteIntent = "entry" | "execute" | "save" | "lurk" | "chase" | "retake" | "recover" | "stealth" | "default";
export type RoutePreference = NonNullable<ActionCommand["routePreference"]>;

/** Weapons a player saves a round to keep (manual-approx: the rifles, the sniper, the heavy guns). */
const WORTH_SAVING: ReadonlySet<string> = new Set(["Vandal", "Phantom", "Operator", "Odin", "Guardian", "Outlaw", "Bulldog", "Ares"]);
/** Zone cost per unit of believed threat (0..1). 4 = a zone held with certainty costs five times its time. */
const THREAT_COST = 4;
/** Extra cost of a zone a teammate is already routing through, for a lurker (take another lane). */
const TEAM_LANE_COST = 2;

/** What the team believes about each zone, as a route cost: the belief's threat level, scaled. */
export function beliefZoneCosts(view: PolicyView): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of view.belief.threatZones) {
    if (t.threatLevel > 0) out[t.zoneId] = Math.max(out[t.zoneId] ?? 0, t.threatLevel * THREAT_COST);
  }
  return out;
}

export function routeIntentOf(cmd: ActionCommand, role: string | undefined, strategy: string, carriesSpike = false): RouteIntent {
  const src = cmd.sourceActionId ?? "";
  if (strategy === "save" || src.includes("save")) return "save";
  if (src.includes("chase")) return "chase";
  if (src.includes("spike-re")) return "recover";
  if (src.includes("retake") || src.includes("defuser")) return "retake";
  // The lurk is the lurker's own order (plan:lurk-*), while the team plays slow. Once the team
  // commits, the lurker's orders are the execute's and it comes the fast way — the execute waits
  // for it. The spike never lurks.
  if (role === "lurker" && !carriesSpike && src.includes("lurk")) return "lurk";
  if (cmd.moveMode === "walk") return "stealth";
  if (role === "entry") return "entry";
  if (strategy === "aExecute" || strategy === "bExecute" || strategy === "cExecute") return "execute";
  return "default";
}

/** Attach the route preference (and, where the intent calls for it, belief-based zone costs) to every move order. */
export function annotateRoutes(
  view: PolicyView, strategy: string, roleOf: ReadonlyMap<string, string>, commands: readonly ActionCommand[],
): ActionCommand[] {
  let belief: Record<string, number> | null = null;
  const costs = (): Record<string, number> => (belief ??= beliefZoneCosts(view));
  return commands.map((c) => {
    if (c.kind !== "move" || !c.targetZone || c.routePreference) return c;
    const carriesSpike = view.spike?.holderId != null && String(view.spike.holderId) === String(c.playerId);
    const intent = routeIntentOf(c, roleOf.get(String(c.playerId)), strategy, carriesSpike);
    const me = view.teammates.find((p) => String(p.id) === String(c.playerId));
    switch (intent) {
      case "save": {
        const weapon = String(me?.weapon?.weaponId ?? "");
        return { ...c, routePreference: WORTH_SAVING.has(weapon) ? "SAFEST" : "TACTICAL", zoneCosts: costs() };
      }
      case "lurk": {
        // off the lanes the rest of the team has announced, and away from believed enemies; the
        // zone the lurker stands in and the one it is sent to are its own and are not priced
        const z = { ...costs() };
        const own = me ? String((me as { zoneId?: string }).zoneId ?? "") : "";
        for (const tm of view.teammates) {
          if (!tm.alive || String(tm.id) === String(c.playerId)) continue;
          const path = (tm as { transit?: { path?: readonly string[] } }).transit?.path ?? [];
          for (const zone of path) if (zone !== c.targetZone && zone !== own) z[zone] = (z[zone] ?? 0) + TEAM_LANE_COST;
        }
        return { ...c, routePreference: "SAFEST", zoneCosts: z };
      }
      case "stealth":
        return { ...c, routePreference: "STEALTH", zoneCosts: costs() };
      default:
        return { ...c, routePreference: "FASTEST" };
    }
  });
}
