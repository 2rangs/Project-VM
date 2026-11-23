# Desktop data fixtures — copied from PV-1 / PV-2 (with sources)

Verbatim copies of other agents' derived datasets, used to drive the manager-game
UI. **Do not edit** — re-copy if upstream changes. All are **SYNTHETIC/ESTIMATED**
statistics from public match data, never ground-truth scouting.

| file | source branch | source path | used by |
|---|---|---|---|
| `player_names.json` | `origin/claude/pv-data` | `datasets/derived/ratings/player_names.json` | Squad, Player Profile, Match Day |
| `player_ratings.json` | `origin/claude/pv-data` | `datasets/derived/ratings/player_ratings.json` | Squad, Player Profile |
| `ratings_meta.json` | `origin/claude/pv-data` | `datasets/derived/ratings/ratings_meta.json` | Player Profile (method note) |
| `team_names.json` | `origin/claude/pv-data` | `datasets/derived/team-profiles/team_names.json` | Opponent Report |
| `team_profiles.json` | `origin/claude/pv-data` | `datasets/derived/team-profiles/team_profiles.json` | Opponent Report |
| `rosters.json` | this repo | `packages/game-data/data/rosters.json` | Scouting · career world (team rosters) |
| `reserved_handles.json` | this repo (derived) | normalised `handle` of every player in `packages/game-data/data/players.json` | Scouting · career world (generated handles never collide with these) |
| `ascent-tactics.json` | `origin/claude/pv-research` | `datasets/derived/tactics/ascent-tactics.json` | Tactics |
| `ascent-comps.json` | `origin/claude/pv-research` | `datasets/derived/comps/ascent-comps.json` | Agent Select |

Copied on 2026-11-18 by PV-6 (`git show origin/claude/<branch>:<path>`).

## Real names — user decision (2026-11-18)
Real VCT **professional** player handles and team names are shown by explicit user
decision, for pre-launch INTERNAL development only. Scope is PUBLIC VCT pros/teams
(no private individuals). The in-app About screen carries the disclaimer; name /
likeness / license rights MUST be re-reviewed before any launch. The `.vrf` sample
players are NOT pros and stay anonymous (`player_N`).
