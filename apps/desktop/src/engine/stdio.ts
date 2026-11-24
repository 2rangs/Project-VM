// Line-delimited JSON over stdin/stdout for the tsx reference scripts (scripts/*.mts):
//   → {"id":1,"cmd":"state"}        ← {"id":1,"ok":true,"state":{...}}
// `stop` closes the stream; a throwing handler becomes {ok:false,error}. Diagnostics go to stderr.
import { createInterface } from 'node:readline';

export function serveLines(handle: (msg: Record<string, unknown>) => Record<string, unknown>): void {
  const reply = (obj: Record<string, unknown>) => { process.stdout.write(JSON.stringify(obj) + '\n'); };
  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) return;
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(text); } catch (e) { reply({ ok: false, error: `bad json: ${(e as Error).message}` }); return; }
    const id = msg.id;
    try {
      if (msg.cmd === 'stop') { reply({ id, ok: true }); rl.close(); return; }
      reply({ id, ok: true, ...handle(msg) });
    } catch (e) { reply({ id, ok: false, error: (e as Error).message }); }
  });
  rl.on('close', () => process.exit(0));
}
