// Streak banner — the loading emblem. It builds up in five steps (core → ring → cap and ticks →
// wings → outer ring → burst), the way a tactical shooter's kill banner escalates from the first
// kill to the fifth, and the loading screen drives the steps with real progress when it has any.
//
// These are ORIGINAL designs drawn for this project (geometric cores, no skulls, no game artwork,
// no audio); several variants exist so the player can pick one (BannerPicker, stored in
// localStorage). Game banners themselves are third-party artwork and are not shipped.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { bridge } from '../platform.ts';
import type { LocalBannerPack } from '../../shared/ipc.ts';

export const BANNERS = ['standard', 'prism', 'forge', 'signal'] as const;
export type BannerId = (typeof BANNERS)[number];
export type BannerStage = 1 | 2 | 3 | 4 | 5 | 'loop';

interface Look { base: string; accent: string; hot: string; sides: number; rays: number; core: string; wing: 'chevron' | 'shard' | 'bar' | 'arc' }
const LOOKS: Record<BannerId, Look> = {
  // off-white / teal / red — the app's own palette; four-diamond core (the app mark)
  standard: { base: '#ece8e1', accent: '#4be3c9', hot: '#ff4655', sides: 0, rays: 8, wing: 'chevron',
    core: 'M60 44l8 8-8 8-8-8z M70 54l8 8-8 8-8-8z M50 54l8 8-8 8-8-8z M60 64l8 8-8 8-8-8z' },
  // violet / cyan; hexagon frame, crystal core, shard wings
  prism: { base: '#e9e4ff', accent: '#7ad7ff', hot: '#b98cff', sides: 6, rays: 6, wing: 'shard',
    core: 'M60 42l12 14-12 22-12-22z M60 42v36 M48 56h24' },
  // gold / amber; octagon frame, keystone core, bar wings
  forge: { base: '#fff1cf', accent: '#f2b84b', hot: '#ff7a3d', sides: 8, rays: 12, wing: 'bar',
    core: 'M48 46h24l6 12-18 22-18-22z M54 58h12l-6 9z' },
  // mono green; radar rings, target core, arc wings
  signal: { base: '#d9ffe9', accent: '#5dffa0', hot: '#5dffa0', sides: 0, rays: 4, wing: 'arc',
    core: 'M60 48a12 12 0 1 0 .01 0z M60 55a5 5 0 1 0 .01 0z M58 40h4v10h-4z M58 70h4v10h-4z M40 58h10v4H40z M70 58h10v4H70z' },
};

const C = 60;
const pt = (r: number, deg: number) => { const a = (deg * Math.PI) / 180; return `${(C + Math.cos(a) * r).toFixed(1)} ${(C + Math.sin(a) * r).toFixed(1)}`; };
const ngon = (n: number, r: number, rot = -90) => `M${Array.from({ length: n }, (_, i) => pt(r, rot + (360 / n) * i)).join('L')}z`;
const arc = (r: number, a0: number, a1: number) => `M${pt(r, a0)}A${r} ${r} 0 0 1 ${pt(r, a1)}`;
const ticks = (n: number, r0: number, r1: number, rot = -90) => Array.from({ length: n }, (_, i) => `M${pt(r0, rot + (360 / n) * i)}L${pt(r1, rot + (360 / n) * i)}`).join('');
const rays = (n: number, r0: number, r1: number, half: number, rot = -90) => Array.from({ length: n }, (_, i) => { const a = rot + (360 / n) * i; return `M${pt(r0, a - half)}L${pt(r1, a)}L${pt(r0, a + half)}z`; }).join('');

function wings(kind: Look['wing']): string {
  switch (kind) {
    case 'shard': return 'M18 60l14-10 4 10-4 10z M102 60l-14-10-4 10 4 10z';
    case 'bar': return 'M12 54h20v4H12z M12 62h16v4H12z M88 54h20v4H88z M92 62h16v4H92z';
    case 'arc': return `${arc(40, 150, 210)}${arc(40, -30, 30)}`;
    default: return 'M30 46l-14 14 14 14v-8l-6-6 6-6z M90 46l14 14-14 14v-8l6-6-6-6z';
  }
}

