// i18n sanity: ko (default) and en must cover the same keys, and interpolation
// placeholders must match between languages so no {var} leaks in either.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ko } from '../src/renderer/i18n/ko.ts';
import { en } from '../src/renderer/i18n/en.ts';

const vars = (s: string) => new Set((s.match(/\{(\w+)\}/g) ?? []).sort());

test('ko and en define exactly the same keys', () => {
  const kk = Object.keys(ko).sort();
  const ek = Object.keys(en).sort();
  const missingEn = kk.filter((k) => !(k in en));
  const missingKo = ek.filter((k) => !(k in ko));
  assert.deepEqual(missingEn, [], `keys missing from en: ${missingEn.join(', ')}`);
  assert.deepEqual(missingKo, [], `keys missing from ko: ${missingKo.join(', ')}`);
});

test('every key uses the same interpolation placeholders in both languages', () => {
  for (const k of Object.keys(ko)) {
    assert.deepEqual([...vars(ko[k])], [...vars(en[k])], `placeholder mismatch for ${k}`);
  }
});

test('core screen keys exist and are non-empty in ko', () => {
  for (const k of ['nav.match-day', 'md.run', 'rev.mvp', 'dbg.selected', 'about.language', 'strategy.A_EXECUTE', 'buy.force']) {
    assert.ok(ko[k] && ko[k].length > 0, `ko missing ${k}`);
  }
});
