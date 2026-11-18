# @pv/game-data

Single **typed runtime loader** for PROJECT V game data, consumed by the Match
Runner (PV-3) and the desktop app (PV-6). One import point, one identifier
convention.

```ts
import { getAgent, getWeapon, getAbilityEffects, getTeam, getPlayer,
         listTeams, listSimulatableTeams, getAscentTactics } from "@pv/game-data";

getWeapon("vandal");            // { cost: 2900, ... , provenance }
getAgent("kayo");               // normalizes -> kay-o
getAbilityEffects("sova");      // 4 ability effect specs
getTeam("2059");                // Team Vitality + recent roster
getPlayer("...");               // handle, attributes, hasRatings flag
listSimulatableTeams();         // teams with a >=5 recent roster (ready to sim)
```

## Data bundle (`data/`)
Regenerate with the Python builder:
```bash
python tools/catalog-builder/build_game_data.py --db /tmp/vct.duckdb --pv2-ref origin/claude/pv-data
node --experimental-strip-types --test packages/game-data/test/*.test.ts
```
- **Committed:** agents, ability-effects (120), ascent-comps, ascent-tactics,
  patch-meta (PV-1); players (1,227, handles + ratings), teams, rosters (recent
  >=2025, >=5 players) from VCT Reference (PV-2 / DB).
- **Gitignored:** `weapons.generated.json` — valorant-api licence is unclear, so
  weapons are generated at build; the loader falls back to an embedded
  **manual-approx** price table when the file is absent.

## Identifiers
Agent slugs are normalized to PV-3's convention (`kayo`/`kay/o` → `kay-o`). Team
and player ids are the VCT Reference numeric strings.

## Names / licence
Real pro player handles and team names are included by the **user decision
(2026-11-18)** for pre-launch internal dev (PUBLIC VCT only). Ratings are
statistical **estimates**, not ability assessments. Name/likeness and trademark
MUST be re-reviewed before any launch (see `docs/LICENSE_AUDIT.md` §0). Each
player carries `hasRatings`; consumers use league defaults when it is false
(never fabricate attributes).

## Provenance / move note
Started on `claude/pv-research` because `claude/pv-integration` was not yet
pushed. When it is, this package + `tools/catalog-builder/build_game_data.py`
move onto it (`git pull --rebase` first) and the bundle regenerates from the
merged PV-2 paths instead of `--pv2-ref`.
