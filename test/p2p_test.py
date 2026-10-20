"""Peer-to-peer multiplayer test for the GitHub build (web/index.html).
Needs:  npm i peer   and a local broker:  node test/broker.js 9000      then:  python3 build.py && python3 test/p2p_test.py
Plays a whole 4-seat game (3 browsers + 1 computer), with a friend reloading, the host reloading and resuming, and a spectator joining."""
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright
SP = os.environ.get("SHOTS", "/tmp/") 
srv = subprocess.Popen(["python3", "-m", "http.server", "8124", "--directory", "."], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.8)
URL = "http://localhost:8124/index.html?broker=127.0.0.1:9000"
errors = []
FAST = """(()=>{const st=window.setTimeout;window.setTimeout=(f,d,...a)=>st(f,(d>150&&d<5000)?8:d,...a);})()"""
def newpage(b, tag, ctx=None):
    ctx = ctx or b.new_context(viewport={'width': 1300, 'height': 850}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append((tag, "pageerror", str(e))))
    pg.on("console", lambda m: errors.append((tag, "console", m.text)) if m.type == "error" and "ERR_TUNNEL" not in m.text and "Failed to load resource" not in m.text else None)
    pg.add_init_script(FAST)
    pg.goto(URL); pg.wait_for_timeout(400)
    return pg
def info(pg):
    return pg.evaluate("(()=>{const A=__LCR.App,E=__LCR.E,s=A.state;if(!s)return null;return {over:s.over,turn:s.turn,me:A.me,phase:s.phase,v:s.v,gid:s.gid,claims:(A.me>=0&&s.turn===A.me&&s.phase==='main')?E.legalClaims(s,A.me).map(c=>c.ri):[],pend:A.me>=0?s.players[A.me].pending.length:0,kind:s.players[s.turn].kind}})()")
def act(pg, i):
    if i['pend']:
        pg.locator("#sheet [data-act=tix-toggle]").nth(0).click()
        if i['phase'] == 'setup': pg.locator("#sheet [data-act=tix-toggle]").nth(1).click()
        pg.click("#sheet [data-act=keep]"); return
    if i['phase'] == 'main' and i['claims']:
        ri = i['claims'][0]
        pg.evaluate("(ri)=>document.querySelector(`.route[data-ri='${ri}'] .hit`).dispatchEvent(new MouseEvent('click',{bubbles:true}))", ri)
        pg.wait_for_timeout(20)
        if pg.locator("#sheet [data-act=pay]").count(): pg.locator("#sheet [data-act=pay]").first.click(); return
    btn = pg.locator("#side button.card:not([disabled])")
    if btn.count(): btn.first.click()
    else: pg.click("#side [data-act=deck]")
def ok(label, cond):
    print(("PASS " if cond else "FAIL ") + label)
    if not cond: errors.append((label, "assert", ""))
