// PixiJS minimap renderer. Pure presentation: given a ReplaySnapshot + the
// replay's coordinate transform, it draws player dots, facing lines and event
// markers. It never computes game state (the engine does that) — DECISION-007/§24.5.
//
// Two render modes:
//  - render(): ground truth — every player's real position (Dev view).
//  - renderPerception(): one team's FOG-OF-WAR view — only what that team observes
//    (last-seen enemies + ghosts + sound cues) plus an optional belief heatmap,
//    all from the perception track (observation/belief only, never ground truth,
//    DECISION-004). Our own ground-truth player dots are hidden in this mode.
import { Application, Assets, Container, Graphics, Sprite, Text } from 'pixi.js';
import {
  projectToPixels, type CoordinateTransform, type PerceptionSnapshot, type Replay,
  type ReplayEvent, type ReplaySnapshot, type Vec3,
} from '@pv/replay-engine';

const TEAM_COLORS = [0x3cdcff, 0xff9f40]; // 0 = attack-ish, 1 = defense-ish
const DEAD_COLOR = 0x6b7280;
const ENEMY_COLOR = 0xff4d4f;
const SOUND_COLOR = 0xffd166;
const EVENT_COLORS: Record<string, number> = {
  kill: 0xff4d4f, plant: 0xffd166, defuse: 0x4dd0e1, abilitySpawn: 0xb388ff,
};

/** POV + overlay options for a fog-of-war render. povTeamIdx null = ground truth. */
export interface PerceptionRenderOpts {
  povTeamIdx: number | null;
  showBelief: boolean;
  /** Zone id → world centroid, for placing belief/sound overlays (PV-4 navgraph). */
  zonePositions: Record<string, Vec3>;
}

export class ReplayStage {
  private app = new Application();
  private mapLayer = new Container();
  private heatLayer = new Container();
  private eventLayer = new Container();
  private dotLayer = new Container();
  private fogLayer = new Container();
  size = 760;
  private ready = false;

  async init(mount: HTMLElement, size = 760): Promise<void> {
    this.size = size;
    await this.app.init({ width: size, height: size, background: 0x0b0e13, antialias: true });
    mount.appendChild(this.app.canvas);
    // heat under markers, fog (observed enemies / sounds) on top.
    this.app.stage.addChild(this.mapLayer, this.heatLayer, this.eventLayer, this.dotLayer, this.fogLayer);
    this.ready = true;
  }

  /** Load the map minimap image; on failure draw a neutral backdrop so dots still show. */
  async setMap(url: string | null): Promise<boolean> {
    this.mapLayer.removeChildren();
    if (url) {
      try {
        const tex = await Assets.load({ src: url, loadParser: 'loadTextures' });
        const sprite = new Sprite(tex);
        sprite.width = this.size; sprite.height = this.size; sprite.alpha = 0.8;
        this.mapLayer.addChild(sprite);
        return true;
      } catch { /* fall through to backdrop */ }
    }
    const bg = new Graphics().rect(0, 0, this.size, this.size).fill(0x161b22).stroke({ color: 0x2b3440, width: 2 });
    this.mapLayer.addChild(bg);
    return false;
  }

  /** Draw persistent event markers for the whole replay (once per load). */
  drawEvents(replay: Replay): void {
    this.eventLayer.removeChildren();
    const t = replay.meta.coordinateTransform;
    if (!t) return;
    for (const e of replay.events) this.drawEventMarker(e, t);
  }

  private drawEventMarker(e: ReplayEvent, t: CoordinateTransform): void {
    if (!e.pos) return;
    const p = projectToPixels(e.pos, t, this.size);
    const color = EVENT_COLORS[e.kind] ?? 0x8899aa;
    const g = new Graphics();
    if (e.kind === 'kill') { g.poly([p.mx, p.my - 5, p.mx + 5, p.my + 4, p.mx - 5, p.my + 4]).fill(color); }
    else { g.rect(p.mx - 3, p.my - 3, 6, 6).fill(color); }
    g.alpha = 0.9;
    this.eventLayer.addChild(g);
  }

