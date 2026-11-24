// Animation-state selection from track samples, model building (no NaN, bounded draw calls), poses.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  ANIM, BONE, FirstPersonRig, MAP_LIGHTING, OPERATOR_DRAW_CALLS, WEAPON_CLASSES, WEAPON_DRAW_CALLS, animInputFor,
  applyMapLighting, buildOperator, buildWeapon, drawCallsOf, lightingFor, poseOperator, selectAnimState,
  setOperatorWeapon, shotTimesFor, type AnimInput, type Role,
} from '../../src/renderer/screens/matchday/models.ts';

const ROLES: Role[] = ['controller', 'initiator', 'sentinel', 'duelist'];
const base: AnimInput = { tMs: 10_000, alive: true };

test('locomotion follows speed / moveMode', () => {
  assert.equal(selectAnimState({ ...base }).name, 'idle');
  assert.equal(selectAnimState({ ...base, moving: true, moveMode: 'run' }).name, 'run');
  assert.equal(selectAnimState({ ...base, moving: true, moveMode: 'walk' }).name, 'walk');
  assert.equal(selectAnimState({ ...base, speedUUps: 10 }).name, 'idle');
  assert.equal(selectAnimState({ ...base, speedUUps: 330 }).name, 'walk');
  assert.equal(selectAnimState({ ...base, speedUUps: 680 }).name, 'run');
  assert.equal(selectAnimState({ ...base, crouched: true }).name, 'crouch');
  assert.equal(selectAnimState({ ...base, crouched: true, speedUUps: 200 }).name, 'crouchWalk');
});

test('shooting: shoot during the burst, recoil decays, aim lead and hold, then reload', () => {
  const shots = [10_000];
  assert.equal(selectAnimState({ ...base, shotsMs: shots }).name, 'shoot');
  const k0 = selectAnimState({ ...base, shotsMs: shots }).kick;
  assert.ok(k0 > 0.95);
  assert.ok(selectAnimState({ ...base, tMs: 10_080, shotsMs: shots }).kick < k0);
  assert.equal(selectAnimState({ ...base, tMs: 9_700, shotsMs: shots }).name, 'aim'); // raising the gun before the shot
  assert.equal(selectAnimState({ ...base, tMs: 10_800, shotsMs: shots }).name, 'aim'); // holding the angle
  const rl = selectAnimState({ ...base, tMs: 10_000 + ANIM.reloadDelayMs + 400 + 1000, shotsMs: shots });
  assert.equal(rl.name, 'reload'); assert.ok(rl.actionT > 0 && rl.actionT < 1);
  assert.equal(selectAnimState({ ...base, tMs: 20_000, shotsMs: shots }).name, 'idle');
  assert.equal(selectAnimState({ ...base, shotsMs: shots }).flash, true);
});

test('plant / defuse / throw windows win over locomotion and report progress', () => {
  const w = { startMs: 9_000, endMs: 13_000 };
  const p = selectAnimState({ ...base, plant: w, moving: true, moveMode: 'run' });
  assert.equal(p.name, 'plant'); assert.ok(Math.abs(p.actionT - 0.25) < 1e-9); assert.equal(p.locomotion, 'crouch');
  assert.equal(selectAnimState({ ...base, defuse: w }).name, 'defuse');
  assert.equal(selectAnimState({ ...base, plant: { startMs: 1, endMs: 2 } }).name, 'idle');
  const t = selectAnimState({ ...base, abilityMs: [9_800] });
  assert.equal(t.name, 'throw'); assert.ok(t.actionT > 0.2 && t.actionT < 0.4);
  assert.equal(selectAnimState({ ...base, tMs: 9_800 + ANIM.throwMs + 1, abilityMs: [9_800] }).name, 'idle');
});

