// User-fetched Kingdom Archives media (player cards) — see scripts/fetch-playercards.mjs.
// Absent files are normal: every consumer falls back to the plain look.
import { bridge } from '../platform.ts';

type Kind = 'playercards';
const manifests = new Map<Kind, Promise<unknown | null>>();
const urls = new Map<string, Promise<string | null>>();

export function mediaManifest<T>(kind: Kind): Promise<T | null> {
  let p = manifests.get(kind);
  if (!p) { p = bridge.mediaManifest(kind).catch(() => null); manifests.set(kind, p); }
  return p as Promise<T | null>;
}

/** Object URL of one fetched file (cached), or null when it is not on disk. */
export function mediaUrl(kind: Kind, file: string): Promise<string | null> {
  const key = `${kind}/${file}`;
  let p = urls.get(key);
  if (!p) {
    const type = 'image/png';
    p = bridge.mediaFile(kind, file).then((b) => (b ? URL.createObjectURL(new Blob([b as BlobPart], { type })) : null)).catch(() => null);
    urls.set(key, p);
  }
  return p;
}

/** Stable small hash of a string (cards / levels are per player, not random per load). */
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
