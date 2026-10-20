#!/usr/bin/env python3
"""One-off: pull the GSHHS full-resolution coastline around Singapore out of the basemap-data-hires wheel
(unzipped path given as argv[1]) and store it as geo/coast.json (lon/lat rings). Public-domain-ish GSHHG data."""
import json, sys, numpy as np
base = sys.argv[1]
BB = (103.30, 104.30, 1.10, 1.62)          # lon0, lon1, lat0, lat1 (a little wider than the canvas)
rows = [l.split() for l in open(base + '/gshhsmeta_f.dat')]
fd = open(base + '/gshhs_f.dat', 'rb')
rings, big = [], None
for s in rows:
    typ, area, npts = int(s[0]), float(s[1]), int(s[2])
    south, north = float(s[3]), float(s[4]); off, nb = int(s[5]), int(s[6])
    if typ != 1 or north < BB[2] or south > BB[3]: continue
    fd.seek(off); a = np.frombuffer(fd.read(nb), dtype='<f4').reshape(-1, 2)
    lon, lat = a[:, 0], a[:, 1]
    if lon.max() < BB[0] or lon.min() > BB[1]: continue
    if npts > 1_000_000:                   # the Eurasian mainland: keep only the stretch inside the box
        inside = (lon > BB[0] - .3) & (lon < BB[1] + .3) & (lat > BB[2] - .3) & (lat < BB[3] + .3)
        idx = np.where(inside)[0]
        runs = np.split(idx, np.where(np.diff(idx) > 1)[0] + 1)
        runs = [r for r in runs if len(r) > 200]
        for r in runs:
            pts = a[r]
            rings.append(dict(name='mainland-run', area=area, pts=[[round(float(x), 5), round(float(y), 5)] for x, y in pts], open=True))
        continue
    if area < 0.25 or area > 100000: continue
    rings.append(dict(name='island', area=area, pts=[[round(float(x), 5), round(float(y), 5)] for x, y in a], open=False))
json.dump(rings, open('geo/coast.json', 'w'), separators=(',', ':'))
for r in rings:
    p = np.array(r['pts']); print(r['name'], round(r['area'], 1), len(p), 'lon %.3f..%.3f lat %.3f..%.3f' % (p[:, 0].min(), p[:, 0].max(), p[:, 1].min(), p[:, 1].max()), 'open' if r['open'] else '')
