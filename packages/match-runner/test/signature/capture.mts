// Re-record the match signatures (see cases.ts). Run only when behaviour is MEANT to change.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SIGNATURE_CASES, signatureOf } from "./cases.ts";

const out: Record<string, unknown> = {};
for (const c of SIGNATURE_CASES) {
  const t0 = Date.now();
  out[c.id] = signatureOf(c);
  console.error(`${c.id.padEnd(22)} ${JSON.stringify(out[c.id])} ${Date.now() - t0}ms`);
}
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), "signatures.json"), JSON.stringify(out, null, 2) + "\n");
