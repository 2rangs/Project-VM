# PROJECT V — Ultimate orb locations, all maps (research)

> Research only; docs only. Written 2026-11-25 from `origin/main` 85eadc8. Input for maps-data's `objects.json` `ultOrbs` points.
> Zone ids checked against each `datasets/spatial/<map>/<map>.navgraph.json` (zone ids are the lower-cased, hyphenated callout names).
> **Everything here is `verified:false` until someone checks it in-game.** No source gave exact coordinates in prose.

## 0. Summary

- **Count:** 2 orbs per map (one per site side) on every map except **Fracture = 4**. **Haven's two are A and C** (B has none). **Lotus is 2 today** (A Main, C Mound); pre-8.0 guides still say 3.
- **Method of the sources:** the VALORANT wiki's `Map:<name>` pages give each orb as a marker on a 0–1024 grid (Corrode 2048) plus the nearest callouts with distances in grid units; they carry no prose. Guides add side/orientation. The wiki distances were computed by a fetch tool, not stated on the pages; treat them as indicative.
- **Wiki grid → our coordinates:** the wiki grid is the minimap image grid. maps-data's own `coordinate-system.json` (valorant-api multipliers) is the right way to convert it to world units. The marker coordinates are listed below so maps-data can do that and then snap to the nearest roadmap node; I did not convert them.
- **Disagreements that matter for placement:** Bind B (wiki: B Garden; guides: B Long), Fracture's fourth orb (wiki: B Main; guides: B Tree), Haven (inside vs outside the longs), Icebox B (older: outside B Garage; wiki: B Green), Lotus (3 vs 2).
- Of the four maps maps-data already filled (Ascent, Bind, Haven, Split): **Ascent, Haven and Split match**; **Bind's B orb differs in zone** (§2.3).

## 1. Zone mapping table

"Wiki nearest" = nearest callouts by marker distance (grid units). Confidence: **H** wiki marker and guides agree, **M** wiki marker only or minor disagreement, **L** sources disagree.

| Map | Orb | Wiki marker (x, y) | Wiki nearest callouts | Our zone id | Conf. |
|---|---|---|---|---|---|
| Abyss | A | not given | A Main (~77), A Tower, A Lobby; map page text: between A Main and A Lobby | `a-main` | M |
| Abyss | B | not given | B Main (~67), B Nest | `b-main` | M |
| Ascent | A | (495.6, 751.8) | A Main (~61), Mid Cubby (~75), A Tree (~97) | `a-main` | M |
| Ascent | B | (388.5, 257.0) | B Main (~38) | `b-main` | H |
| Bind | A | (859.8, 536.7) | A Bath (~51), A Lobby (~160) | `a-bath` | H |
| Bind | B | (196.8, 588.8) | **wiki:** B Garden (~53), B Long (~96); **guides:** end of B Long near the teleporter | `b-garden` (wiki) or `b-long` (guides) | **L** |
| Breeze | A | (786.7, 390.0) | A Shop (~49), Mid Hall (~145) | `a-shop` | H |
| Breeze | B | (144.6, 538.1) | B Main (~29) | `b-main` | H |
| Fracture | NE | (732.6, 695.8) | A Dish (~58) | `a-dish` | M |
| Fracture | SE | (779.9, 219.2) | A Hall (~48) | `a-hall` | H |
| Fracture | NW | (291.3, 674.8) | B Arcade (~53) | `b-arcade` | H |
| Fracture | SW | (185.3, 252.4) | wiki: B Main (~69); guides: B Tree | `b-main` (wiki) or `b-tree` (guides) | **L** |
| Haven | A | (573.5, 886.0) | A Long (~48), A Tower (~257) | `a-long` | H |
| Haven | C | (718, 159) | C Long (~18, "Dragon"), C Cubby (~111), C Lobby (~123) | `c-long` | H |
| Icebox | A | (599.5, 178.5) | A Pipes (~49), A Nest (~65), A Belt (~160) | `a-pipes` | M |
| Icebox | B | (431, 676.5) | B Green (~30), B Garage (~102), B Cubby (~114) | `b-green` | M |
| Lotus | A | (801.9, 520.4) | A Main (~40) | `a-main` | M |
| Lotus | C | (241.8, 357.1) | C Mound (~42) | `c-mound` | H |
| Pearl | A | (932.0, 466.5) | A Main (~43) | `a-main` | H |
| Pearl | B | (91.3, 293.0) | B Ramp (~12), between B Main and B Club | `b-ramp` | M |
| Split | A | (503.8, 802.7) | A Main (~8), A Ramps / Rafters / Lobby (146–174) | `a-main` | H |
| Split | B | (554.5, 89.2) | B Garage (~40) | `b-garage` | M |
| Sunset | A | (811.8, 535.5) | A Main (~46), A Elbow (~158), A Lobby (~166) | `a-main` | H |
| Sunset | B | (190.2, 349.3) | B Main (~53), B Lobby (~193), B Market (~222) | `b-main` | H |
| Corrode (bonus, not in our maps) | A / B | (1255.5, 1651.8) / (1082, 612) on a 2048 grid | A Main (~87) / B Main (~168, far from any callout) | — | — |

