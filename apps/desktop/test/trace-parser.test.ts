// Decision-trace parser unit tests, run against the REAL PV-3 trace fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTrace, feasibleCount, predictionById } from '../src/shared/trace.ts';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const load = (id: string) => JSON.parse(fs.readFileSync(path.join(DIR, 'fixtures', 'traces', `${id}.json`), 'utf8'));

test('parses the real scenario-01 trace and exposes sections', () => {
  const t = parseTrace(load('trace-scenario-01'));
  assert.equal(t.mapId, 'ascent');
  assert.equal(t.provenance.synthetic, true);
  assert.ok(t.generated.length > 0);
  assert.equal(feasibleCount(t), t.generated.filter((g) => g.feasible).length);
  assert.ok(t.selected && t.selected.id.length > 0);
  // every prediction row has the computed numbers the UI shows
  for (const p of t.prediction) {
    assert.equal(typeof p.requiredTimeMs, 'number');
    assert.equal(typeof p.estimatedRisk, 'number');
    assert.equal(typeof p.expectedUtility, 'number');
  }
});

test('scenario-04 carries multiple exclusions with reasons (debugger core)', () => {
  const t = parseTrace(load('trace-scenario-04'));
  assert.ok(t.excluded.length >= 3, 'expected several excluded actions');
  for (const e of t.excluded) {
    assert.ok(e.explanation.length > 0, 'each exclusion has a human reason');
    assert.ok(Array.isArray(e.reasons));
  }
  // the selected action, if any, is one the predictions scored
  if (t.selected) assert.ok(predictionById(t, t.selected.id));
});

test('parseTrace rejects malformed input', () => {
  assert.throws(() => parseTrace(null), /object/);
  assert.throws(() => parseTrace({ contextId: 'x' }), /missing/);
  assert.throws(() => parseTrace({ contextId: 'x', mapId: 'ascent', world: {}, observed: {}, generated: [], excluded: [], prediction: [] }), /decidingSide|observed/);
});
