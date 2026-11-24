// Plan-change reasons, parsed for localisation. The engine (@pv/team-engine igl.ts / policy.ts)
// writes each revision's `reason` as an English sentence; the Review shows it in the UI language.
// This module recognises the sentences the engine produces today and returns their parts; anything
// it does not recognise comes back as `raw` and is shown verbatim (so a new engine reason is never
// lost, only untranslated). Pure data → data; the strings live in i18n (`rev.dec.reason.*`).
//
// If the engine later emits a reason key + params next to the sentence, this parser can go.

/** What the defence had on the other site(s) when it decided a rotation. */
export type Elsewhere =
  | { kind: 'contact'; site: string }
  | { kind: 'count'; site: string; n: number }
  | { kind: 'none'; site: string };

export type ReasonLabel =
  | { kind: 'spikePlanted' }
  | { kind: 'siteStacked'; from: string; to: string }
  | { kind: 'clockCommit' }
  | { kind: 'playerAdvantage'; us: number; them: number }
  | { kind: 'evenAgain'; us: number; them: number }
  /** chance / floor are win chances in percent (0–100). */
  | { kind: 'roundLost'; us: number; them: number; chance: number; floor: number }
  | { kind: 'exitChase'; atk: number; def: number; player: string }
  /**
   * A defensive rotation decided on evidence: `n` enemies seen / heard on `site` (in a fight or
   * not), what was known of the other sites, the belief it is the real hit / a fake (percent),
   * and how many players rotate (0 = stand the rotation down).
   */
  | { kind: 'rotation'; site: string; n: number; evidence: 'seen' | 'heard'; contact: boolean; elsewhere: Elsewhere[]; hit: number; fake: number; rotate: number }
  | { kind: 'raw'; text: string };

const pct = (p: string): number => Math.round(Number(p) * 100);

function parseElsewhere(text: string | undefined): Elsewhere[] | null {
  if (!text) return [];
  const out: Elsewhere[] = [];
  for (const part of text.split(', ')) {
    let m: RegExpExecArray | null;
    if ((m = /^contact on ([A-Z])$/.exec(part))) out.push({ kind: 'contact', site: m[1] });
    else if ((m = /^(\d+) on ([A-Z])$/.exec(part))) out.push({ kind: 'count', site: m[2], n: Number(m[1]) });
    else if ((m = /^no contact on ([A-Z])$/.exec(part))) out.push({ kind: 'none', site: m[1] });
    else return null;
  }
  return out;
}

export function parseReason(text: string): ReasonLabel {
  let m: RegExpExecArray | null;
  if (text === 'spike planted — retake call') return { kind: 'spikePlanted' };
  if (text === 'clock — commit with the information gathered') return { kind: 'clockCommit' };
  if ((m = /^([A-Z]) is stacked — swing to ([A-Z])$/.exec(text))) return { kind: 'siteStacked', from: m[1], to: m[2] };
  if ((m = /^player advantage (\d+)v(\d+) — hit while they are short$/.exec(text))) return { kind: 'playerAdvantage', us: Number(m[1]), them: Number(m[2]) };
  if ((m = /^man count even again \((\d+)v(\d+)\) — play it out$/.exec(text))) return { kind: 'evenAgain', us: Number(m[1]), them: Number(m[2]) };
  if ((m = /^round lost (\d+)v(\d+) before the plant \(Lanchester ([\d.]+) < ([\d.]+)\) — save$/.exec(text))) {
    return { kind: 'roundLost', us: Number(m[1]), them: Number(m[2]), chance: pct(m[3]), floor: pct(m[4]) };
  }
  if ((m = /^attack is (\d+)v(\d+) down with nothing to play for — (\S+) leaves the angle to chase the exit kill$/.exec(text))) {
    return { kind: 'exitChase', atk: Number(m[1]), def: Number(m[2]), player: m[3] };
  }
  if ((m = /^(\d+) (seen|runners? heard) on ([A-Z])( with contact)?(?:, (.+?))? — P\(hit \3\) ([\d.]+), fake ([\d.]+) — (?:(stand down, hold)|rotate (\d+))$/.exec(text))) {
    const elsewhere = parseElsewhere(m[5]);
    if (elsewhere) {
      return {
        kind: 'rotation', site: m[3], n: Number(m[1]), evidence: m[2] === 'seen' ? 'seen' : 'heard', contact: !!m[4],
        elsewhere, hit: pct(m[6]), fake: pct(m[7]), rotate: m[8] ? 0 : Number(m[9]),
      };
    }
  }
  return { kind: 'raw', text };
}

/** `def4` / `atk2` → side + number (the engine's per-round seat ids); null for anything else. */
export function seatOf(playerId: string): { side: 'attack' | 'defense'; n: number } | null {
  const m = /^(atk|def)(\d+)$/.exec(playerId);
  return m ? { side: m[1] === 'atk' ? 'attack' : 'defense', n: Number(m[2]) } : null;
}
