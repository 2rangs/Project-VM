#!/usr/bin/env python3
"""
PROJECT V — callouts -> zones (shared by the geometry stage and the navgraph builder).

One rule for every map, following the Ascent dataset's conventions:
  id          lowercase-hyphen "<region letter or mid>-<callout>": "A"+"Site" -> a-site,
              "Mid"+"Top" -> mid-top, "Attacker Side"+"Spawn" -> attacker-spawn,
              "Defender Side"+"Arches" -> defender-arches.
  zoneType    by callout name (table below); a per-map authoring file may override it.
  plantable   exactly the "<letter> Site" callouts.
  transit     false for the two spawn zones (a route may start/end there, not cross it).

Stdlib only. No geometry needed.
"""
import re

# Callout name -> zone type. Anything not listed is decided by DEFAULT_TYPE below.
# This is a naming convention (manual-approx), not a measurement.
TYPE_BY_NAME = {
    "site": "site",
    "main": "main",
    "lobby": "lobby",
    "spawn": "spawn",
    "link": "link",
    "market": "link",          # Ascent precedent: mid-market is a "link"
    "connector": "link",
    # holding spots / elevated or tucked positions (Ascent precedent: tree, rafters, cubby)
    "tree": "position", "rafters": "position", "cubby": "position", "tower": "position",
    "nest": "position", "hut": "position", "screen": "position", "screens": "position",
    "back": "position", "pillar": "position", "pillars": "position", "dish": "position",
    "bench": "position", "generator": "position", "snowman": "position", "yellow": "position",
    "green": "position", "orange": "position", "blue": "position", "pallet": "position",
    "lamps": "position", "boba": "position", "danger": "position", "secret": "position",
    "wall": "position", "pyramids": "position", "dugout": "position", "flowers": "position",
    "snow-pile": "position", "fence": "position",
}
DEFAULT_TYPE = "connector"      # passages: halls, stairs, ramps, doors, tunnels, elbows ...


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def zone_id(super_region, region):
    sr = super_region.strip()
    if sr == "Attacker Side":
        return "attacker-" + slug(region)
    if sr == "Defender Side":
        return "defender-" + slug(region)
    return f"{slug(sr)}-{slug(region)}"


def zones_from_api(raw, overrides=None):
    """raw: one map object from valorant-api /v1/maps. Returns the zone list (positions in
    game uu exactly as returned; z is replaced later by the measured floor height where the
    mesh stage could snap the callout)."""
    overrides = overrides or {}
    zones = []
    seen = set()
    for c in raw["callouts"]:
        sr, rn = c["superRegionName"], c["regionName"]
        zid = zone_id(sr, rn)
        if zid in seen:
            raise ValueError(f"duplicate zone id {zid}")
        seen.add(zid)
        region_slug = slug(rn)
        if sr in ("Attacker Side", "Defender Side"):
            ztype = "spawn" if region_slug == "spawn" else TYPE_BY_NAME.get(region_slug, DEFAULT_TYPE)
        elif sr == "Mid" and region_slug not in TYPE_BY_NAME:
            ztype = DEFAULT_TYPE
        else:
            ztype = TYPE_BY_NAME.get(region_slug, DEFAULT_TYPE)
        if sr == "Mid" and region_slug in ("top", "bottom", "courtyard", "plaza"):
            ztype = "mid"
        ov = overrides.get(zid, {})
        ztype = ov.get("zoneType", ztype)
        loc = c["location"]
        z = {
            "id": zid,
            "name": f"{'Attacker' if sr == 'Attacker Side' else 'Defender' if sr == 'Defender Side' else sr} {rn}",
            "callout": f"{sr} {rn}",
            "superRegion": sr,
            "zoneType": ztype,
            "plantable": ztype == "site",
            "position": {"x": round(loc["x"], 1), "y": round(loc["y"], 1), "z": round(loc["z"], 1)},
        }
        if zid in ("attacker-spawn", "defender-spawn"):
            z["transit"] = False
        zones.append(z)
    # spawns first, then by super region / id — stable, human-friendly order
    order = {"Attacker Side": 0, "Defender Side": 1}
    zones.sort(key=lambda z: (0 if z["zoneType"] == "spawn" else 1,
                              order.get(z["superRegion"], 2), z["superRegion"], z["id"]))
    return zones


def site_letters(zones):
    return sorted(z["superRegion"] for z in zones if z["zoneType"] == "site")
