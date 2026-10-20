#!/usr/bin/env python3
"""Generates src/mapdata.js (stations, routes, tickets, coastline) and a preview SVG.
Checks: node spacing, per-car spacing, route crossings, connectivity, ticket values."""
import json, math, random, heapq, sys, itertools

SX = SY = 2400.0
LON0, LAT0 = 103.57, 1.505
OX, OY = 60, 60
W, H = 1280, 800
CX, CY, K, R = 720, 540, 0.62, 150.0   # fisheye: spreads the dense city core

def proj(lon, lat):
    return OX + (lon - LON0) * SX, OY + (LAT0 - lat) * SY

def fish(x, y):
    dx, dy = x - CX, y - CY
    r = math.hypot(dx, dy)
    if r < 1e-6:
        return x, y
    f = 1 + K * math.exp(-(r / R) ** 2)
    return CX + dx * f, CY + dy * f

def P(lon, lat, nx=0, ny=0):
    x, y = proj(lon, lat)
    x, y = fish(x, y)
    return round(x + nx, 1), round(y + ny, 1)

# id, name, sub-label, lon, lat, nudge x, nudge y, label position (n/s/e/w), tags
N = [
 ("gel","Gelang Patah","Malaysia",103.585,1.348,0,0,"s",["ext"]),
 ("jb","Johor Bahru","Malaysia",103.768,1.468,0,0,"n",["ext"]),
 ("tuas","Tuas","",103.637,1.325,0,0,"s",[]),
 ("boon","Boon Lay","",103.705,1.340,0,0,"n",[]),
 ("ji","Jurong Island","",103.692,1.280,0,0,"s",[]),
 ("je","Jurong East","",103.742,1.333,0,0,"sw",[]),
 ("cle","Clementi","",103.765,1.315,0,0,"e",[]),
 ("vn","Vue Networks","",103.787,1.300,0,0,"s",["custom"]),
 ("qt","Queenstown","",103.806,1.296,0,-6,"n",[]),
 ("sh","Samuels House","",103.823,1.279,0,0,"w",["custom"]),
 ("hf","HarbourFront","",103.822,1.266,0,6,"w",[]),
 ("sen","Sentosa","",103.838,1.249,0,0,"s",[]),
 ("orc","Orchard","",103.832,1.304,0,-8,"n",[]),
 ("bug","Bugis","",103.8556,1.3003,0,0,"w",["key"]),
 ("mb","Marina Bay","",103.857,1.282,0,0,"s",[]),
 ("kal","Lavender","",103.871,1.311,0,0,"e",[]),
 ("pl","Paya Lebar","",103.893,1.318,0,0,"s",[]),
 ("bedok","Bedok","",103.930,1.324,0,0,"s",[]),
 ("tamp","Tampines","",103.945,1.354,0,0,"w",[]),
 ("chang","Changi","",103.989,1.352,0,0,"s",[]),
 ("pr","Pasir Ris","",103.950,1.373,0,0,"e",[]),
 ("ubin","Pulau Ubin","",104.004,1.413,0,0,"n",[]),
 ("pung","Punggol","",103.905,1.405,0,0,"n",[]),
 ("seng","Sengkang","",103.895,1.392,10,10,"e",[]),
 ("sel","Seletar","",103.870,1.405,0,0,"n",[]),
 ("ser","Serangoon","",103.874,1.350,0,0,"e",[]),
 ("amk","Ang Mo Kio","",103.850,1.366,0,10,"e",[]),
 ("tp","Bishan","",103.847,1.333,-8,0,"w",[]),
 ("bt","Bukit Timah","",103.790,1.345,0,0,"w",[]),
 ("nyp","Nanyang Polytechnic","",103.842,1.388,-12,0,"e",["custom"]),
 ("yish","Yishun","",103.838,1.422,0,0,"ne",[]),
 ("semb","Sembawang","",103.822,1.452,0,0,"n",[]),
 ("mand","Mandai","",103.790,1.405,0,0,"w",[]),
 ("wood","Woodlands","",103.787,1.437,0,0,"e",[]),
 ("kra","Kranji","",103.745,1.432,0,0,"n",[]),
 ("lck","Lim Chu Kang","",103.700,1.428,0,0,"w",[]),
 ("cck","Choa Chu Kang","",103.745,1.385,0,0,"w",[]),
]
FINAL = {
 "boon":(370,440),"je":(440,472),"cle":(508,505),"vn":(556,562),"qt":(628,548),"orc":(700,530),
 "sh":(643,631),"hf":(610,690),"sen":(698.6,711.3),"kal":(828,535),"pl":(885,490),
 "seng":(840,340),"pung":(885,280),"tamp":(960,445),"bedok":(955,525),
 "amk":(755,385),"ser":(815,420),"tp":(715,445),
}
nodes = {}
disp = []
for (i,name,sub,lon,lat,nx,ny,lp,tags) in N:
    x,y = P(lon,lat,nx,ny)
    if i in FINAL:
        fx,fy = FINAL[i]
    else:
        fx,fy = x,y
    disp.append((x,y,fx-x,fy-y))
    nodes[i] = dict(id=i,name=name,sub=sub,x=round(fx,1),y=round(fy,1),lp=lp,tags=tags)
