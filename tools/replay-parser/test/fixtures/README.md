# SYNTHETIC test fixtures — NOT real match data

Everything in this directory is **fabricated** to exercise the PV-6 replay
parser pipeline without a real `.vrf`. It is **not** a real VALORANT match and
must never be presented as one, used as training data, or copied into
`datasets/normalized/`.

| File | What it is |
|---|---|
| `make-fixture.mjs` | Generator for `decode-full.synthetic.txt`. Documents the exact line shape. |
| `decode-full.synthetic.txt` | ~22 lines mimicking `ValorantReplayParser --verbose --full` output: 2 players on 2 teams, 2 rounds (`ClientGamePhaseEnded OldPhase=2`), a `BombGameState` wall clock, and 5 movement samples across 2 actors. |
| `channels.synthetic.jsonl` | Mimics `channels.jsonl`: a few `ev:open` actor spawns, including ability actors (`Smoke_Production_Astra_C`, `Patch_Phoenix_MolotovFire_C`, `Wall_Fortifying_Sage_C`). |

The `ProfileName` values (`SynthPlayerA/B`) are fake and exist only to test the
privacy-redaction path.

To regenerate the decode fixture:

```bash
node tools/replay-parser/test/fixtures/make-fixture.mjs
```
