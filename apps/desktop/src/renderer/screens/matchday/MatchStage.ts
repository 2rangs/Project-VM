// PixiJS stage for the live match screen. ONE Application (one canvas, one WebGL context) is
// created when the screen opens and lives until it closes; both view modes draw into it through
// "views" — rectangles of the canvas with their own camera:
//
//   tactical map  → 1 view  (whole map, north up, the team's picture)
//   team cams     → 6 views (5 × follow one player, rotated so they look up; 1 × team picture)
//
// Switching modes or focusing a monitor only changes the view list; no scene is rebuilt.
// Per frame the stage clears and redraws a handful of Graphics and repositions pooled Text
// objects — display objects are created once per view and reused.
//
// Pure presentation: it draws a Frame (src/renderer/matchday/frame.ts) and never decides what
// a team or player knows.
import { Application, Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { CoordinateTransform } from '@pv/replay-engine';
import type { NavModel, Vec3 } from '../../matchday/nav.ts';
import type { Frame, FrameEnemy, FrameUnit } from '../../matchday/frame.ts';
import { findPlayer, formationOffset } from '../../matchday/timeline.ts';
import { PERCEPTION } from '../../matchday/visibility.ts';
import { C, FONT } from '../../matchday/theme.ts';

export interface StageView {
  readonly key: string;
  readonly x: number; readonly y: number; readonly w: number; readonly h: number;
  /** Player id to follow (monitor), or null for the team picture. */
  readonly followId: string | null;
  /** 'full' labels every zone and player; 'compact' only what matters in a small tile. */
  readonly detail: 'full' | 'compact';
}

export interface StageOptions {
  readonly showBelief: boolean;
  /** Display name for an engine player id in the current round. */
  readonly nameOf: (id: string) => string;
}

interface Camera { cx: number; cy: number; cu: number; cv: number; scale: number; rot: number; cos: number; sin: number }

const TEX = 1024; // nominal map texture size; the real size is read from the texture

class ViewNode {
  readonly root = new Container();
  readonly clip = new Graphics();
  readonly mapDim = new Sprite();
  readonly mapLit = new Sprite();
  readonly litMask = new Graphics();
  readonly under = new Graphics();
  readonly over = new Graphics();
  readonly labels = new Container();
  private readonly pool = new Map<string, Text>();
  private used = new Set<string>();

  constructor(private readonly resolution: number) {
    this.root.addChild(this.clip, this.mapDim, this.litMask, this.mapLit, this.under, this.over, this.labels);
    this.root.mask = this.clip;
    this.mapLit.mask = this.litMask;
    this.mapDim.alpha = 0.3;
    this.mapLit.alpha = 0.95;
  }

  beginLabels(): void { this.used = new Set(); }
  endLabels(): void { for (const [k, t] of this.pool) t.visible = this.used.has(k); }

  label(key: string, text: string, x: number, y: number, size: number, fill: number, alpha = 1, anchorX = 0.5, anchorY = 0.5): void {
    let t = this.pool.get(key);
    if (!t) {
      t = new Text({ text, style: { fontFamily: FONT, fontSize: size, fill, fontWeight: '700', letterSpacing: 0.5 }, resolution: this.resolution });
      this.pool.set(key, t);
      this.labels.addChild(t);
    }
    if (t.text !== text) t.text = text;
    if (t.style.fontSize !== size) t.style.fontSize = size;
    if (t.style.fill !== fill) t.style.fill = fill;
    t.anchor.set(anchorX, anchorY);
    t.position.set(Math.round(x), Math.round(y));
    t.alpha = alpha;
    this.used.add(key);
  }
}

export class MatchStage {
  private app = new Application();
  private ready = false;
  private destroyed = false;
  private nodes = new Map<string, ViewNode>();
  private texture: Texture | null = null;
  private zoneBox = { u0: 0, v0: 0, u1: 1, v1: 1 };

  constructor(private readonly nav: NavModel, private readonly transform: CoordinateTransform) {
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
    for (const z of nav.zones) {
      const { u, v } = this.project(z.position);
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    if (Number.isFinite(u0)) this.zoneBox = { u0, v0, u1, v1 };
  }

  async init(mount: HTMLElement): Promise<void> {
    await this.app.init({
      width: Math.max(1, mount.clientWidth), height: Math.max(1, mount.clientHeight),
      backgroundAlpha: 0, antialias: true, autoDensity: true,
      resolution: Math.min(2, globalThis.devicePixelRatio || 1),
    });
    if (this.destroyed) { try { this.app.destroy(true); } catch { /* noop */ } return; }
    mount.appendChild(this.app.canvas);
    this.ready = true;
  }

  get isReady(): boolean { return this.ready; }

  resize(w: number, h: number): void {
    if (this.ready && w > 0 && h > 0) this.app.renderer.resize(w, h);
  }

  /** Load the map image; without it the stage draws the zone schematic on its own. */
  async setMap(url: string | null): Promise<boolean> {
    if (!url) return false;
    try {
      const tex = await Assets.load({ src: url, loadParser: 'loadTextures' });
      if (this.destroyed) return false;
      this.texture = tex as Texture;
      for (const n of this.nodes.values()) { n.mapDim.texture = this.texture; n.mapLit.texture = this.texture; }
      return true;
    } catch { return false; }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.ready) { try { this.app.destroy(true, { children: true }); } catch { /* noop */ } }
    this.ready = false;
  }

  // ── geometry ───────────────────────────────────────────────────────────────────────────

  private project(p: Vec3): { u: number; v: number } {
    const t = this.transform;
    return { u: p.y * t.xMultiplier + t.xScalarToAdd, v: p.x * t.yMultiplier + t.yScalarToAdd };
  }
  private toScreen(cam: Camera, p: Vec3): { x: number; y: number } {
    const { u, v } = this.project(p);
    const du = (u - cam.cu) * cam.scale, dv = (v - cam.cv) * cam.scale;
    return { x: cam.cx + du * cam.cos - dv * cam.sin, y: cam.cy + du * cam.sin + dv * cam.cos };
  }
  /** World units → pixels for this camera. */
  private px(cam: Camera, units: number): number { return units * Math.abs(this.transform.xMultiplier) * cam.scale; }
  /** Screen angle (radians) of a world heading. */
  private screenAngle(cam: Camera, headingRad: number): number {
    const du = Math.sin(headingRad) * this.transform.xMultiplier;
    const dv = Math.cos(headingRad) * this.transform.yMultiplier;
    return Math.atan2(dv, du) + cam.rot;
  }

  private cameraFor(view: StageView, frame: Frame | null): Camera {
    const cx = view.x + view.w / 2;
    const unit = view.followId ? frame?.units.find((u) => u.id === view.followId) : undefined;
    if (unit) {
      // Monitor: the player sits in the lower third looking up; ~52 m of map fit the height.
      const scale = view.h / (5200 * Math.abs(this.transform.xMultiplier));
      const du = Math.sin(unit.facingRad) * this.transform.xMultiplier;
      const dv = Math.cos(unit.facingRad) * this.transform.yMultiplier;
      const rot = -Math.PI / 2 - Math.atan2(dv, du);
      const { u, v } = this.project(unit.pose.pos);
      return { cx, cy: view.y + view.h * 0.7, cu: u, cv: v, scale, rot, cos: Math.cos(rot), sin: Math.sin(rot) };
    }
    const b = this.zoneBox;
    const pad = 0.055;
    const bw = b.u1 - b.u0 + pad * 2, bh = b.v1 - b.v0 + pad * 2;
    const scale = Math.min(view.w / bw, view.h / bh);
    return { cx, cy: view.y + view.h / 2, cu: (b.u0 + b.u1) / 2, cv: (b.v0 + b.v1) / 2, scale, rot: 0, cos: 1, sin: 0 };
  }

  // ── frame ──────────────────────────────────────────────────────────────────────────────

  render(frame: Frame | null, views: readonly StageView[], opts: StageOptions): void {
    if (!this.ready) return;
    const keep = new Set(views.map((v) => v.key));
    for (const [key, node] of this.nodes) {
      if (!keep.has(key)) { this.app.stage.removeChild(node.root); node.root.destroy({ children: true }); this.nodes.delete(key); }
    }
    for (const view of views) {
      let node = this.nodes.get(view.key);
      if (!node) {
        node = new ViewNode(this.app.renderer.resolution);
        if (this.texture) { node.mapDim.texture = this.texture; node.mapLit.texture = this.texture; }
        this.nodes.set(view.key, node);
        this.app.stage.addChild(node.root);
      }
      this.drawView(node, view, frame, opts);
    }
  }

  private drawView(node: ViewNode, view: StageView, frame: Frame | null, opts: StageOptions): void {
    const cam = this.cameraFor(view, frame);
    const { nav } = this;
    const compact = view.detail === 'compact';
    const follow = view.followId ? frame?.units.find((u) => u.id === view.followId) ?? null : null;
    const lost = !!follow && !follow.pose.alive;
    const t = frame?.tMs ?? 0;

    node.clip.clear().rect(view.x, view.y, view.w, view.h).fill(0xffffff);

    const hasMap = !!this.texture;
    for (const s of [node.mapDim, node.mapLit]) {
      s.visible = hasMap;
      if (!hasMap) continue;
      const size = this.texture!.width || TEX;
      s.pivot.set(cam.cu * size, cam.cv * size);
      s.position.set(cam.cx, cam.cy);
      s.rotation = cam.rot;
      s.scale.set(cam.scale / size);
    }
    node.mapDim.alpha = lost ? 0.14 : 0.3;
    node.mapLit.visible = hasMap && !lost;

    const under = node.under.clear();
    const over = node.over.clear();
    const lit = node.litMask.clear();
    node.beginLabels();

    // zone schematic: travel links + callout names (stronger when there is no map image)
    const linkAlpha = hasMap ? 0.1 : 0.32;
    for (const l of nav.links) {
      const a = nav.zone(l.a), b = nav.zone(l.b);
      if (!a || !b) continue;
      const pa = this.toScreen(cam, a.position), pb = this.toScreen(cam, b.position);
      under.moveTo(pa.x, pa.y).lineTo(pb.x, pb.y).stroke({ color: C.ink, width: 1, alpha: linkAlpha });
    }
    if (!hasMap) for (const z of nav.zones) { const p = this.toScreen(cam, z.position); under.circle(p.x, p.y, this.px(cam, 420)).fill({ color: C.line, alpha: 0.55 }); }

    const units = frame?.units ?? [];
    const scope: readonly FrameUnit[] = follow ? [follow] : units;
    const relevant = new Set<string>();

    // vision: what the units in scope are watching lights the map up
    let anyLit = false;
    for (const u of scope) {
      if (!u.pose.alive) continue;
      const p = this.toScreen(cam, u.pose.pos);
      lit.circle(p.x, p.y, this.px(cam, 420)).fill(0xffffff);
      anyLit = true;
      for (const zid of u.view.watched) {
        const z = nav.zone(zid); if (!z) continue;
        relevant.add(zid);
        const q = this.toScreen(cam, z.position);
        const r = this.px(cam, 520);
        lit.circle(q.x, q.y, r).fill(0xffffff);
        under.circle(q.x, q.y, r).fill({ color: C.ally, alpha: 0.05 }).stroke({ color: C.ally, width: 1, alpha: 0.18 });
        if (zid !== u.pose.zone) {
          // sightline corridor from the player to the watched zone
          const dx = q.x - p.x, dy = q.y - p.y; const len = Math.hypot(dx, dy) || 1;
          const nx = (-dy / len) * this.px(cam, 300), ny = (dx / len) * this.px(cam, 300);
          lit.poly([p.x + nx * 0.4, p.y + ny * 0.4, q.x + nx, q.y + ny, q.x - nx, q.y - ny, p.x - nx * 0.4, p.y - ny * 0.4]).fill(0xffffff);
          under.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ color: C.ally, width: 1, alpha: 0.22 });
        }
      }
      // the 110° cone the engine uses for detection
      const a = this.screenAngle(cam, u.facingRad);
      const half = (PERCEPTION.halfFovDeg * Math.PI) / 180;
      const r = this.px(cam, follow ? 1500 : 1000);
      under.moveTo(p.x, p.y).arc(p.x, p.y, r, a - half, a + half).closePath().fill({ color: C.ally, alpha: follow ? 0.1 : 0.07 });
      lit.moveTo(p.x, p.y).arc(p.x, p.y, r, a - half, a + half).closePath().fill(0xffffff);
    }
    if (!anyLit) lit.rect(0, 0, 1, 1).fill(0xffffff); // keep the mask non-empty

    // belief heat (team picture only)
    if (frame && opts.showBelief && !follow) {
      for (const b of frame.belief) {
        const z = nav.zone(b.zone); if (!z) continue;
        const p = this.toScreen(cam, z.position);
        under.circle(p.x, p.y, this.px(cam, 380 + b.p * 420)).fill({ color: C.enemy, alpha: 0.07 + b.p * 0.2 });
      }
    }

    // sound cues: pulsing rings at the zone the sound was localised to
    const sounds = follow ? (lost ? [] : follow.view.sounds) : frame?.sounds ?? [];
    for (const s of sounds) {
      if (s.kind !== 'footstep' && s.ageMs > 3000) continue;
      const z = nav.zone(s.zone); if (!z) continue;
      relevant.add(s.zone);
      const p = this.toScreen(cam, z.position);
      const fade = s.kind === 'footstep' ? 1 : 1 - s.ageMs / 3000;
      const base = compact ? 9 : 12;
      for (let i = 0; i < 2; i++) {
        const ph = ((t / 900 + i * 0.5) % 1 + 1) % 1;
        over.circle(p.x, p.y, base + ph * base * 1.7).stroke({ color: C.sound, width: 1.5, alpha: (1 - ph) * 0.8 * fade });
      }
      if (s.kind === 'gunfire') {
        const r = base * 0.75;
        over.poly([p.x, p.y - r, p.x + r * 0.3, p.y - r * 0.3, p.x + r, p.y, p.x + r * 0.3, p.y + r * 0.3, p.x, p.y + r, p.x - r * 0.3, p.y + r * 0.3, p.x - r, p.y, p.x - r * 0.3, p.y - r * 0.3]).fill({ color: C.sound, alpha: fade });
      } else {
        over.roundRect(p.x - 5, p.y - 4, 4, 8, 2).fill({ color: C.sound, alpha: 0.95 });
        over.roundRect(p.x + 1, p.y - 2, 4, 8, 2).fill({ color: C.sound, alpha: 0.95 });
      }
    }

    if (frame && !lost) {
      const round = frame.round;
      // kill markers — the kill feed is public, and a kill happens in front of both players
      for (const k of frame.kills) {
        const victim = findPlayer(round, k.victimId);
        if (!victim || !k.pos) continue;
        const own = k.victimTeam === frame.team;
        if (own) continue; // our own dead are drawn with the units below
        const off = formationOffset(victim);
        const p = this.toScreen(cam, { x: k.pos.x + off.x, y: k.pos.y + off.y, z: k.pos.z });
        if (follow && !this.near(view, p)) continue;
        this.cross(over, p.x, p.y, compact ? 4 : 5, C.enemy, 0.55);
        const since = t - k.tMs;
        if (since < 700) over.circle(p.x, p.y, 8 + since / 28).stroke({ color: C.ink, width: 2, alpha: 1 - since / 700 });
      }

      // remembered sightings (team picture only — a monitor shows only what that player sees)
      if (!follow) {
        for (const g of frame.ghosts) {
          const p = this.toScreen(cam, g.pos);
          const alpha = Math.max(0.18, 0.75 * (1 - g.ageMs / PERCEPTION.memoryMs));
          this.diamond(over, p.x, p.y, compact ? 6 : 8).stroke({ color: C.enemy, width: 2, alpha });
          const secs = Math.round(g.ageMs / 1000);
          node.label(`g:${g.id}`, compact ? `${secs}s` : `${opts.nameOf(g.id)} · ${secs}s`, p.x, p.y + (compact ? 13 : 17), compact ? 10 : 11, C.enemy, Math.min(1, alpha + 0.2));
        }
      }

      // enemies in view
      const seen: readonly FrameEnemy[] = follow ? frame.seen.filter((e) => e.seenBy.includes(follow.id)) : frame.seen;
      for (const e of seen) {
        const p = this.toScreen(cam, e.pos);
        const r = compact && !follow ? 7 : 9;
        for (const id of e.seenBy) {
          if (follow && id !== follow.id) continue;
          const u = units.find((x) => x.id === id); if (!u) continue;
          const q = this.toScreen(cam, u.pose.pos);
          const duel = u.status.state === 'fighting' && u.status.opponentId === e.id;
          over.moveTo(q.x, q.y).lineTo(p.x, p.y).stroke({ color: duel ? C.ink : C.enemy, width: duel ? 2 : 1, alpha: duel ? 0.85 : 0.5 });
        }
        this.diamond(over, p.x, p.y, r).fill(C.enemy).stroke({ color: C.bg, width: 2 });
        node.label(`e:${e.id}`, opts.nameOf(e.id), p.x, p.y - r - 9, compact ? 10 : 12, C.enemy);
      }

      // spike
      const { plant, defuse } = round;
      const sp = frame.situation.spike;
      if (plant?.pos && (sp.phase === 'planted' || sp.phase === 'defusing' || sp.phase === 'defused' || sp.phase === 'detonated')) {
        const p = this.toScreen(cam, plant.pos);
        const r = compact ? 7 : 9;
        const remaining = sp.remainingMs ?? 0;
        const period = remaining < 10000 ? 450 : remaining < 20000 ? 800 : 1200;
        const ph = (t % period) / period;
        if (sp.phase !== 'defused') over.circle(p.x, p.y, r + ph * r * 2.2).stroke({ color: C.enemy, width: 2, alpha: (1 - ph) * 0.9 });
        this.hexagon(over, p.x, p.y, r).fill(sp.phase === 'defused' ? C.ally : C.spike).stroke({ color: C.bg, width: 2 });
        const ourDefuse = defuse && findPlayer(round, defuse.playerId)?.team === frame.team;
        if (sp.phase === 'defusing' && ourDefuse && sp.progress != null) {
          over.arc(p.x, p.y, r + 6, -Math.PI / 2, -Math.PI / 2 + sp.progress * Math.PI * 2).stroke({ color: C.ally, width: 3 });
        }
      }

      // own players
      for (const u of units) {
        const p = this.toScreen(cam, u.pose.pos);
        const me = follow?.id === u.id;
        const r = me ? 11 : compact ? 7 : 10;
        if (!u.pose.alive) {
          this.cross(over, p.x, p.y, compact ? 5 : 6, C.dead, 0.9);
          if (!compact) node.label(`n:${u.id}`, opts.nameOf(u.id), p.x, p.y + 15, 11, C.dead, 0.9);
          continue;
        }
        const a = this.screenAngle(cam, u.facingRad);
        over.moveTo(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r).lineTo(p.x + Math.cos(a) * (r + 9), p.y + Math.sin(a) * (r + 9)).stroke({ color: C.ally, width: 3 });
        if (u.status.state === 'fighting') {
          const lead = Math.min(1, Math.max(0, (t % 400) / 400));
          over.circle(p.x, p.y, r + 4 + lead * 5).stroke({ color: C.ink, width: 2, alpha: 1 - lead });
        }
        over.circle(p.x, p.y, r).fill(follow && !me ? C.allyDeep : C.ally).stroke({ color: C.bg, width: 2 });
        if ((u.status.state === 'planting' || u.status.state === 'defusing') && u.status.progress != null) {
          over.arc(p.x, p.y, r + 5, -Math.PI / 2, -Math.PI / 2 + u.status.progress * Math.PI * 2).stroke({ color: C.sound, width: 3 });
        }
        node.label(`s:${u.id}`, String(u.slot), p.x, p.y, me ? 13 : compact ? 10 : 12, C.bg);
        if (!compact || me) node.label(`n:${u.id}`, opts.nameOf(u.id), p.x, p.y + r + 10, compact ? 10 : 12, C.ally);
        relevant.add(u.pose.zone);
      }
    } else if (frame && lost && follow) {
      const p = this.toScreen(cam, follow.pose.pos);
      this.cross(over, p.x, p.y, 9, C.dead, 0.9);
    }

    // zone names
    for (const z of nav.zones) {
      if (compact && !relevant.has(z.id)) continue;
      const p = this.toScreen(cam, z.position);
      if (!this.near(view, p, 0)) continue;
      const on = relevant.has(z.id);
      node.label(`z:${z.id}`, z.name.toUpperCase(), p.x, p.y - this.px(cam, 300) - 4, compact ? 9 : 10, on ? C.ink : C.muted, lost ? 0.35 : on ? 0.9 : 0.55);
    }
    node.endLabels();
  }

  private near(view: StageView, p: { x: number; y: number }, margin = 12): boolean {
    return p.x >= view.x - margin && p.x <= view.x + view.w + margin && p.y >= view.y - margin && p.y <= view.y + view.h + margin;
  }
  private diamond(g: Graphics, x: number, y: number, r: number): Graphics {
    return g.poly([x, y - r, x + r, y, x, y + r, x - r, y]);
  }
  private hexagon(g: Graphics, x: number, y: number, r: number): Graphics {
    const pts: number[] = [];
    for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i - Math.PI / 6; pts.push(x + Math.cos(a) * r, y + Math.sin(a) * r); }
    return g.poly(pts);
  }
  private cross(g: Graphics, x: number, y: number, r: number, color: number, alpha: number): void {
    g.moveTo(x - r, y - r).lineTo(x + r, y + r).stroke({ color, width: 2.5, alpha });
    g.moveTo(x + r, y - r).lineTo(x - r, y + r).stroke({ color, width: 2.5, alpha });
  }
}