def warp(x,y):
    sw=0; sx=0; sy=0
    for (px,py,dx,dy) in disp:
        d2=(px-x)**2+(py-y)**2+400.0
        w=1.0/(d2*d2)
        sw+=w; sx+=w*dx; sy+=w*dy
    return x+sx/sw, y+sy/sw

# a, b, length, flags ('D' double, 'F1' ferry needing 1 wild), names
E = [
 ("jb","wood",2,"D","Causeway / RTS Link"),
 ("gel","tuas",3,"","Tuas Second Link"),
 ("tuas","boon",4,"",""),("tuas","ji",4,"",""),("boon","ji",3,"",""),
 ("boon","je",2,"",""),("je","cle",2,"",""),("je","bt",3,"",""),("je","cck",4,"",""),
 ("cck","lck",3,"",""),("cck","kra",3,"",""),("lck","kra",2,"",""),("kra","wood",3,"",""),
 ("wood","semb",2,"",""),("semb","yish",2,"",""),("wood","mand",2,"",""),("mand","yish",3,"",""),
 ("mand","cck",3,"",""),("mand","bt",3,"",""),("cck","bt",3,"",""),("kra","mand",3,"",""),
 ("yish","nyp",2,"",""),("nyp","amk",2,"",""),("nyp","mand",3,"",""),
 ("yish","sel",2,"",""),("amk","sel",2,"",""),("amk","tp",2,"",""),("amk","ser",2,"",""),
 ("sel","seng",2,"",""),("sel","pung",3,"",""),("seng","pung",2,"",""),("seng","ser",2,"",""),("seng","pr",4,"",""),
 ("pung","pr",3,"",""),("pr","tamp",2,"",""),("pr","chang",3,"",""),
 ("pr","ubin",3,"F1","Bumboat"),("chang","ubin",3,"F1","Bumboat"),
 ("tamp","pl",2,"",""),("tamp","bedok",2,"D",""),("tamp","chang",3,"",""),("bedok","chang",4,"",""),
 ("bedok","pl",2,"",""),("pl","kal",2,"",""),("pl","ser",3,"",""),
 ("ser","tp",2,"",""),("ser","tamp",4,"",""),("ser","bug",4,"",""),("tp","bug",3,"",""),("tp","bt",3,"",""),
 ("bt","vn",3,"",""),("cle","bt",3,"",""),("cle","vn",2,"",""),("vn","qt",2,"",""),
 ("qt","orc",2,"",""),("qt","sh",2,"",""),("orc","bug",2,"D",""),("orc","tp",2,"",""),
 ("bug","kal",2,"",""),("bug","mb",2,"",""),("kal","mb",3,"",""),
 ("sh","hf",2,"",""),("bug","sh",3,"",""),("sh","mb",3,"",""),("hf","mb",4,"",""),("hf","sen",2,"D","Sentosa Gateway"),
]

def dist(a,b):
    return math.hypot(nodes[a]['x']-nodes[b]['x'], nodes[a]['y']-nodes[b]['y'])

problems = []
# node spacing
ids = list(nodes)
for a,b in itertools.combinations(ids,2):
    d = dist(a,b)
    if d < 62:
        problems.append(f"nodes close: {a}-{b} {d:.0f}px")
