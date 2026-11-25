// Pure logic of the tactics screen (src/renderer/tactics/plan.ts) and its strings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IPC } from '../src/shared/ipc.ts';
import type { MatchPlan, TacticsMapView } from '../src/shared/manager.ts';
import {
  EMPTY_STORE, ROLES, SPOT_KINDS, flagState, midOf, plantChoiceOf, postPlantOf, project, readStore, recordedOnly, retakeOf, saveModeOf,
  setMid, setParts, setPlantChoice, setPostPlant, setRetake, siteBox, spotKeyOf, spotLabel, tacticsOnly, withTeamPlan,
} from '../src/renderer/tactics/plan.ts';
import { planForEngine } from '../src/renderer/matchday/manager.ts';
import { ko } from '../src/renderer/i18n/ko.ts';
import { en } from '../src/renderer/i18n/en.ts';
// Type check only: the desktop mirror must accept what the engine's own types describe.
import type { PostPlantPlan as EnginePostPlant, RetakePlan as EngineRetake } from '../../../packages/shared-types/src/plant-plans.ts';
import type { MidSidePlan as EngineMid } from '../../../packages/shared-types/src/mid-plans.ts';

test('the tactics-map channel is part of the IPC contract', () => {
  assert.equal(IPC.tacticsMap, 'pv:tactics:map');
});

test('edits keep the plan minimal: "auto" and empty parts are dropped', () => {
  let p: MatchPlan = {};
  p = setPlantChoice(p, 'A', 'safe');
  assert.deepEqual(p.plantPreference, { A: 'safe' });
  p = setPlantChoice(p, 'A', 'auto');
  assert.equal(p.plantPreference, undefined, 'auto removes the site, and the empty part with it');
  p = setPostPlant(p, 'B', 'safe', { hold: 'offSpike', flankWatch: true });
  p = setPostPlant(p, 'B', 'safe', { flankWatch: 'auto' });
  assert.deepEqual(p.postPlantPlans, { B: { safe: { hold: 'offSpike' } } });
  p = setRetake(p, 'A', '*', { approach: 'split', save: { maxManDeficit: 1 } });
  p = setRetake(p, 'A', '*', { entry: 'a-main' });
  assert.deepEqual(retakeOf(p, 'A', '*'), { approach: 'split', save: { maxManDeficit: 1 }, entry: 'a-main' });
  assert.equal(saveModeOf(retakeOf(p, 'A', '*')), 'custom');
  p = setRetake(p, 'A', '*', { entry: undefined });
  assert.equal(retakeOf(p, 'A', '*').entry, undefined);
  p = setMid(p, '*', 'attack', { stance: 'contest', count: 2, who: { roles: ['entry'] } });
  p = setMid(p, '*', 'defense', { stance: 'auto' });
  assert.deepEqual(p.midPlans, { '*': { attack: { stance: 'contest', count: 2, who: { roles: ['entry'] } } } });
  assert.deepEqual(midOf(p, 'Ascent', 'attack'), {}, 'a map without its own entry reads empty (the engine falls back to "*")');
  assert.deepEqual(setParts(p), ['postPlantPlans', 'retakePlans', 'midPlans']);
});

test('a post-plant plan is written under the key the plant choice names', () => {
  assert.equal(spotKeyOf('auto'), '*');
  assert.equal(spotKeyOf('cover'), 'cover');
  assert.equal(spotKeyOf({ spotId: 'a-site/plant/cover-a-heaven' }), 'a-site/plant/cover-a-heaven');
  const p = setPlantChoice({}, 'A', { spotId: 'a-site/plant/cover-a-heaven' });
  assert.deepEqual(plantChoiceOf(p, 'A'), { spotId: 'a-site/plant/cover-a-heaven' });
  assert.equal(spotLabel('a-site/plant/cover-a-heaven'), 'cover · a-heaven');
  assert.equal(spotLabel('b-site/plant/safe'), 'safe');
  assert.deepEqual(postPlantOf(p, 'A', '*'), {});
});

test('which parts are played: plant parts need plantTactics, mid needs midControl (both off by default)', () => {
  const p: MatchPlan = { plantPreference: { A: 'safe' }, midPlans: { '*': { defense: { stance: 'giveUp' } } } };
  assert.deepEqual(recordedOnly(p, {}), ['plantPreference', 'midPlans']);
  assert.deepEqual(recordedOnly(p, { plantTactics: true }), ['midPlans']);
  assert.deepEqual(recordedOnly(p, { plantTactics: true, midControl: true }), []);
  assert.equal(flagState('retakePlans', {}), 'off');
  assert.equal(flagState('midPlans', { midControl: true }), 'on');
});

