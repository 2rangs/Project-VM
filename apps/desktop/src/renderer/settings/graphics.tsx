// Graphics quality — one setting (저/중/고) that tunes everything the match screen can make
// cheaper on a low-end office laptop: whether the 3D team cams exist at all, the render frame-rate
// ceiling, the device-pixel-ratio ceiling, how much per-frame animation runs, and 3D shadows.
//
// The default is picked once, on first run, from the hardware (GPU class, cores, memory, screen),
// then persisted. A manager can override it in the start-menu settings. Everything reads the
// resolved GraphicsConfig; nothing hard-codes a frame rate or pixel ratio any more.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type GraphicsQuality = 'low' | 'medium' | 'high';
export const QUALITIES: readonly GraphicsQuality[] = ['low', 'medium', 'high'];

export interface GraphicsConfig {
  quality: GraphicsQuality;
  /** Is the 3D team-cam view offered at all? Off on low: the tactical 2D map is enough and far cheaper. */
  cams3d: boolean;
  /** Upper bound on render frames per second (the playback loop and the 3D wall both obey it). */
  fpsCap: number;
  /** Ceiling on devicePixelRatio for the renderers (1 keeps a HiDPI panel from rasterising 4× the pixels). */
  dprMax: number;
  /** Minimal animation: skip heading smoothing, spike pulse and other per-frame easing. */
  minAnim: boolean;
  /** Render 3D shadow maps (off below high: soft shadows are the single most expensive 3D cost). */
  shadows: boolean;
}

const PRESETS: Record<GraphicsQuality, Omit<GraphicsConfig, 'quality'>> = {
  low: { cams3d: false, fpsCap: 30, dprMax: 1, minAnim: true, shadows: false },
  medium: { cams3d: true, fpsCap: 60, dprMax: 1.25, minAnim: false, shadows: false },
  high: { cams3d: true, fpsCap: 144, dprMax: 1.5, minAnim: false, shadows: true },
};

export function configFor(quality: GraphicsQuality): GraphicsConfig {
  return { quality, ...PRESETS[quality] };
}

// ── hardware probe (first-run default) ───────────────────────────────────────────────────────
type GpuClass = 'software' | 'integrated' | 'discrete' | 'unknown';

/** Read the GPU name via WebGL and bucket it. A throwaway context — not the match renderer. */
export function detectGpu(): GpuClass {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return 'software';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const raw = (dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) as string;
    const s = (raw || '').toLowerCase();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    if (/swiftshader|llvmpipe|software|microsoft basic|basic render/.test(s)) return 'software';
    if (/nvidia|geforce|quadro|radeon rx|radeon pro|amd\b|discrete/.test(s)) return 'discrete';
    if (/intel|uhd|iris|hd graphics|apple|adreno|mali|integrated|vega\b/.test(s)) return 'integrated';
    return 'unknown';
  } catch { return 'unknown'; }
}

/** First-run default from the hardware. Low-spec floor (integrated / 4 cores / 8 GB / 1366×768) → low. */
export function detectQuality(): GraphicsQuality {
  const gpu = detectGpu();
  if (gpu === 'software') return 'low';
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  const mem = (typeof navigator !== 'undefined' && (navigator as { deviceMemory?: number }).deviceMemory) || 8; // GB (Chromium caps at 8)
  const screenW = (typeof window !== 'undefined' && window.screen?.width) || 1920;
  if (gpu === 'discrete' && cores >= 8 && mem >= 16) return 'high';
  const weak = [gpu === 'integrated', cores <= 4, mem <= 8, screenW <= 1366].filter(Boolean).length;
  return weak >= 2 ? 'low' : 'medium';
}

// ── persistence + React context ───────────────────────────────────────────────────────────────
const KEY = 'pv-graphics-quality';

function initialQuality(): GraphicsQuality {
  try {
    const v = globalThis.localStorage?.getItem(KEY);
    if (v === 'low' || v === 'medium' || v === 'high') return v;
  } catch { /* no storage */ }
  const auto = detectQuality();
  try { globalThis.localStorage?.setItem(KEY, auto); } catch { /* no storage */ }
  return auto;
}

interface GraphicsCtx { quality: GraphicsQuality; config: GraphicsConfig; setQuality: (q: GraphicsQuality) => void }
const Ctx = createContext<GraphicsCtx | null>(null);

export function GraphicsProvider({ children }: { children: ReactNode }) {
  const [quality, setQualityState] = useState<GraphicsQuality>(initialQuality);
  const setQuality = useCallback((q: GraphicsQuality) => {
    setQualityState(q);
    try { globalThis.localStorage?.setItem(KEY, q); } catch { /* no storage */ }
  }, []);
  const value = useMemo<GraphicsCtx>(() => ({ quality, config: configFor(quality), setQuality }), [quality, setQuality]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Current graphics config. Outside a provider (tests, isolated renders) it falls back to high. */
export function useGraphics(): GraphicsCtx {
  const c = useContext(Ctx);
  if (c) return c;
  return { quality: 'high', config: configFor('high'), setQuality: () => {} };
}
