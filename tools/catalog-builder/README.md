# catalog-builder

Builds the PROJECT V game-data catalog (weapons / agents / abilities / equipment)
from [valorant-api.com](https://valorant-api.com). Python standard library only
(+ `jsonschema` for validation, `pytest` for tests).

## Run
```bash
python build_catalog.py                 # fetch live, normalize, validate
python build_catalog.py --offline       # rebuild from cached raw/ (no network)
python build_catalog.py --patch release-13.10
pytest -q                               # unit tests + schema validation
```

Output goes to `datasets/catalog/<patch>/` (gitignored — see that folder's README
for why data is regenerated rather than committed).

## Modules
| File | Role |
|---|---|
| `fetch.py` | network: pull API payloads, cache to `raw/` (stdlib urllib) |
| `normalize.py` | **pure** transforms: raw dict → catalog record (unit-tested) |
| `ability_facts.py` | sourced ability gameplay numerics (empty until sourced w/ URL) |
| `equipment_facts.py` | shield/spike constants (null + verified=false until sourced) |
| `validate.py` | jsonschema validation against `datasets/catalog/schema/` |
| `build_catalog.py` | orchestrates fetch → normalize → write → validate → report |
| `tests/` | pytest; fixtures are synthetic (fake names), not redistributed API data |

## What is and isn't filled
- **From valorant-api (verified):** weapon stats (cost, fire rate, magazine, reload/equip
  ms, run-speed mult, damage ranges per m, penetration, ADS), agent roles, ability
  names/slots/descriptions.
- **NOT in valorant-api → null + `verified:false`:** ability cost/charges/cooldown/
  ultPoints/duration/typeTags, default keybind, shield cost/armor, spike timing.
  Fill these only from official patch notes / wiki with a `gameplaySource` URL.
  Never hardcode an estimate (Handoff §29, README §37).