export function StreakBanner({ variant, stage, size = 112, label }: { variant: BannerId; stage: BannerStage; size?: number; label?: string }) {
  const k = LOOKS[variant] ?? LOOKS.standard;
  const stroke = { fill: 'none', strokeLinecap: 'square' as const };
  const on = (n: number) => (stage === 'loop' ? `pvk-l pvk-l${n}` : `pvk-l ${stage >= n ? 'on' : ''}`);
  const strokeWing = k.wing === 'arc';
  return (
    <svg className={`pvk pvk-${variant} ${stage === 'loop' ? 'loop' : 'staged'}`} data-stage={stage} width={size} height={size} viewBox="0 0 120 120"
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {/* 5 — burst */}
      <g className={on(5)}><path d={rays(k.rays, 52, 60, 3.2)} fill={k.hot} /><circle cx={C} cy={C} r={56} {...stroke} stroke={k.hot} strokeWidth={1} opacity={0.5} /></g>
      {/* 4 — outer ring + diagonal ticks */}
      <g className={on(4)}>
        {k.sides > 0 ? <path d={ngon(k.sides, 48)} {...stroke} stroke={k.base} strokeWidth={1.5} strokeDasharray="10 5" /> : <circle cx={C} cy={C} r={48} {...stroke} stroke={k.base} strokeWidth={1.5} strokeDasharray="10 6" />}
        <path d={ticks(4, 40, 46, -45)} {...stroke} stroke={k.base} strokeWidth={2} />
      </g>
      {/* 3 — wings */}
      <g className={on(3)}>{strokeWing ? <path d={wings(k.wing)} {...stroke} stroke={k.accent} strokeWidth={3} /> : <path d={wings(k.wing)} fill={k.accent} />}</g>
      {/* 2 — cap + cardinal ticks */}
      <g className={on(2)}><path d={arc(33, -118, -62)} {...stroke} stroke={k.accent} strokeWidth={4} /><path d={ticks(4, 36, 42)} {...stroke} stroke={k.base} strokeWidth={2} /></g>
      {/* 1 — core + ring */}
      <g className={on(1)}>
        {k.sides > 0 ? <path d={ngon(k.sides, 27)} {...stroke} stroke={k.base} strokeWidth={2.5} /> : <circle cx={C} cy={C} r={27} {...stroke} stroke={k.base} strokeWidth={2.5} />}
        <path d={k.core} fill={k.base} fillRule="evenodd" stroke={variant === 'prism' ? '#0f1923' : 'none'} strokeWidth={variant === 'prism' ? 1.5 : 0} />
      </g>
    </svg>
  );
}

// ── the player's own banner media (optional, local only) ────────────────────────────────────
// Packs live in apps/desktop/assets/banners/<name>/1.webm … 5.webm (or png/webp/gif/mp4). The
// app plays whatever the user has put there; it never downloads or ships banner media.
export const LOCAL_PREFIX = 'local:';
let packs: LocalBannerPack[] | null = null;
let packsPromise: Promise<LocalBannerPack[]> | null = null;
const packSubs = new Set<() => void>();
const urlCache = new Map<string, Promise<string | null>>();
export function loadLocalBanners(): Promise<LocalBannerPack[]> {
  if (!packsPromise) packsPromise = bridge.listBanners().catch(() => []).then((p) => { packs = p; for (const s of packSubs) s(); return p; });
  return packsPromise;
}
export function useLocalBanners(): LocalBannerPack[] {
  useEffect(() => { void loadLocalBanners(); }, []);
  return useSyncExternalStore((l) => { packSubs.add(l); return () => { packSubs.delete(l); }; }, () => packs ?? EMPTY, () => packs ?? EMPTY);
}
const EMPTY: LocalBannerPack[] = [];
function mediaUrl(pack: string, file: string): Promise<string | null> {
  const key = `${pack}/${file}`;
  let p = urlCache.get(key);
  if (!p) {
    const type = /\.mp3$/i.test(file) ? 'audio/mpeg' : /\.ogg$/i.test(file) ? 'audio/ogg' : /\.wav$/i.test(file) ? 'audio/wav' : /\.(webm)$/i.test(file) ? 'video/webm' : /\.(mp4)$/i.test(file) ? 'video/mp4' : /\.gif$/i.test(file) ? 'image/gif' : /\.webp$/i.test(file) ? 'image/webp' : /\.png$/i.test(file) ? 'image/png' : 'image/jpeg';
    p = bridge.loadBannerFile(pack, file).then((bytes) => (bytes ? URL.createObjectURL(new Blob([bytes as BlobPart], { type })) : null)).catch(() => null);
    urlCache.set(key, p);
  }
  return p;
}