test('death: dead from deathMs, fall progresses 0..1, nothing else wins', () => {
  const d0 = selectAnimState({ ...base, deathMs: 10_000, plant: { startMs: 9_000, endMs: 13_000 }, shotsMs: [10_000] });
  assert.equal(d0.name, 'dead'); assert.equal(d0.deadT, 0); assert.equal(d0.kick, 0);
  assert.ok(Math.abs(selectAnimState({ ...base, tMs: 10_000 + ANIM.fallMs / 2, deathMs: 10_000 }).deadT - 0.5) < 1e-9);
  assert.equal(selectAnimState({ ...base, tMs: 99_999, deathMs: 10_000 }).deadT, 1);
  assert.equal(selectAnimState({ ...base, alive: false }).name, 'dead');
  assert.equal(selectAnimState({ ...base, tMs: 9_999, deathMs: 10_000 }).name, 'idle'); // scrubbing back revives
});

test('animInputFor reads kills / plant / defuse of this player only', () => {
  const round = {
    kills: [{ tMs: 5000, killerId: 'a', victimId: 'b', killerTeam: 'A', victimTeam: 'B', pos: null, zone: null }],
    plant: { tMs: 14_000, startMs: 10_000, playerId: 'a', pos: null, zone: null, site: 'A' },
    defuse: null,
  } as never;
  const inp = animInputFor(round, { id: 'a', deathMs: null }, { alive: true, moving: false, moveMode: null }, 11_000, 'rifle');
  assert.deepEqual(inp.plant, { startMs: 10_000, endMs: 14_000 });
  assert.equal(selectAnimState(inp).name, 'plant');
  const other = animInputFor(round, { id: 'c', deathMs: null }, { alive: true, moving: false, moveMode: null }, 11_000);
  assert.equal(other.plant, null);
  assert.equal(shotTimesFor([{ tMs: 5000, killerId: 'a', victimId: 'b' }], 'a').length, ANIM.burstShots);
  assert.equal(shotTimesFor([{ tMs: 5000, killerId: 'a', victimId: 'b' }], 'z').length, 0);
});

const finite = (o: THREE.Object3D): boolean => {
  o.updateMatrixWorld(true);
  let ok = true;
  o.traverse((n) => {
    if (!ok) return;
    for (const e of n.matrixWorld.elements) if (!Number.isFinite(e)) ok = false;
    const m = n as THREE.Mesh;
    if (m.isMesh) {
      const pos = m.geometry.getAttribute('position');
      for (let i = 0; i < pos.array.length; i++) if (!Number.isFinite(pos.array[i]!)) { ok = false; break; }
    }
  });
  return ok;
};

test('operators: every role builds, bounded draw calls, shared geometry, sane size', () => {
  for (const role of ROLES) {
    const a = buildOperator(role, 0x3fd0ff), b = buildOperator(role, 0x3fd0ff);
    assert.equal(a.meshes[0]!.geometry, b.meshes[0]!.geometry, 'geometry is shared per role+accent');
    setOperatorWeapon(a, 'rifle', 0x3fd0ff);
    assert.ok(drawCallsOf(a.root) <= OPERATOR_DRAW_CALLS + WEAPON_DRAW_CALLS, `${role}: ${drawCallsOf(a.root)}`);
    assert.equal(a.skeleton.bones.length, Object.keys(BONE).length);
    const box = new THREE.Box3().setFromObject(a.root);
    poseOperator(a, selectAnimState({ tMs: 0, alive: true }), 0, 0);
    a.root.updateMatrixWorld(true);
    a.meshes[0]!.computeBoundingBox();
    const bb = a.meshes[0]!.geometry.boundingBox!;
    assert.ok(bb.max.y > 1.7 && bb.max.y < 2.1, `${role} height ${bb.max.y}`);
    assert.ok(finite(a.root) && box);
  }
  const tris = (g: THREE.BufferGeometry) => g.getAttribute('position').count / 3;
  const op = buildOperator('sentinel', 0xff4655);
  assert.ok(tris(op.meshes[0]!.geometry) < 20_000, 'operator stays light');
});