# per-car spacing
for (a,b,L,f,nm) in E:
    d = dist(a,b); s = d/L
    if not (30 <= s <= 56):
        problems.append(f"spacing {a}-{b} len{L} dist{d:.0f} -> {s:.0f}px/car")

# crossings
def seg_inter(p1,p2,p3,p4):
    def ccw(a,b,c): return (c[1]-a[1])*(b[0]-a[0]) - (b[1]-a[1])*(c[0]-a[0])
    d1=ccw(p3,p4,p1); d2=ccw(p3,p4,p2); d3=ccw(p1,p2,p3); d4=ccw(p1,p2,p4)
    return (d1*d2<0) and (d3*d4<0)
for e1,e2 in itertools.combinations(E,2):
    if {e1[0],e1[1]} & {e2[0],e2[1]}: continue
    p=lambda i:(nodes[i]['x'],nodes[i]['y'])
    if seg_inter(p(e1[0]),p(e1[1]),p(e2[0]),p(e2[1])):
        problems.append(f"crossing {e1[0]}-{e1[1]} x {e2[0]}-{e2[1]}")
# node too close to a non-incident route
def pt_seg(pt,a,b):
    ax,ay=a; bx,by=b; px,py=pt
    dx,dy=bx-ax,by-ay
    t=max(0,min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy)))
    return math.hypot(px-(ax+t*dx),py-(ay+t*dy))
for (a,b,L,f,nm) in E:
    for i in ids:
        if i in (a,b): continue
        d = pt_seg((nodes[i]['x'],nodes[i]['y']),(nodes[a]['x'],nodes[a]['y']),(nodes[b]['x'],nodes[b]['y']))
        if d < 26: problems.append(f"node {i} only {d:.0f}px from route {a}-{b}")

# graph
adj = {i:[] for i in ids}
for (a,b,L,f,nm) in E:
    adj[a].append((b,L)); adj[b].append((a,L))
seen=set(); st=[ids[0]]
while st:
    u=st.pop()
    if u in seen: continue
    seen.add(u); st += [v for v,_ in adj[u]]
if len(seen)!=len(ids): problems.append("graph not connected: "+str(set(ids)-seen))
deg = {i:len(adj[i]) for i in ids}

def sp(a,b):
    D={a:0}; pq=[(0,a)]
    while pq:
        d,u=heapq.heappop(pq)
        if d>D[u]: continue
        for v,L in adj[u]:
            if d+L<D.get(v,1e9):
                D[v]=d+L; heapq.heappush(pq,(d+L,v))
    return D[b]

# colour assignment: 8 line colours, neighbours differ
COLORS = ["red","green","purple","amber","blue","brown","teal","slate"]
rng = random.Random(20261017)
lanes = []
for idx,(a,b,L,f,nm) in enumerate(E):
    n = 2 if f=="D" else 1
    for k in range(n):
        lanes.append(dict(id=f"r{len(lanes)}",a=a,b=b,len=L,flags=f,name=nm,lane=k,lanes=n,color=None))
# target ~40% grey
order = list(range(len(lanes))); rng.shuffle(order)
grey_target = int(len(lanes)*0.38)
for i in order[:grey_target]:
    lanes[i]['color']='grey'
# double routes: lanes should not both be same; make double pairs grey+grey or two different colours
for ln in lanes:
    pass
def used_at(node, exclude):
    s=set()
    for l in lanes:
        if l is exclude: continue
        if node in (l['a'],l['b']) and l['color'] not in (None,'grey'):
            s.add(l['color'])
    return s
count = {c:0 for c in COLORS}
for i in order[grey_target:]:
    ln = lanes[i]
    avoid = used_at(ln['a'],ln)|used_at(ln['b'],ln)
    # sibling lane of double
    for o in lanes:
        if o is not ln and o['a']==ln['a'] and o['b']==ln['b'] and o['color'] not in (None,'grey'):
            avoid.add(o['color'])
    cands=[c for c in COLORS if c not in avoid] or COLORS[:]
    cands.sort(key=lambda c:(count[c],rng.random()))
    ln['color']=cands[0]; count[cands[0]]+=len(range(ln['len']))
for ln in lanes:
    if ln['color'] is None: ln['color']='grey'