Every zone id above exists in the map's navgraph (checked against the zone lists on 2026-11-25).
No orb sits in a zone our vocabulary lacks, so nothing needs a new zone.

## 2. Per-map notes, disagreements and sources

### 2.1 Abyss — 2 orbs
Count agrees: [wiki Abyss](https://wiki.playvalorant.com/en-us/Abyss), [Map:Abyss](https://wiki.playvalorant.com/en-us/Map:Abyss).
The A orb is described as between A Main and A Lobby (nearest A Main); the B orb at B Main with B Nest nearby. Both are some distance from their callout, so the zone is approximate.
Pool: Abyss returned to Competitive in patch 11.04 and left in 12.05 ([Riot 11.04](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-11-04/), [esports.gg 12.05](https://esports.gg/news/valorant/updates-lotus-patch-notes-12-05/)). Our zone list includes `a-tower`, `a-lobby`, `b-nest`, so the neighbours are available if maps-data prefers a closer snap.

### 2.2 Ascent — 2 orbs
[Map:Ascent](https://wiki.playvalorant.com/en-us/Map:Ascent): A orb at the A Main / Mid Cubby end of the A side; B orb at B Main.
Patch 4.04 (Mar 2022): the B orb became reachable from the lower box (before, a double jump onto the upper box was needed) ([Riot 4.04](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-4-04), [wiki Ascent](https://wiki.playvalorant.com/en-us/Ascent), [dbltap](https://www.dbltap.com/posts/valorant-march-1-patch-4-04-full-notes-detailed-01fx2jp6m806)).
Minor disagreement: one video-list snippet says the orbs are "at A and B site"; the wiki's callout placement is more specific.
**maps-data's current orbs (`a-main`, `b-main`) are consistent with this.**

### 2.3 Bind — 2 orbs
A orb in the showers (A Bath), all sources agree ([Map:Bind](https://wiki.playvalorant.com/en-us/Map:Bind), Sportskeeda maps snippet).
**B orb: disagreement.** The wiki marker (196.8, 588.8) is nearest **B Garden** (~53) with **B Long** second (~96). Guide snippets (THESPIKE, Mobalytics) say the far end / top of B Long, "in front of the B teleporter". Both wordings describe the same corner of the map; the callout name differs. maps-data currently uses `b-long`. Resolve by converting the wiki marker with `coordinate-system.json` and snapping to the nearer roadmap node; if the node is in `b-garden`, switch the zone; otherwise keep `b-long`.

### 2.4 Breeze — 2 orbs
A at A Shop, B at B Main ([Map:Breeze](https://wiki.playvalorant.com/en-us/Map:Breeze); Mobalytics maps overview snippet agrees).

### 2.5 Fracture — 4 orbs (the only four-orb map)
One per quadrant: A Dish, A Hall, B Arcade, B Main (wiki) ([wiki Fracture](https://wiki.playvalorant.com/en-us/Fracture), [Map:Fracture](https://wiki.playvalorant.com/en-us/Map:Fracture)).
**Disagreement:** guide snippets list A Hall, A Dish, **B Tree** and B Arcade, so the fourth is B Main (wiki) vs B Tree (guides). Both zones exist (`b-main`, `b-tree`); check the wiki marker (185.3, 252.4) against both anchors.
Patch 3.09: the A Hall orb was moved into more neutral ground (less attacker-favoured); the same patch moved a B Arcade barrier. Release date not confirmed ([Dot Esports](https://dotesports.com/valorant/news/fracture-gets-some-adjustments-in-valorants-patch-3-09), [Sportskeeda 3.09](https://www.sportskeeda.com/valorant/valorant-patch-3-09-official-notes-bring-episode-3-act-3-along-massive-changes-classic-fracture), wiki Fracture).
Fracture re-entered Competitive in 12.05.

### 2.6 Haven — 2 orbs (A and C; none at B)
A orb at A Long, C orb at C Long ("Dragon") ([wiki Haven](https://wiki.playvalorant.com/en-us/Haven), [Map:Haven](https://wiki.playvalorant.com/en-us/Map:Haven)).
Placement disagreement: some guides say outside each long, others inside A Long; the A Long orb is described as defender-favoured because of the long sightline (Mobalytics overview, gamersdecide; snippets). Both anchor zones match maps-data's current points. **maps-data's `a-long`, `c-long` agree.**

### 2.7 Icebox — 2 orbs
A at A Pipes (A Nest and Belt close); B at B Green ([Map:Icebox](https://wiki.playvalorant.com/en-us/Map:Icebox)). One guide says attackers walk the ground floor to the A orb then go up through Nest to the zipline (single weak source) ([theglobalgaming](https://theglobalgaming.com/valorant/map-guide-icebox-callouts)).
Disagreement: older sources place the B orb "outside B Garage"; the wiki says B Green (Garage ~102 away). Both zones exist (`b-green`, `b-garage`). Icebox left the Competitive pool in 11.04.

### 2.8 Lotus — 2 orbs now
Today's layout has **A Main and C Mound** ([wiki Lotus](https://wiki.playvalorant.com/en-us/Lotus), [Map:Lotus](https://wiki.playvalorant.com/en-us/Map:Lotus)).
**Disagreement:** THESPIKE and Mobalytics say three (A Main, B Main, C Mound). That is the pre-8.0 layout: patch 8.0 (9 Jan 2024) removed the B orb because it was very farmable for attackers ([wiki patch 8.0](https://wiki.playvalorant.com/en-us/Patch_Notes/8.0), [Pracc](https://blog.pracc.com/valorant-patch-notes-8-0/)). A Liquipedia snippet places the original third orb in mid, contradicting "B Main" (unconfirmed; page returned 403).
Patch 12.05 (17 Mar 2026) reworked parts of the A side (walls, an extra room outside the A stairs, a plant-zone change) when Lotus rejoined Competitive; I saw no orb change, but the wiki marker for the A orb may predate that rework ([esports.gg](https://esports.gg/news/valorant/updates-lotus-patch-notes-12-05/), [Riot 12.05](https://playvalorant.com/en-gb/news/game-updates/valorant-patch-notes-12-05/)). Which map version our navgraph matches is `patchVersion: UNVERIFIED`.

### 2.9 Pearl — 2 orbs
B at the B Ramp (between B Main and B Club); A at A Main ([Map:Pearl](https://wiki.playvalorant.com/en-us/Map:Pearl), [Mobalytics Pearl](https://mobalytics.gg/blog/valorant/valorant-pearl-map-guide/)). Guides call both somewhat attacker-favoured; holding A Main gives control of the A orb.
Caveat from maps-data: Pearl is the weakest-data map (B Club / Mid Shops share one x,y on different floors; four zones off the main component, `MAPS_DATA.md`). Prefer the nearest reachable roadmap node.
Pearl returned to Competitive in 11.08. Its wiki update history never mentions orbs.

### 2.10 Split — 2 orbs
A at A Main (essentially on it), B at B Garage ([Map:Split](https://wiki.playvalorant.com/en-us/Map:Split)).
Patch 0.47 (beta): an orb moved from B Mid to B Main (ESPN snippet; the Split wiki mentions the move without saying "ultimate orb"). Today's wiki marker is nearest **B Garage**, so the B Main part of that history seems to have changed again or the zone naming differs; **maps-data's `b-garage` agrees with the current wiki marker.**
Split rejoined Competitive in 11.08. Our map also has `b-main`-like zones (`b-alley`, `b-stairs`, `b-back`), none called `b-main`, so the old "B Main" wording does not map to a zone.

### 2.11 Sunset — 2 orbs
A at A Main, B at B Main ([Map:Sunset](https://wiki.playvalorant.com/en-us/Map:Sunset)). Sportskeeda describes the B Main orb as sitting in a corner in front of the defender-side barrier (defender-favoured) ([Sunset callouts](https://www.sportskeeda.com/valorant/valorant-callouts-know-sunset), snippet).
Weak disagreement: a bo3.gg snippet mentions an orb near the A plant behind a wall and a third in a central passage; no other source supports it, so it is probably wrong ([bo3.gg](https://bo3.gg/valorant/articles/best-spots-on-the-sunset-map-in-valorant-for-the-defense-side)).

### 2.12 Corrode (bonus)
Two orbs: A near A Main (~87 on a 2048 grid), B near B Main (~168, far from any named callout) ([Map:Corrode](https://wiki.playvalorant.com/en-us/Map:Corrode)). No guide prose. Corrode is not in our map set.

### 2.13 Cross-cutting
- Patch 11.09 (28 Oct 2025) changed the orb highlight colour to the standard green; cosmetic ([Riot 11.09](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-11-09/)).
- No 2025–2026 patch note adds, moves or removes an orb. Orb positions are fixed actors: they are absent from the static scene (as maps-data already noted), so they cannot be extracted from the mesh.

## 3. What to do with this (for maps-data)

1. Add / confirm `ultOrbs` with `verified:false` and a provenance note "wiki Map: page marker, converted"; use the zone ids in §1; for the three **L** rows (Bind B, Fracture SW) record both candidate zones and choose by snapping the converted marker to the nearest roadmap node.
2. Lotus: 2 orbs (A Main, C Mound); do **not** add a B orb.
3. Fracture: 4 orbs.
4. To upgrade `verified`: the wiki images named like "Abyss Ult Orb A" / "Bind Ult Orb B" (same pattern on Corrode, Split, Pearl, Breeze) were not downloaded; viewing them or an in-game check would give exact spots. Don't copy the wiki images into the repo (licence).
5. Engine use: `economy-engine` orb pickups are zone-level today (`ultimate-economy.ts`); one orb = +1 ult point (Siege.gg; see `PRO_TECHNIQUES.md` EC-05). Orb value in a plan should be the contested-pickup formula of backlog A21 (exposure cost vs the ult-point value), which needs only the zone id.

## 4. Source reliability

Opened: the VALORANT wiki `Map:<map>` pages and map pages (marker data), Riot patch notes 4.04, 8.0 (wiki), 11.04, 11.08, 11.09, 12.05, esports.gg and Dot Esports and Sportskeeda for 3.09/12.05.
Search-snippet only (page refused or unreadable): Mobalytics, THESPIKE, Liquipedia, Sportskeeda maps, theglobalgaming, gamersdecide, bo3.gg, ESPN. Fandom and Liquipedia returned 402/403/405. The wiki's marker coordinates and the callout distances come from a fetch tool reading the pages; spot-check at least one map by eye.