with sync_playwright() as p:
    b = p.chromium.launch(args=["--disable-features=WebRtcHideLocalIpsWithMdns"])
    A = newpage(b, "amy"); B = newpage(b, "ben"); C = newpage(b, "cat")
    ok("menu is multiplayer only", A.locator("[data-act=solo-start]").count() == 0 and A.locator("[data-act=host]").count() == 1)
    A.fill("#nick", "Amy"); A.click("[data-act=host]"); A.wait_for_selector(".bigcode", timeout=20000)
    code = A.inner_text(".bigcode").strip(); print("code", code)
    for pg, n in ((B, "Ben"), (C, "Cat")):
        pg.fill("#nick", n); pg.fill("#jcode", code); pg.click("[data-act=join]"); pg.wait_for_selector(".bigcode", timeout=20000)
    A.wait_for_timeout(600)
    ok("lobby lists 3 humans + 1 CPU on every device", all(pg.locator(".joined li").count() == 4 for pg in (A, B, C)))
    # a wrong code
    X = newpage(b, "x"); X.fill("#nick", "X"); X.fill("#jcode", "ZZZZ"); X.click("[data-act=join]"); X.wait_for_selector("text=No game found", timeout=15000)
    ok("unknown code reports no game", "No game found" in X.inner_text("#overlay")); X.context.close()
    A.click("[data-act=lobby-start]")
    pages = [A, B, C]
    for pg in pages: pg.wait_for_function("window.__LCR && __LCR.App.state && __LCR.App.mode==='online'", timeout=15000)
    me0 = [info(pg)['me'] for pg in pages]; print("me indices", me0, A.evaluate("__LCR.App.state.players.map(p=>p.name+':'+p.kind)"))
    ok("each device has its own seat", sorted(me0) == [0, 1, 2])
    D = None; step = 0; did = set()
    while step < 1400:
        step += 1
        infos = [info(pg) for pg in pages]
        if all(i and i['over'] for i in infos): break
        moved = False
        for pg, i in zip(pages, infos):
            if i and i['turn'] == i['me'] and not i['over']:
                try: act(pg, i); moved = True
                except Exception as e: pass
                pg.wait_for_timeout(30)
        if not moved: A.wait_for_timeout(25)
        if step == 25 and 'reload' not in did:
            did.add('reload'); B.reload(); B.wait_for_timeout(700)
            B.wait_for_selector("[data-act=resume]", timeout=10000); B.click("[data-act=resume]")
            B.wait_for_function("__LCR.App.state && __LCR.App.mode==='online'", timeout=15000)
            ok("friend reload keeps the same seat", info(B)['me'] == me0[1])
        if step == 45 and 'spec' not in did:
            did.add('spec'); D = newpage(b, "dan"); D.fill("#nick", "Dan"); D.fill("#jcode", code); D.click("[data-act=join]")
            D.wait_for_function("__LCR.App.state && __LCR.App.mode==='online'", timeout=15000)
            ok("spectator watches without a hand", info(D)['me'] == -1 and D.locator("#side >> text=Your hand").count() == 0)
        if step == 55 and 'seat' not in did:
            did.add('seat'); ctx = C.context; C.close(); C = newpage(b, "cat2", ctx); pages[2] = C
            C.fill("#nick", "Cat"); C.fill("#jcode", code); C.click("[data-act=join]")
            C.wait_for_function("__LCR.App.state && __LCR.App.mode==='online'", timeout=20000)
            ok("friend who closed the tab and typed the code gets the same seat back", info(C)['me'] == me0[2])
        if step == 70 and 'hostreload' not in did:
            did.add('hostreload'); vbefore = max((i or {'v': 0})['v'] for i in infos)
            A.reload(); A.wait_for_timeout(500)
            A.wait_for_selector("[data-act=resume]", timeout=10000); A.click("[data-act=resume]")
            A.wait_for_function("__LCR.App.state && __LCR.App.mode==='online'", timeout=30000)
            ok("host reload resumes hosting", info(A)['me'] == me0[0] and A.evaluate("__LCR.App.host") is True and info(A)['v'] >= vbefore - 1)
            B.wait_for_timeout(4500)
        if step == 35: A.screenshot(path=SP + "p2p_game_host.png")
    for pg in pages + ([D] if D else []): pg.wait_for_timeout(300)
    fin = [info(pg) for pg in pages + ([D] if D else [])]
    ok("game finished on every device", all(f and f['over'] for f in fin))
    routes = [pg.evaluate("JSON.stringify(__LCR.App.state.routes)") for pg in pages + ([D] if D else [])]
    ok("board identical on every device", len(set(routes)) == 1)
    ok("results shown to everyone", all(pg.locator(".winner").count() == 1 for pg in pages))
    A.screenshot(path=SP + "p2p_over.png")
    A.click("[data-act=rematch]"); A.wait_for_timeout(800)
    for pg in pages: pg.wait_for_timeout(300)
    gids = [info(pg)['gid'] for pg in pages]
    ok("rematch starts the same new game everywhere", len(set(gids)) == 1 and all(pg.locator(".winner").count() == 0 for pg in pages))
    # two tabs in one browser can host and join each other (handy for trying it out alone)
    ctx = b.new_context(viewport={'width': 1300, 'height': 850})
    T1 = newpage(b, "tab1", ctx); T2 = newpage(b, "tab2", ctx)
    T1.fill("#nick", "Solo"); T1.click("[data-act=host]"); T1.wait_for_selector(".bigcode", timeout=20000); c2 = T1.inner_text(".bigcode").strip()
    T2.fill("#nick", "Twin"); T2.fill("#jcode", c2); T2.click("[data-act=join]"); T2.wait_for_selector(".bigcode", timeout=25000)
    T1.wait_for_timeout(500)
    ok("second tab in the same browser joins as a separate player", T1.locator(".joined li").count() == 3)
    T1.click("[data-act=lobby-start]")
    for pg in (T1, T2): pg.wait_for_function("window.__LCR && __LCR.App.state && __LCR.App.mode==='online'", timeout=15000)
    ok("the two tabs have different seats", {info(T1)['me'], info(T2)['me']} == {0, 1})
    print("ERRORS:", errors)
    b.close()
srv.terminate()
sys.exit(1 if errors else 0)
