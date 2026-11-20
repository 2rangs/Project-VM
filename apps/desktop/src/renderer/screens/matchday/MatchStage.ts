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
import type { NavDebugFrame, Roadmap } from '../../matchday/navdebug.ts';

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
  /**
   * Developer view: the navigation debug overlay — the walkable floor as the engine's roadmap
   * knows it, the zone graph with connected / unconnected zones, and (with `navDebug`) each
   * player's destination, planned waypoints, walked trace, replans and path failures.
   */
  readonly showGraph: boolean;
  /** What the navigation layer planned for the viewed team at this instant (see navdebug.ts). */
  readonly navDebug?: NavDebugFrame | null;
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
  /**
   * Navigation debug, static part, redrawn only when the camera changes. `floor` is the walkable
   * surface: drawn opaque and flattened to one texture, so overlapping corridors give ONE even
   * tint whose edge is the outline of the floor. `road` is the roadmap and zone graph on top.
   */
  readonly floor = new Graphics();
  readonly road = new Graphics();
  roadSig = '';
  readonly under = new Graphics();
  readonly over = new Graphics();
  readonly labels = new Container();
  private readonly pool = new Map<string, Text>();
  private used = new Set<string>();

  constructor(readonly resolution: number) {
    this.root.addChild(this.clip, this.mapDim, this.litMask, this.mapLit, this.floor, this.road, this.under, this.over, this.labels);
    this.floor.alpha = 0.3;
    this.floor.visible = false;
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
  private roadmap: Roadmap | null = null;

  /** The engine's navigation roadmap, for the developer overlay. */
  setRoadmap(roadmap: Roadmap | null): void {
    this.roadmap = roadmap;
    for (const n of this.nodes.values()) n.roadSig = '';
  }

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

    // Navigation debug (developer view). Static part: the walkable floor as the roadmap knows it
    // and the zone graph. The zone graph's links are straight lines between zone centres — they
    // are adjacency, not routes; the routes are the roadmap underneath.
    this.drawRoad(node, cam, opts.showGraph && !view.followId);
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
          this.arc(over, p.x, p.y, r + 6, -Math.PI / 2, -Math.PI / 2 + sp.progress * Math.PI * 2).stroke({ color: C.ally, width: 3 });
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
        if (u.pose.hopProgress != null && u.pose.toZone) {
          // On the way to another zone (zone-hop engine): no path is drawn — the destination is
          // ringed, and an arc around the player shows how far along they are.
          this.arc(over, p.x, p.y, r + 4, -Math.PI / 2, -Math.PI / 2 + u.pose.hopProgress * Math.PI * 2).stroke({ color: C.ink, width: 2, alpha: 0.9 });
          const dest = nav.zone(u.pose.toZone);
          if (dest) {
            const q = this.toScreen(cam, dest.position);
            const rr = this.px(cam, 360);
            for (let k = 0; k < 12; k += 2) this.arc(over, q.x, q.y, rr, (k / 12) * Math.PI * 2, ((k + 1) / 12) * Math.PI * 2).stroke({ color: C.ally, width: 2, alpha: 0.75 });
            relevant.add(dest.id);
          }
        }
        if ((u.status.state === 'planting' || u.status.state === 'defusing') && u.status.progress != null) {
          this.arc(over, p.x, p.y, r + 5, -Math.PI / 2, -Math.PI / 2 + u.status.progress * Math.PI * 2).stroke({ color: C.sound, width: 3 });
        }
        node.label(`s:${u.id}`, String(u.slot), p.x, p.y, me ? 13 : compact ? 10 : 12, C.bg);
        if (!compact || me) node.label(`n:${u.id}`, opts.nameOf(u.id), p.x, p.y + r + 10, compact ? 10 : 12, C.ally);
        relevant.add(u.pose.zone);
      }
    } else if (frame && lost && follow) {
      const p = this.toScreen(cam, follow.pose.pos);
      this.cross(over, p.x, p.y, 9, C.dead, 0.9);
    }

    if (opts.showGraph && opts.navDebug && !follow && !lost) this.drawNavDebug(node, over, cam, opts.navDebug, opts.nameOf);

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

  /** The static navigation layer of one view; rebuilt only when the camera (or the roadmap) changes. */
  private drawRoad(node: ViewNode, cam: Camera, on: boolean): void {
    const sig = on ? `${cam.cx.toFixed(1)},${cam.cy.toFixed(1)},${cam.cu.toFixed(5)},${cam.cv.toFixed(5)},${cam.scale.toFixed(3)},${cam.rot.toFixed(4)},${this.roadmap ? 1 : 0}` : '';
    if (sig === node.roadSig) return;
    node.roadSig = sig;
    const g = node.road.clear();
    const f = node.floor;
    if (f.isCachedAsTexture) f.cacheAsTexture(false);
    f.clear();
    f.visible = on && !!this.roadmap;
    if (!on) return;
    const road = this.roadmap;
    if (road) {
      // the floor: every walkable roadmap segment at its measured width, every node at its
      // clearance — opaque, then flattened, so the union reads as one surface with one edge
      for (const s of road.segments) {
        if (s.kind !== 'walk') continue;
        const a = this.toScreen(cam, s.a), b = this.toScreen(cam, s.b);
        f.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: C.navFloor, width: Math.max(2, this.px(cam, Math.max(35, s.halfWidth) * 2)), cap: 'round' });
      }
      for (const n of road.nodes) {
        if (n.clearance <= 0) continue;
        const p = this.toScreen(cam, n.pos);
        f.circle(p.x, p.y, Math.max(1, this.px(cam, n.clearance))).fill({ color: C.navFloor });
      }
      f.cacheAsTexture({ resolution: node.resolution, antialias: true });
      // the roadmap itself: walk edges, one-way drops, authored links
      for (const s of road.segments) {
        const a = this.toScreen(cam, s.a), b = this.toScreen(cam, s.b);
        if (s.kind === 'walk') g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: C.navFloor, width: 1, alpha: 0.28 });
        else {
          const color = s.kind === 'drop' ? C.navDrop : C.navLink;
          g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color, width: 1, alpha: 0.7 });
          g.circle(b.x, b.y, 1.6).fill({ color, alpha: 0.8 }); // the end it leads to
        }
      }
    }
    // the zone graph
    for (const l of this.nav.links) {
      const a = this.nav.zone(l.a), b = this.nav.zone(l.b);
      if (!a || !b) continue;
      const pa = this.toScreen(cam, a.position), pb = this.toScreen(cam, b.position);
      g.moveTo(pa.x, pa.y).lineTo(pb.x, pb.y).stroke({ color: C.sound, width: 1, alpha: 0.4 });
    }
    // every zone's standing point: connected to the floor, or not
    const conn = new Map((road?.zones ?? []).map((z) => [z.id, z]));
    for (const z of this.nav.zones) {
      const c = conn.get(z.id);
      const p = this.toScreen(cam, c?.anchor ?? z.position);
      if (!road || c?.connected) g.circle(p.x, p.y, 5).stroke({ color: road ? C.navOk : C.sound, width: 2, alpha: 0.9 });
      else { g.circle(p.x, p.y, 7).stroke({ color: C.enemy, width: 2, alpha: 0.95 }); this.cross(g, p.x, p.y, 4, C.enemy, 0.95); }
    }
  }

  private prefColor(pref: string | undefined): number {
    return pref === 'SAFEST' ? C.navSafest : pref === 'STEALTH' ? C.navStealth : pref === 'TACTICAL' ? C.navTactical : C.navFastest;
  }

  /** The moving part of the navigation debug view: plans, traces, replans, failures, priced patches. */
  private drawNavDebug(node: ViewNode, g: Graphics, cam: Camera, dbg: NavDebugFrame, nameOf: (id: string) => string): void {
    for (const h of dbg.hazards) {
      const p = this.toScreen(cam, h);
      g.circle(p.x, p.y, Math.max(3, this.px(cam, h.radius))).fill({ color: C.navDrop, alpha: 0.12 }).stroke({ color: C.navDrop, width: 1.5, alpha: 0.8 });
    }
    for (const plan of dbg.plans) {
      // where the player actually went
      if (plan.trail.length > 1) {
        const p0 = this.toScreen(cam, plan.trail[0]!);
        g.moveTo(p0.x, p0.y);
        for (let i = 1; i < plan.trail.length; i++) { const p = this.toScreen(cam, plan.trail[i]!); g.lineTo(p.x, p.y); }
        g.stroke({ color: C.navTrail, width: 1.5, alpha: 0.55 });
      }
      for (const r of plan.replans) { const p = this.toScreen(cam, r); this.diamond(g, p.x, p.y, 4).fill({ color: C.navReplan, alpha: 0.95 }); }
      for (const f of plan.failures) {
        if (!f.from) continue;
        const p = this.toScreen(cam, f.from);
        this.cross(g, p.x, p.y, 5, C.enemy, f === plan.failure ? 1 : 0.5);
      }
      // what the player plans to walk from here: the waypoints ahead and the destination
      const color = this.prefColor(plan.event?.preference);
      if (plan.ahead.length > 1) {
        const p0 = this.toScreen(cam, plan.ahead[0]!);
        g.moveTo(p0.x, p0.y);
        for (let i = 1; i < plan.ahead.length; i++) { const p = this.toScreen(cam, plan.ahead[i]!); g.lineTo(p.x, p.y); }
        g.stroke({ color, width: 2, alpha: 0.95 });
        for (let i = 1; i < plan.ahead.length - 1; i++) { const p = this.toScreen(cam, plan.ahead[i]!); g.circle(p.x, p.y, 2).fill({ color, alpha: 0.95 }); }
      }
      if (plan.destination && plan.ahead.length > 1) {
        const p = this.toScreen(cam, plan.destination);
        g.rect(p.x - 5, p.y - 5, 10, 10).stroke({ color, width: 2 });
        node.label(`nd:${plan.playerId}`, `${plan.slot}`, p.x, p.y, 9, color);
      }
      if (plan.failure?.from) {
        const p = this.toScreen(cam, plan.failure.from);
        node.label(`nf:${plan.playerId}`, `${nameOf(plan.playerId)}: NO PATH`, p.x, p.y - 20, 11, C.enemy);
      }
    }
  }

  /** An open arc as its own sub-path (a bare `arc` would be joined to the previous point by a straight line). */
  private arc(g: Graphics, x: number, y: number, r: number, a0: number, a1: number): Graphics {
    return g.moveTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r).arc(x, y, r, a0, a1);
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