function useMedia(pack: string, file: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let alive = true; setUrl(null); if (file) void mediaUrl(pack, file).then((u) => { if (alive) setUrl(u); }); return () => { alive = false; }; }, [pack, file]);
  return url;
}

/**
 * A layered kill banner composited like the game does it: frame behind, spinning ring, emblem in
 * the middle, and one pip per kill on an arc above. `stage` 1..5 = number of pips lit; 'loop' plays
 * 1 → 5 and starts again.
 */
function LayeredBanner({ pack, stage, size }: { pack: LocalBannerPack; stage: BannerStage; size: number }) {
  const L = pack.layers!;
  const frame = useMedia(pack.id, L.frame), ring = useMedia(pack.id, L.ring), emblem = useMedia(pack.id, L.emblem), pip = useMedia(pack.id, L.pip);
  const [loopN, setLoopN] = useState(1);
  useEffect(() => {
    if (stage !== 'loop') return;
    const id = setInterval(() => setLoopN((n) => (n % 5) + 1), 650);
    return () => clearInterval(id);
  }, [stage]);
  const n = stage === 'loop' ? loopN : stage;
  // opt-in step sound (off by default; settings in the banner picker)
  const sound = useBannerSound();
  useEffect(() => {
    const file = pack.sounds?.[n];
    if (!sound.on || !file) return;
    let alive = true; let audio: HTMLAudioElement | null = null;
    void mediaUrl(pack.id, file).then((u) => {
      if (!alive || !u) return;
      audio = new Audio(u); audio.volume = sound.volume;
      void audio.play().catch(() => { /* autoplay refused: stay silent */ });
    });
    return () => { alive = false; audio?.pause(); };
  }, [n, sound.on, sound.volume, pack]);
  const pips = Array.from({ length: 5 }, (_, i) => { const a = (-90 + (i - 2) * 22) * Math.PI / 180; return { x: 50 + Math.cos(a) * 46, y: 52 + Math.sin(a) * 46, on: i < n }; });
  return (
    <span className="pvk-layered" style={{ width: size, height: size }} data-stage={n}>
      {frame && <img src={frame} className="pvk-frame" alt="" />}
      {ring && <img src={ring} className="pvk-ring" alt="" key={`r${n}`} />}
      {emblem && <img src={emblem} className="pvk-emblem" alt="" key={`e${n}`} />}
      {pip && pips.map((p, i) => <img key={i} src={pip} className={`pvk-pip ${p.on ? 'on' : ''}`} style={{ left: `${p.x}%`, top: `${p.y}%` }} alt="" />)}
    </span>
  );
}

