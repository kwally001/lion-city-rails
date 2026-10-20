"""Turns the real coastline (geo/coast.json) into smooth, cartoon-friendly land shapes in map pixels.
All shapes go through the same lon/lat -> pixel pipeline as the stations, so they line up."""
import json, math
from shapely.geometry import Polygon, Point, box, MultiPolygon
from shapely.ops import unary_union

W, H = 1280, 800
EXTRAS = [(832, 633, 50, 20, -8, 7)]   # (cx, cy, rx, ry, rot, seed) in px

def catmull(coords, closed=True, t=0.5):
    """Catmull-Rom spline through coords -> SVG path data (cubic beziers)."""
    p = list(coords)
    if closed and p[0] == p[-1]: p = p[:-1]
    n = len(p)
    if n < 3: return ''
    f = lambda v: ('%.1f' % v).rstrip('0').rstrip('.')
    d = 'M%s %s' % (f(p[0][0]), f(p[0][1]))
    rng = range(n) if closed else range(n - 1)
    for i in rng:
        p0 = p[(i - 1) % n] if closed else p[max(i - 1, 0)]
        p1 = p[i]; p2 = p[(i + 1) % n]
        p3 = p[(i + 2) % n] if closed else p[min(i + 2, n - 1)]
        c1 = (p1[0] + (p2[0] - p0[0]) * t / 3, p1[1] + (p2[1] - p0[1]) * t / 3)
        c2 = (p2[0] - (p3[0] - p1[0]) * t / 3, p2[1] - (p3[1] - p1[1]) * t / 3)
        d += 'C%s %s %s %s %s %s' % (f(c1[0]), f(c1[1]), f(c2[0]), f(c2[1]), f(p2[0]), f(p2[1]))
    return d + ('Z' if closed else '')

def to_paths(geom, tol=1.1, minarea=40):
    out = []
    geoms = geom.geoms if hasattr(geom, 'geoms') else [geom]
    for g in geoms:
        if g.is_empty or g.area < minarea: continue
        g = g.simplify(tol)
        out.append(catmull(list(g.exterior.coords)))
    return out

def _push(poly, c, v, sigma=38.0):
    """Smoothly shove the part of a coastline near point c by vector v (gaussian falloff)."""
    def mv(coords):
        out = []
        for x, y in coords:
            g = math.exp(-((x - c[0]) ** 2 + (y - c[1]) ** 2) / (2 * sigma * sigma))
            out.append((x + v[0] * g, y + v[1] * g))
        return out
    return Polygon(mv(poly.exterior.coords)).buffer(0)

def _largest(g):
    return max(g.geoms, key=lambda q: q.area) if hasattr(g, 'geoms') else g

def _fit(poly, nodes_here, margin, label, log, sigma=40.0, rounds=8):
    """Push the coast outward until every listed station sits at least `margin` px inside."""
    from shapely.ops import nearest_points
    for it in range(rounds):
        worst = None
        for n in nodes_here:
            p = Point(n['x'], n['y'])
            inside = poly.contains(p)
            d = poly.exterior.distance(p)
            depth = d if inside else -d
            if depth < margin and (worst is None or depth < worst[0]):
                worst = (depth, n, p, inside)
        if worst is None: return poly
        depth, n, p, inside = worst
        c = nearest_points(poly.exterior, p)[0]
        c = (c.x, c.y)
        dx, dy = (c[0] - p.x, c[1] - p.y)
        L = math.hypot(dx, dy) or 1.0
        if not inside: dx, dy = -dx, -dy
        need = margin - depth + 2
        v = (dx / L * need, dy / L * need)
        poly = _push(poly, c, v, sigma)
    log('could not fully fit', label)
    return poly