  /** Render one instant (ground truth). Called every animation frame by the React layer. */
  render(snapshot: ReplaySnapshot, replay: Replay): void {
    if (!this.ready) return;
    const t = replay.meta.coordinateTransform;
    this.dotLayer.removeChildren();
    if (!t) return;
    const teamOf = new Map(replay.players.map((p) => [p.id, p.teamIdx ?? 0]));
    for (const pl of snapshot.players) {
      const p = projectToPixels(pl.pos, t, this.size);
      const dead = pl.state === 'dead';
      const color = dead ? DEAD_COLOR : (TEAM_COLORS[teamOf.get(pl.playerId) ?? 0] ?? 0xffffff);
      const g = new Graphics();
      // facing line
      if (pl.facingDeg != null && !dead) {
        const rad = ((90 - pl.facingDeg) * Math.PI) / 180; // 0°=up on minimap
        g.moveTo(p.mx, p.my).lineTo(p.mx + Math.cos(rad) * 13, p.my - Math.sin(rad) * 13).stroke({ color, width: 2 });
      }
      g.circle(p.mx, p.my, dead ? 3 : 5).fill(color).stroke({ color: 0x0b0e13, width: 1.5 });
      this.dotLayer.addChild(g);
      const label = new Text({ text: pl.playerId.replace('player_', 'P'), style: { fill: color, fontSize: 10, fontFamily: 'monospace' } });
      label.x = p.mx + 7; label.y = p.my - 6;
      this.dotLayer.addChild(label);
    }
  }

  /**
   * Render one instant from ONE team's perspective. With povTeamIdx null this is
   * just the ground-truth render; otherwise it hides our real player dots and draws
   * only the perception snapshot: observed enemies (solid = visible now, hollow ghost
   * = last-seen with staleness), sound cues at their zone, and an optional belief
   * heatmap. `perc` is perceptionAt(replay, povTeamIdx, tMs) (null → nothing observed yet).
   */
  renderPerception(
    snapshot: ReplaySnapshot, replay: Replay, perc: PerceptionSnapshot | null, opts: PerceptionRenderOpts,
  ): void {
    if (!this.ready) return;
    this.render(snapshot, replay); // ground-truth player dots
    this.heatLayer.removeChildren();
    this.fogLayer.removeChildren();
    if (opts.povTeamIdx == null) return; // Dev / ground-truth view: no fog overlays
    const t = replay.meta.coordinateTransform;
    this.dotLayer.removeChildren(); // fog: we don't reveal real positions
    if (!t) return;
    const at = (zone: string) => {
      const zp = opts.zonePositions[zone];
      return zp ? projectToPixels(zp, t, this.size) : null;
    };

    // belief heatmap (zone probability → translucent blob)
    if (opts.showBelief && perc) {
      for (const b of perc.beliefZones) {
        const p = at(b.zone); if (!p) continue;
        const radius = 24 + b.p * 36;
        this.heatLayer.addChild(new Graphics().circle(p.mx, p.my, radius).fill({ color: ENEMY_COLOR, alpha: 0.08 + b.p * 0.32 }));
      }
    }

    // sound cues (footsteps etc.) localized to a zone
    if (perc) {
      for (const s of perc.sounds ?? []) {
        const p = at(s.zone); if (!p) continue;
        this.fogLayer.addChild(new Graphics().circle(p.mx, p.my, 11).stroke({ color: SOUND_COLOR, width: 2, alpha: 0.85 }));
        const label = new Text({ text: '♪', style: { fill: SOUND_COLOR, fontSize: 12, fontFamily: 'monospace' } });
        label.x = p.mx - 4; label.y = p.my - 9; this.fogLayer.addChild(label);
      }
    }

    // observed enemies — solid when visible now, hollow ghost (with staleness) when last-seen
    if (perc) {
      for (const e of perc.observedEnemies) {
        if (!e.pos) continue;
        const p = projectToPixels(e.pos, t, this.size);
        const g = new Graphics();
        if (e.currentlyVisible) g.circle(p.mx, p.my, 6).fill({ color: ENEMY_COLOR }).stroke({ color: 0x0b0e13, width: 1.5 });
        else g.circle(p.mx, p.my, 6).stroke({ color: ENEMY_COLOR, width: 2, alpha: 0.55 });
        this.fogLayer.addChild(g);
        const secs = Math.max(0, Math.round(e.lastSeenMsAgo / 1000));
        const txt = e.currentlyVisible ? (e.enemyId ?? 'contact') : `${e.enemyId ?? '?'} ·${secs}s`;
        const label = new Text({ text: txt, style: { fill: 0xff9a9a, fontSize: 9, fontFamily: 'monospace' } });
        label.x = p.mx + 8; label.y = p.my - 5; this.fogLayer.addChild(label);
      }
    }
  }

  destroy(): void { try { this.app.destroy(true); } catch { /* noop */ } }
}