test('ten players, weapons: 40 draw calls at most', () => {
  const grp = new THREE.Group();
  for (let i = 0; i < 10; i++) {
    const op = buildOperator(ROLES[i % 4]!, i < 5 ? 0x3fd0ff : 0xff4655);
    setOperatorWeapon(op, WEAPON_CLASSES[i % WEAPON_CLASSES.length]!, i < 5 ? 0x3fd0ff : 0xff4655);
    grp.add(op.root);
  }
  assert.ok(drawCallsOf(grp) <= 10 * (OPERATOR_DRAW_CALLS + WEAPON_DRAW_CALLS));
});

test('weapons: all classes, muzzle forward of grip, finite, two meshes at most', () => {
  for (const c of WEAPON_CLASSES) {
    const w = buildWeapon(c, 0xffffff);
    assert.ok(drawCallsOf(w) <= WEAPON_DRAW_CALLS);
    assert.ok(w.userData.muzzle[0] > 0.1 && finite(w), c);
    assert.ok(w.userData.magazine.every(Number.isFinite));
  }
});

test('every state poses without NaN for every role and weapon class', () => {
  const states: AnimInput[] = [
    { ...base }, { ...base, moving: true, moveMode: 'run' }, { ...base, moving: true, moveMode: 'walk' },
    { ...base, crouched: true }, { ...base, crouched: true, speedUUps: 200 }, { ...base, shotsMs: [10_000] },
    { ...base, tMs: 9_700, shotsMs: [10_000] }, { ...base, tMs: 11_500, shotsMs: [10_000] },
    { ...base, plant: { startMs: 9_000, endMs: 13_000 } }, { ...base, defuse: { startMs: 9_000, endMs: 13_000 } },
    { ...base, abilityMs: [9_800] }, { ...base, tMs: 10_300, deathMs: 10_000 }, { ...base, tMs: 12_000, deathMs: 10_000 },
  ];
  for (const role of ROLES) {
    for (const cls of WEAPON_CLASSES) {
      const op = buildOperator(role, 0x3fd0ff); setOperatorWeapon(op, cls, 0x3fd0ff);
      for (const s of states) {
        for (let ph = 0; ph < 3; ph++) {
          poseOperator(op, selectAnimState({ ...s, weapon: cls }), s.tMs, ph * 1.3, 0.2);
          op.skeleton.update();
          assert.ok(finite(op.root), `${role} ${cls}`);
        }
      }
    }
  }
});

test('arms reach their grips while aiming (wrist within the arm reach of the weapon points)', () => {
  const op = buildOperator('duelist', 0x3fd0ff); setOperatorWeapon(op, 'rifle', 0x3fd0ff);
  poseOperator(op, selectAnimState({ ...base, shotsMs: [10_000] }), 10_000, 0);
  op.root.updateMatrixWorld(true);
  const wrist = (fore: THREE.Bone) => new THREE.Vector3(0, -0.34, 0).applyMatrix4(fore.matrixWorld);
  const grip = new THREE.Vector3(0, -0.03, 0).applyMatrix4(op.gunMount.matrixWorld);
  const fg = new THREE.Vector3(0.42, -0.035, -0.01).applyMatrix4(op.gunMount.matrixWorld);
  const near = (a: THREE.Vector3, b: THREE.Vector3) => a.distanceTo(b);
  const best = Math.min(near(wrist(op.foreArmL), grip), near(wrist(op.foreArmR), grip));
  const best2 = Math.min(near(wrist(op.foreArmL), fg), near(wrist(op.foreArmR), fg));
  assert.ok(best < 0.14, `trigger hand ${best}`); assert.ok(best2 < 0.2, `support hand ${best2}`);
});

test('first-person rig: every class and state, finite, hidden when dead, bounded draw calls', () => {
  const fp = new FirstPersonRig(0x3fd0ff);
  for (const cls of WEAPON_CLASSES) {
    for (const s of [{ ...base }, { ...base, shotsMs: [10_000] }, { ...base, tMs: 11_500, shotsMs: [10_000] }, { ...base, plant: { startMs: 9_000, endMs: 13_000 } }, { ...base, abilityMs: [9_800] }, { ...base, moving: true, moveMode: 'run' as const }]) {
      fp.update(cls, selectAnimState({ ...s, weapon: cls }), s.tMs);
      assert.ok(finite(fp.scene), cls);
      assert.ok(drawCallsOf(fp.scene) <= 8, `${drawCallsOf(fp.scene)}`);
    }
  }
  fp.update('rifle', selectAnimState({ ...base, alive: false }), 10_000);
  assert.equal(fp.scene.visible, false);
});