def build(T, nodes, ext_ids=('jb', 'gel'), log=print):
    coast = json.load(open('geo/coast.json'))
    canvas = box(-60, -60, W + 60, H + 60)
    johor_parts, isl = [], []
    for r in coast:
        pts = [T(lon, lat) for lon, lat in r['pts']]
        if r['open']:
            pts = pts + [(pts[-1][0], -2500), (pts[0][0], -2500)]
            johor_parts.append(Polygon(pts).buffer(0))
        else:
            g = Polygon(pts).buffer(0)
            if not g.is_empty: isl.append(g)
    johor = _largest(unary_union(johor_parts))

    def probe(lon, lat):
        x, y = T(lon, lat); p = Point(x, y); best = None
        for g in isl:
            if g.contains(p) or g.distance(p) < 6:
                if best is None or g.area > best.area: best = g
        return best
    main = probe(103.82, 1.36)
    ubin = probe(103.96, 1.415)
    tekong = probe(104.05, 1.42)
    sentosa = probe(103.825, 1.2565)
    jpieces = [g for g in isl if g.area < 6000 and g.centroid.distance(Point(*T(103.71, 1.285))) < 45]
    jur = unary_union(jpieces).buffer(8).buffer(-6) if jpieces else None
    jur = _largest(jur) if jur is not None else None
    nid = {n['id']: n for n in nodes.values()}

    # 1. mainland: coast follows the stations
    main_nodes = [n for i, n in nid.items() if i not in ext_ids and i not in ('sen', 'ji', 'ubin')]
    main = _fit(main.buffer(2.0, join_style=1).buffer(-2.0, join_style=1), main_nodes, 27, 'main', log)
    johor = _fit(johor, [nid[i] for i in ext_ids if i in nid], 30, 'johor', log)
    # small reclaimed promontories that carry the landmark drawings (Marina Bay Sands stands on one)
    for (cx, cy, rx, ry, rot, seed) in EXTRAS:
        main = unary_union([main, ellipse(cx, cy, rx, ry, rot, 0.12, seed)])
        main = _largest(main)
    # 2. islands: slide each one so its station sits well inside
    def hold(g, n, margin=30):
        if g is None: return g
        from shapely.affinity import translate
        from shapely.ops import nearest_points
        p = Point(n['x'], n['y'])
        for _ in range(8):
            inside = g.contains(p); d = g.exterior.distance(p)
            if inside and d >= margin: break
            q = nearest_points(g.exterior, p)[0]
            ux, uy = p.x - q.x, p.y - q.y; L = math.hypot(ux, uy) or 1.0
            if inside: t = (-ux / L * (margin - d), -uy / L * (margin - d))
            else: t = (ux / L * (d + margin), uy / L * (d + margin))
            g = translate(g, *t)
        return g
    # Ubin and Jurong Island: grow a headland towards their station instead of moving the whole island
    ubin = _fit(ubin, [nid['ubin']], 24, 'ubin', log, sigma=30)
    jur = _fit(jur, [nid['ji']], 26, 'jurong', log, sigma=30)
    # Sentosa: drawn a touch larger (it is the home of the luge) and tucked south-east of HarbourFront
    if sentosa is not None:
        from shapely.affinity import scale, translate
        from shapely.ops import nearest_points
        sentosa = scale(sentosa, 1.32, 1.32, origin='centroid')
        x0, y0, x1, y1 = sentosa.bounds
        sentosa = translate(sentosa, 652 - x0, nid['sen']['y'] + 1 - sentosa.centroid.y)
        for _ in range(10):
            a, b = nearest_points(sentosa, main)
            d = a.distance(b)
            if d >= 13: break
            dx, dy = a.x - b.x, a.y - b.y; L = math.hypot(dx, dy) or 1.0
            sentosa = translate(sentosa, dx / L * (14 - d), dy / L * (14 - d))
        sentosa = _fit(sentosa, [nid['sen']], 24, 'sentosa', log, sigma=30)
    lands = {'main': main, 'ubin': ubin, 'tekong': tekong, 'sentosa': sentosa, 'jurong': jur}
    keep = [g for g in lands.values() if g is not None]
    pts_nodes = [Point(n['x'], n['y']).buffer(30) for n in nid.values()]
    others = []
    for g in isl:
        if any(g is x for x in (ubin, tekong, sentosa)) or any(g is x for x in jpieces) or g is probe(103.82, 1.36): continue
        if g.area < 25 or g.area > 20000: continue
        if any(g.intersects(k.buffer(10)) for k in keep) or any(g.intersects(pn) for pn in pts_nodes): continue
        others.append(g)
    for k in list(lands):
        g = lands[k]
        if g is None: continue
        g = g.buffer(2.2, join_style=1).buffer(-2.2, join_style=1)
        lands[k] = _largest(g)
    # report anything still off
    for i, n in nid.items():
        if i in ext_ids: continue
        key = {'sen': 'sentosa', 'ji': 'jurong', 'ubin': 'ubin'}.get(i, 'main')
        g = lands[key]; pp = Point(n['x'], n['y'])
        if not g.contains(pp) or g.exterior.distance(pp) < 18: log('station near/off coast:', i, key, round(g.exterior.distance(pp)), g.contains(pp))
    return dict(lands=lands, johor=johor, others=others, T=T)

