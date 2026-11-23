// Unit tests run app source under `node --experimental-strip-types`. The renderer imports JSON the
// bundler way (`import data from './x.json'`), which Node rejects without `with { type: 'json' }`.
// This hook supplies that attribute for .json modules, so tests can import renderer modules unchanged.
// Used via `node --import ./test/support/json-imports.mjs` (see package.json test:unit).
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`
export async function load(url, context, nextLoad) {
  if (url.endsWith('.json') && context.importAttributes?.type !== 'json') {
    return nextLoad(url, { ...context, importAttributes: { ...context.importAttributes, type: 'json' } });
  }
  return nextLoad(url, context);
}
`));