/** Plays a local pack: the media of the current stage; in loop mode it steps 1 → 5 on its own. */
function LocalBanner({ pack, stage, size }: { pack: LocalBannerPack; stage: BannerStage; size: number }) {
  const stages = Object.keys(pack.files).map(Number).sort((a, b) => a - b);
  const [loopAt, setLoopAt] = useState(0);
  useEffect(() => {
    if (stage !== 'loop') return;
    const id = setInterval(() => setLoopAt((n) => (n + 1) % Math.max(1, stages.length)), 1400);
    return () => clearInterval(id);
  }, [stage, stages.length]);
  const want = stage === 'loop' ? stages[loopAt] ?? stages[0] : [...stages].reverse().find((n) => n <= stage) ?? stages[0];
  const file = pack.files[want];
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let alive = true; setUrl(null); if (file) void mediaUrl(pack.id, file).then((u) => { if (alive) setUrl(u); }); return () => { alive = false; }; }, [pack.id, file]);
  const style = { width: size, height: size, objectFit: 'contain' as const, display: 'block' };
  if (!url) return <span className="pvk-local" style={{ ...style, display: 'block' }} />;
  return /\.(webm|mp4)$/i.test(file)
    ? <video className="pvk-local" key={url} src={url} style={style} autoPlay muted playsInline data-stage={want} />
    : <img className="pvk-local" src={url} style={style} alt="" data-stage={want} />;
}

/** The banner for a loading screen: a built-in variant, or one of the user's local packs. */
export function LoadingBanner({ variant, stage, size = 112 }: { variant: string; stage: BannerStage; size?: number }) {
  const local = useLocalBanners();
  if (variant.startsWith(LOCAL_PREFIX)) {
    const pack = local.find((p) => p.id === variant.slice(LOCAL_PREFIX.length));
    if (pack?.layers) return <LayeredBanner pack={pack} stage={stage} size={size} />;
    if (pack) return <LocalBanner pack={pack} stage={stage} size={size} />;
    return <StreakBanner variant="standard" stage={stage} size={size} />; // pack removed or still listing
  }
  return <StreakBanner variant={(BANNERS as readonly string[]).includes(variant) ? (variant as BannerId) : 'standard'} stage={stage} size={size} />;
}

// ── the player's choice ─────────────────────────────────────────────────────────────────────
const KEY = 'pv-loading-banner';
const subs = new Set<() => void>();
function read(): string {
  try { const v = globalThis.localStorage?.getItem(KEY); if (v && ((BANNERS as readonly string[]).includes(v) || v.startsWith(LOCAL_PREFIX))) return v; } catch { /* no storage */ }
  return 'standard';
}
let current: string = read();
/** `id` is a built-in BannerId or `local:<pack>`. */
export function setLoadingBanner(id: string): void {
  current = id;
  try { globalThis.localStorage?.setItem(KEY, id); } catch { /* no storage */ }
  for (const s of subs) s();
}
export function useLoadingBanner(): string {
  return useSyncExternalStore((l) => { subs.add(l); return () => { subs.delete(l); }; }, () => current, () => current);
}

// ── banner sound (opt-in) ──────────────────────────────────────────────────────────────────
const SOUND_KEY = 'pv-loading-banner-sound';
export interface BannerSound { on: boolean; volume: number }
function readSound(): BannerSound {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(SOUND_KEY) ?? 'null') as Partial<BannerSound> | null;
    if (v && typeof v === 'object') return { on: v.on === true, volume: typeof v.volume === 'number' ? Math.min(1, Math.max(0, v.volume)) : 0.3 };
  } catch { /* no storage or bad value */ }
  return { on: false, volume: 0.3 };
}
let sound: BannerSound = readSound();
const soundSubs = new Set<() => void>();
export function setBannerSound(patch: Partial<BannerSound>): void {
  sound = { ...sound, ...patch, volume: Math.min(1, Math.max(0, patch.volume ?? sound.volume)) };
  try { globalThis.localStorage?.setItem(SOUND_KEY, JSON.stringify(sound)); } catch { /* no storage */ }
  for (const s of soundSubs) s();
}
export function useBannerSound(): BannerSound {
  return useSyncExternalStore((l) => { soundSubs.add(l); return () => { soundSubs.delete(l); }; }, () => sound, () => sound);
}
