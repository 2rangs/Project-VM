// The eased heading: turns over match time instead of snapping, and snaps on a cut.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HeadingSmoother, TURN_MAX_DEG_S, TURN_SNAP_GAP_MS } from '../../src/renderer/matchday/heading.ts';

const deg = (r: number) => (r * 180) / Math.PI;

test('heading: the first sample is the target', () => {
  const h = new HeadingSmoother();
  assert.equal(h.get('a', 1.2, 1000), 1.2);
});

test('heading: a 90° turn eases over several frames, never faster than the cap', () => {
  const h = new HeadingSmoother();
  h.get('a', 0, 0);
  let prev = 0; let steps = 0;
  for (let t = 1000 / 60; t < 600; t += 1000 / 60) {
    const r = h.get('a', Math.PI / 2, t);
    assert.ok(deg(r - prev) <= TURN_MAX_DEG_S / 60 + 1e-6, `step ${deg(r - prev).toFixed(2)}° within the cap`);
    if (Math.abs(r - Math.PI / 2) > 0.01) steps++;
    prev = r;
  }
  assert.ok(steps >= 5, 'the turn spans several frames');
  assert.ok(Math.abs(prev - Math.PI / 2) < 0.01, 'and arrives');
});

test('heading: turns the short way across ±180°', () => {
  const h = new HeadingSmoother();
  h.get('a', Math.PI - 0.1, 0);
  const r = h.get('a', -Math.PI + 0.1, 16);
  assert.ok(r > Math.PI - 0.1, 'moves up through 180°, not back through 0');
});

test('heading: a seek or a backward jump snaps', () => {
  const h = new HeadingSmoother();
  h.get('a', 0, 0);
  assert.equal(h.get('a', 2, TURN_SNAP_GAP_MS + 1), 2);
  assert.equal(h.get('a', -1, 10), -1);
});

test('heading: players are independent', () => {
  const h = new HeadingSmoother();
  h.get('a', 0, 0); h.get('b', 3, 0);
  assert.equal(h.get('b', 3, 16), 3);
});