import random
from shapely.geometry import LineString, MultiPoint
from shapely.affinity import scale as _scale, rotate as _rotate, translate as _translate

def ellipse(cx, cy, rx, ry, rot=0, wob=0.0, seed=1):
    """A slightly lumpy ellipse (cartoon blob)."""
    r = random.Random(seed); pts = []
    n = 28
    ph = [r.uniform(0, 6.28) for _ in range(3)]
    for i in range(n):
        a = 2 * math.pi * i / n
        k = 1 + wob * (math.sin(2 * a + ph[0]) * .5 + math.sin(3 * a + ph[1]) * .35 + math.sin(5 * a + ph[2]) * .15)
        pts.append((rx * k * math.cos(a), ry * k * math.sin(a)))
    g = Polygon(pts)
    g = _rotate(g, rot, origin=(0, 0))
    return _translate(g, cx, cy)

def label_box(n):
    """rough bounding box of a station label, mirroring map.js labelFor()"""
    name = n['name']
    lines = [name]
    if len(name) > 13 and ' ' in name:
        mid = len(name) / 2; best = min([i for i, c in enumerate(name) if c == ' '], key=lambda i: abs(i - mid))
        lines = [name[:best], name[best + 1:]]
    w = max(len(t) for t in lines) * 7.4 + 6; h = 14.5 * len(lines) + 2
    r = 15 if 'key' in n['tags'] else 10.5
    x, y, lp = n['x'], n['y'], n['lp']
    if lp == 'n': return box(x - w / 2, y - r - 8 - h, x + w / 2, y - r - 6)
    if lp == 's': return box(x - w / 2, y + r + 3, x + w / 2, y + r + 5 + h)
    if lp == 'e': return box(x + r + 6, y - h / 2, x + r + 8 + w, y + h / 2)
    if lp == 'w': return box(x - r - 8 - w, y - h / 2, x - r - 6, y + h / 2)
    up, right = lp[0] == 'n', lp[1] == 'e'
    y0 = y - r - 4 - h if up else y + r + 4
    return box(x + r if right else x - r - w, y0, x + r + w if right else x - r, y0 + h)

