#!/usr/bin/env python3
"""
PROJECT V — PV-5 Map Mesh
Fit the 2D transform from Blender world coords (metres) to PV-4 game coords
(Unreal uu, from valorant-api) using region/landmark correspondences, and
report residuals. Fits both a full affine (6-DOF) and a constrained similarity
(rotation + uniform scale + translation, reflection allowed) and compares them.

No Blender needed; pure numpy. Writes a transform JSON + prints residuals.

Usage: python3 -I tools/map-mesh/align/fit-transform.py --out <file.json>
"""
import json, argparse, numpy as np

# Blender world centroid (x_m, y_m) -> PV-4 game (x_uu, y_uu).
# Blender anchors from extract-collision stats + landmark-centroids;
# game anchors from PV-4 ascent.navgraph.json (valorant-api callouts).
ANCHORS = [
    # label,         blender(x,y),       game(x,y),          source
    # Blender anchors: area-weighted FLOOR centroids (floor-centroids.py) for the
    # spawn/mid regions, and specific site-geometry landmarks (landmark-centroids.py)
    # for the sites. Game anchors: PV-4 valorant-api callouts.
    ("atk-spawn",   (18.50, 9.30),      (60.0,    50.0),    "Ascent_Art_Atk floor centroid / attacker-spawn"),
    ("def-spawn",   (14.00, 97.80),     (1995.2, -9744.9),  "Ascent_Art_Def floor centroid / defender-spawn"),
    ("a-site",      (55.96, 66.38),     (6153.6, -6626.2),  "A-bombsite landmark / a-site"),
    ("b-site",      (-48.50, 75.60),    (-2344.1,-7548.5),  "BSite landmark / b-site"),
    ("mid",         (14.10, 52.30),     (1222.7, -4586.6),  "Ascent_Art_Mid floor centroid / mid-courtyard"),
]

def parse():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    return ap.parse_args()

def fit_affine(B, G):
    # G = B @ A^T + t ; solve [B|1] X = G  (X is 3x2)
    n = B.shape[0]
    M = np.hstack([B, np.ones((n,1))])      # n x 3
    X, *_ = np.linalg.lstsq(M, G, rcond=None)  # 3 x 2
    pred = M @ X
    resid = pred - G
    return X, pred, resid

def fit_similarity(B, G):
    # Umeyama similarity with reflection allowed (pick better of det signs).
    muB = B.mean(0); muG = G.mean(0)
    Bc = B - muB; Gc = G - muG
    Sigma = (Gc.T @ Bc) / B.shape[0]
    U, D, Vt = np.linalg.svd(Sigma)
    best = None
    for allow_ref in (False, True):
        S = np.eye(2)
        if not allow_ref and np.linalg.det(U @ Vt) < 0:
            S[1,1] = -1
        R = U @ S @ Vt
        varB = (Bc**2).sum() / B.shape[0]
        scale = np.trace(np.diag(D) @ S) / varB
        t = muG - scale * (R @ muB)
        pred = (scale * (B @ R.T)) + t
        resid = pred - G
        rms = np.sqrt((resid**2).sum(1).mean())
        if best is None or rms < best["rms"]:
            best = {"R":R, "scale":scale, "t":t, "pred":pred, "resid":resid,
                    "rms":rms, "reflection": bool(np.linalg.det(R) < 0)}
    return best

def main():
    args = parse()
    labels = [a[0] for a in ANCHORS]
    B = np.array([a[1] for a in ANCHORS], float)
    G = np.array([a[2] for a in ANCHORS], float)

    X, predA, residA = fit_affine(B, G)
    sim = fit_similarity(B, G)

    def stats(resid):
        d = np.sqrt((resid**2).sum(1))
        return {"perPointUU": {labels[i]: round(float(d[i]),1) for i in range(len(labels))},
                "rmsUU": round(float(np.sqrt((d**2).mean())),1),
                "maxUU": round(float(d.max()),1)}

    # affine matrix A (2x2) and translation
    A = X[:2,:].T    # 2x2 so that G = A @ B + t
    t = X[2,:]
    # decompose affine scale (singular values) to judge how close to similarity
    svA = np.linalg.svd(A, compute_values:=True) if False else np.linalg.svd(A)[1]

    out = {
      "note": "2D transform Blender-world(metres) -> PV-4 game(uu). Anchors are "
              "region/landmark centroids; they carry real spread so residuals are "
              "expected at the tens-of-metres level, not exact. Use the affine as "
              "the working Blender->game map; similarity confirms the frame "
              "relationship (scale/rotation/reflection).",
      "anchors": [{"label":a[0],"blender":list(a[1]),"game":list(a[2]),"source":a[3]} for a in ANCHORS],
      "affine": {
          "formula": "game_xy = A @ blender_xy + t",
          "A": [[round(float(A[0,0]),5), round(float(A[0,1]),5)],
                [round(float(A[1,0]),5), round(float(A[1,1]),5)]],
          "t": [round(float(t[0]),2), round(float(t[1]),2)],
          "singularValues_uu_per_m": [round(float(svA[0]),2), round(float(svA[1]),2)],
          "residuals": stats(residA),
      },
      "similarity": {
          "formula": "game_xy = scale * (R @ blender_xy) + t",
          "scale_uu_per_m": round(float(sim["scale"]),3),
          "R": [[round(float(sim["R"][0,0]),5), round(float(sim["R"][0,1]),5)],
                [round(float(sim["R"][1,0]),5), round(float(sim["R"][1,1]),5)]],
          "rotationDeg": round(float(np.degrees(np.arctan2(sim["R"][1,0], sim["R"][0,0]))),2),
          "reflection": sim["reflection"],
          "t": [round(float(sim["t"][0]),2), round(float(sim["t"][1]),2)],
          "residuals": stats(sim["resid"]),
      },
    }
    with open(args.out,"w") as f:
        json.dump(out, f, indent=2)
    print(json.dumps(out, indent=2))

if __name__ == "__main__":
    main()