test('map lighting: a preset for each of the 11 maps; applying it sets shadow camera and fog', () => {
  const maps = ['abyss', 'ascent', 'bind', 'breeze', 'fracture', 'haven', 'icebox', 'lotus', 'pearl', 'split', 'sunset'];
  for (const m of maps) assert.ok(MAP_LIGHTING[m], m);
  assert.equal(lightingFor('Unknown'), MAP_LIGHTING.ascent);
  const root = new THREE.Mesh(new THREE.BoxGeometry(100, 10, 120)); root.updateMatrixWorld(true);
  const scene = new THREE.Scene(), hemi = new THREE.HemisphereLight(), sun = new THREE.DirectionalLight();
  const clear = applyMapLighting({ hemi, sun, scene }, root, 'sunset', 1024);
  assert.equal(clear, MAP_LIGHTING.sunset!.clear);
  assert.ok(scene.fog && sun.castShadow && sun.shadow.camera.right >= 60 && sun.position.y > 0);
});

test('gaze is separate from heading: yaw/pitch from the track, fallback to the heading, strafe and slice', () => {
  const none = selectAnimState({ ...base, moving: true, moveMode: 'walk', headingRad: 0.3 });
  assert.equal(none.aimYawRel, 0); assert.equal(none.strafe, 0); assert.equal(none.slice, false);
  const look = selectAnimState({ ...base, headingRad: 0, aimYawRad: 0.8, aimPitchRad: 0.2 });
  assert.ok(Math.abs(look.aimYawRel - 0.8) < 1e-9 && Math.abs(look.aimPitch - 0.2) < 1e-9);
  assert.ok(Math.abs(selectAnimState({ ...base, headingRad: 3, aimYawRad: -3 }).aimYawRel - (2 * Math.PI - 6)) < 1e-9, 'wraps across ±π');
  const sl = selectAnimState({ ...base, speedUUps: 330, headingRad: 0, travelRad: 0, aimYawRad: Math.PI / 2 }); // walking forward, looking left
  assert.equal(sl.slice, true); assert.ok(Math.abs(sl.strafe) > 0.9);
  assert.equal(selectAnimState({ ...base, speedUUps: 680, travelRad: 0, headingRad: 0, aimYawRad: Math.PI / 2 }).slice, false, 'running is not slicing');
  assert.equal(selectAnimState({ ...base, speedUUps: 330, travelRad: 0, headingRad: 0, aimYawRad: 0.1 }).slice, false);
});

test('gaze poses: head/torso turn with the aim, feet turn past the neck limit, no NaN', () => {
  const op = buildOperator('duelist', 0x3fd0ff); setOperatorWeapon(op, 'rifle', 0x3fd0ff);
  const at = (yaw: number) => { poseOperator(op, selectAnimState({ ...base, headingRad: 0, aimYawRad: yaw, aimPitchRad: 0.3, speedUUps: 330, travelRad: 0 }), 10_000, 0); op.skeleton.update(); return { head: op.head.rotation.y, spine: op.spine.rotation.y, root: op.root.rotation.y }; };
  const a = at(0), b = at(0.8), c = at(2.4);
  assert.ok(b.spine < a.spine && b.head < a.head, 'left look turns torso and head (scene yaw is opposite)');
  assert.ok(Math.abs(a.root) < 1e-9); assert.ok(Math.abs(b.root) < 1e-9); assert.ok(c.root < -0.8, 'feet turn for a look behind');
  for (const y of [-3, -1.2, 0, 1.2, 3]) { at(y); assert.ok(finite(op.root)); }
});