def export(land, T, nodes, edges, decor):
    out = {}
    out['land'] = {k: to_paths(g, minarea=30)[0] for k, g in land['lands'].items() if g is not None}
    out['isles'] = [p for g in land['others'] for p in to_paths(g, minarea=20)]
    out['johor'] = to_paths(land['johor'], tol=1.6, minarea=100)
    rng = random.Random(4242)
    sg = unary_union([g for g in land['lands'].values() if g is not None])
    johor = land['johor']
    canvas = box(0, 0, W, H)
    nid = list(nodes.values())
    npts = [Point(n['x'], n['y']) for n in nid]
    segs = [LineString([(nodes[a]['x'], nodes[a]['y']), (nodes[b]['x'], nodes[b]['y'])]) for (a, b, *_r) in edges]
    lbl = [label_box(n) for n in nid]
    zones = [Point(x, y).buffer(r) for (x, y, r) in decor['keepout']]
    # reservoirs
    res = []
    for i, (cx, cy, rx, ry, rot) in enumerate(decor['reservoirs']):
        g = ellipse(cx, cy, rx, ry, rot, 0.22, 100 + i).intersection(sg.buffer(-6))
        if not g.is_empty: res.append(g)
    out['reservoirs'] = [p for g in res for p in to_paths(g, tol=.8, minarea=30)]
    resu = unary_union(res) if res else Polygon()
    # forests
    forests = []
    for i, (cx, cy, rx, ry, rot, host) in enumerate(decor['forests']):
        hostg = sg if host == 'sg' else johor
        g = ellipse(cx, cy, rx, ry, rot, 0.28, 10 + i).intersection(hostg.buffer(-5))
        g = g.difference(resu.buffer(3))
        if not g.is_empty: forests.append((g, host))
    out['forests'] = [p for g, h in forests for p in to_paths(g, tol=.8, minarea=40)]
    # trees: poisson-ish scatter inside the forests, avoiding stations, routes, labels, reservoirs and the landmark zones
    def ok(pt, pad_node=30, pad_seg=11):
        if any(pt.distance(q) < pad_node for q in npts): return False
        if any(pt.distance(s) < pad_seg for s in segs): return False
        if any(b.buffer(3).contains(pt) for b in lbl): return False
        if any(z.contains(pt) for z in zones): return False
        if resu.buffer(2).contains(pt): return False
        return True
    trees = []
    def scatter(poly, spacing, kinds, jit=.45, pad_node=30, pad_seg=11, maxn=400, scale=(0.85, 1.15)):
        x0, y0, x1, y1 = poly.bounds
        pts = []
        y = y0
        while y < y1:
            x = x0 + (spacing * .5 if int((y - y0) / spacing) % 2 else 0)
            while x < x1:
                px = x + rng.uniform(-jit, jit) * spacing; py = y + rng.uniform(-jit, jit) * spacing
                pt = Point(px, py)
                if poly.contains(pt) and canvas.contains(pt) and ok(pt, pad_node, pad_seg): pts.append((px, py))
                x += spacing
            y += spacing * .87
        rng.shuffle(pts)
        for (px, py) in pts[:maxn]:
            trees.append([round(px, 1), round(py, 1), rng.choice(kinds), round(rng.uniform(*scale), 2)])
    for g, host in forests:
        scatter(g.buffer(-3), 11.5, [0, 0, 1, 0, 1] if host == 'sg' else [2, 2, 0], maxn=140)
    # sparse parkland trees across the island
    park = sg.difference(unary_union([g for g, h in forests]).buffer(2)).buffer(-8)
    scatter(park, 46, [0, 1, 0], jit=.5, pad_node=34, pad_seg=14, maxn=70, scale=(0.8, 1.05))
    # palms along the Malaysian shore and kampong-side
    jcoast = johor.buffer(-16).intersection(johor.buffer(-46).symmetric_difference(johor.buffer(-16)))
    jband = johor.buffer(-14).difference(johor.buffer(-44))
    scatter(jband.intersection(canvas), 30, [2, 2, 0], jit=.5, pad_node=40, pad_seg=14, maxn=45, scale=(0.9, 1.2))
    # a few Ubin / island trees
    for k in ('ubin', 'tekong', 'sentosa'):
        g = land['lands'].get(k)
        if g is not None: scatter(g.buffer(-9), 14 if k != 'sentosa' else 15, [0, 2, 1] if k != 'ubin' else [0, 0, 1, 2], jit=.4, pad_node=26, pad_seg=10, maxn=40)
    trees.sort(key=lambda t: t[1])
    out['trees'] = trees
    # waves: little curls on open water
    water = canvas.difference(unary_union([sg, johor] + [g for g in land['others']])).buffer(0)
    shore = unary_union([sg, johor] + list(land['others'])).buffer(34)
    far = water.difference(shore)
    waves = []
    for _ in range(900):
        px, py = rng.uniform(10, W - 10), rng.uniform(10, H - 10)
        pt = Point(px, py)
        if far.contains(pt) and all(math.hypot(px - q[0], py - q[1]) > 78 for q in waves):
            waves.append((px, py))
        if len(waves) >= 60: break
    out['waves'] = [[round(x), round(y), round(rng.uniform(.8, 1.25), 2)] for x, y in waves]
    out['decor'] = decor
    return out