test('the tactics travel with the match plan to the engine', () => {
  const p: MatchPlan = { tempo: 'normal', retakePlans: { A: { '*': { approach: 'stack' } } } };
  assert.deepEqual(planForEngine(p), { retakePlans: { A: { '*': { approach: 'stack' } } } });
  assert.deepEqual(tacticsOnly({ tempo: 'fast', plantPreference: { A: 'near' } } as MatchPlan), { plantPreference: { A: 'near' } });
});

test('a plan per team: saved, replaced, removed when emptied; malformed saves read as empty', () => {
  let s = withTeamPlan(EMPTY_STORE, 't1', { tempo: 'fast', plantPreference: { A: 'safe' } } as MatchPlan);
  assert.deepEqual(s.plans, { t1: { plantPreference: { A: 'safe' } } }, 'only the tactics part is stored');
  s = withTeamPlan(s, 't2', { midPlans: { '*': { attack: { stance: 'contest' } } } });
  s = withTeamPlan(s, 't1', {});
  assert.deepEqual(Object.keys(s.plans), ['t2']);
  assert.deepEqual(readStore(null), EMPTY_STORE);
  assert.deepEqual(readStore({ plans: 3 }), { plans: {}, flags: {} });
  assert.deepEqual(readStore(JSON.parse(JSON.stringify(s))), s);
});

test('minimap projection matches the live view and a site box frames its spots', () => {
  const p = project(1000, 2000); // MatchStage: u = y·xMul + xAdd, v = x·yMul + yAdd
  assert.ok(Math.abs(p.u - (2000 * 0.00007 + 0.813895)) < 1e-9);
  assert.ok(Math.abs(p.v - (1000 * -0.00007 + 0.573242)) < 1e-9);
  const site = { site: 'A', zone: 'a-site', retakeEntries: [], attackEntries: [], candidates: [
    { id: 'x', kind: 'safe', zone: 'a-site', x: 0, y: 0, exposure: 0, guardSight: 0 },
    { id: 'y', kind: 'open', zone: 'a-site', x: 1000, y: 500, exposure: 0, guardSight: 0 },
  ] } as TacticsMapView['sites'][number];
  const b = siteBox(site);
  for (const c of site.candidates) {
    const q = project(c.x, c.y);
    assert.ok(q.u > b.u0 && q.u < b.u1 && q.v > b.v0 && q.v < b.v1);
  }
  assert.ok(Math.abs((b.u1 - b.u0) - (b.v1 - b.v0)) < 1e-9, 'square');
});

test('the desktop mirror of the plan types fits the engine types', () => {
  const pp: EnginePostPlant = { hold: 'onSpike', flankWatch: 'auto', utility: 'savePostPlant', outnumbered: 'retreat' };
  const rt: EngineRetake = { entry: 'a-main', approach: 'split', save: { maxManDeficit: 1, minSpareMs: 2000 } };
  const mid: EngineMid = { stance: 'contest', count: 2, who: { players: ['1'] } };
  const p: MatchPlan = { postPlantPlans: { A: { '*': pp } }, retakePlans: { A: { '*': rt } }, midPlans: { '*': { attack: mid } } };
  assert.deepEqual(setParts(p), ['postPlantPlans', 'retakePlans', 'midPlans']);
});

test('every tactics-screen string exists in both languages', () => {
  const src = ['src/renderer/screens/tactics/TacticsPlanner.tsx', 'src/renderer/screens/TacticsScreen.tsx', 'src/renderer/screens/matchday/PrematchPanel.tsx']
    .map((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).join('\n');
  const literal = [...src.matchAll(/t\('((?:tp|md\.opts)\.[\w.]+)'/g)].map((m) => m[1]!);
  const dynamic = [
    ...SPOT_KINDS.map((k) => `tp.kind.${k}`), ...[...SPOT_KINDS, 'auto', 'picked'].map((k) => `tp.kind.${k}.hint`),
    ...ROLES.map((r) => `tp.role.${r}`), ...['plantPreference', 'postPlantPlans', 'retakePlans', 'midPlans'].map((f) => `tp.part.${f}`),
  ];
  const keys = [...new Set([...literal, ...dynamic])];
  assert.ok(keys.length > 60, `only ${keys.length} keys found`);
  for (const k of keys) { assert.ok(ko[k], `ko missing ${k}`); assert.ok(en[k], `en missing ${k}`); }
});