tot_len = sum(l['len'] for l in lanes)
uniq_len = sum(e[2] for e in E)
colour_len = {c:sum(l['len'] for l in lanes if l['color']==c) for c in COLORS+['grey']}

# tickets
FAV = [("sh","vn"),("nyp","sh"),("vn","nyp"),("bug","chang"),("jb","hf"),("gel","bug"),("tuas","chang"),("sen","ubin"),
       ("jb","sh"),("vn","bug"),("nyp","bug"),("sh","bug"),("bug","wood"),("tuas","mb"),("gel","pr")]
allp = {}
for a_,b_ in itertools.combinations(ids,2):
    allp[(a_,b_)] = sp(a_,b_)
T = list(FAV)
cnt = {i:0 for i in ids}
for a_,b_ in T: cnt[a_]+=1; cnt[b_]+=1
trng = random.Random(77)
pool = [p for p,v in allp.items() if 5 <= v <= 20 and p not in T and (p[1],p[0]) not in T]
trng.shuffle(pool)
# target distribution for the fill: favour mid-length, cap per node
def bucket(v): return 0 if v<=8 else (1 if v<=13 else 2)
want = {0:9,1:10,2:6}
have = {0:0,1:0,2:0}
for p in T: have[bucket(sp(*p))]+=1
for p in pool:
    if len(T)>=40: break
    v=allp[p]; bk=bucket(v)
    if have[bk]>=want[bk]+ (3 if bk==0 else 2) and bk!=1: continue
    if cnt[p[0]]>=3 or cnt[p[1]]>=3: continue
    # skip leafy tickets that all point at the same remote node
    T.append(p); cnt[p[0]]+=1; cnt[p[1]]+=1; have[bk]+=1
tickets=[]
for (a,b) in T:
    v = sp(a,b)
    tickets.append(dict(a=a,b=b,pts=v))

# ---- terrain: real coastline -> same pipeline as the stations -> smooth cartoon shapes ----
sys.path.insert(0, ".")
from geo import terrain as TER
T = lambda lon, lat: tuple(round(v, 1) for v in warp(*fish(*proj(lon, lat))))
land = TER.build(T, nodes)
DECOR = dict(
    # [cx, cy, rx, ry, rotation, host]  (px)
    forests=[(335, 365, 44, 64, 14, 'sg'), (640, 335, 62, 36, -8, 'sg'), (548, 392, 24, 26, 0, 'sg'), (962, 322, 44, 26, -32, 'sg'),
             (612, 248, 36, 22, 12, 'sg'), (300, 478, 34, 22, 0, 'sg'), (1010, 400, 26, 22, 0, 'sg'), (430, 405, 30, 20, 0, 'sg'),
             (150, 300, 80, 110, 20, 'jo'), (880, 120, 110, 50, 0, 'jo'), (1200, 140, 60, 80, 0, 'jo')],
    reservoirs=[(628, 322, 30, 13, -12), (598, 262, 26, 11, 18), (532, 207, 24, 9, 4), (333, 424, 17, 8, 0), (925, 507, 15, 7, 12)],
    # (x, y, radius) kept clear of trees so the landmark illustrations stay readable
    keepout=[(807, 358, 42), (673, 399, 58), (836, 626, 46), (776, 712, 44), (394, 578, 40), (322, 90, 30), (378, 90, 30), (434, 90, 30), (800, 62, 28), (852, 62, 28), (896, 62, 24)],
)
terrain = TER.export(land, T, nodes, E, DECOR)
data = dict(W=W,H=H,nodes=list(nodes.values()),routes=lanes,tickets=tickets,terrain=terrain,colors=COLORS)
with open("src/mapdata.js","w") as f:
    f.write("const MAPDATA = "+json.dumps(data,separators=(",",":"))+";\n")

print("nodes",len(ids),"edges",len(E),"lanes",len(lanes),"unique length",uniq_len,"lane length",tot_len)
print("colour lengths",colour_len)
print("degrees",sorted(deg.items(),key=lambda x:-x[1])[:8])
vals=sorted(t['pts'] for t in tickets)
print("ticket values",vals)
for t in tickets: print(f"  {nodes[t['a']]['name']:>20} -> {nodes[t['b']]['name']:<20} {t['pts']}")
print("PROBLEMS:" if problems else "no problems")
for p in problems: print("  ",p)
