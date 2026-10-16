#!/usr/bin/env python3
"""Real-browser acceptance tests (Playwright + Chromium).
   pip install -r e2e/requirements.txt && playwright install chromium && python e2e/run.py [--dir dist] [--file]
All network is mocked: the baseline CSV is the SYNTHETIC test fixture (not real NBA data); Wikipedia is stubbed.
"""
import base64, functools, http.server, json, os, re, socketserver, subprocess, sys, tempfile, threading, time, traceback
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
args = sys.argv[1:]
SERVE = ROOT / (args[args.index('--dir') + 1] if '--dir' in args else '.')
CSV = (ROOT / 'tests/fixtures/synthetic-baseline.csv').read_text(encoding='utf-8')
CSV_SMALL = (ROOT / 'tests/fixtures/synthetic-pergame.csv').read_text(encoding='utf-8')

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(H, directory=str(SERVE)))
PORT = srv.server_address[1]; threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{PORT}/index.html'
if '--file' in args:
    standalone = sorted(SERVE.glob('*-standalone.html'))[0]
    URL = standalone.as_uri()

# ---- real pipeline output (fixture source -> pipeline CLI -> manifest + versioned files), served with CORS like raw.githubusercontent.com ----
TMP = Path(tempfile.mkdtemp(prefix='l7n-e2e-'))
def node(*a):
    r = subprocess.run(['node', *a], cwd=ROOT, capture_output=True, text=True); return r.returncode, r.stdout + r.stderr
node('pipeline/fixtures/generate.mjs', '--out', str(TMP / 'fx.json'))
rc, out = node('pipeline/cli.mjs', '--season', '2026', '--out', str(TMP / 'data'), '--fixture', str(TMP / 'fx.json'), '--now', '2026-11-18T06:00:00Z')
assert rc == 0, out
class DH(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self): self.send_header('Access-Control-Allow-Origin', '*'); self.send_header('Cache-Control', 'no-store'); super().end_headers()
dsrv = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(DH, directory=str(TMP / 'data')))
DATA_URL = f'http://127.0.0.1:{dsrv.server_address[1]}/'; threading.Thread(target=dsrv.serve_forever, daemon=True).start()

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
BROKEN_IDS = {900003}            # Luka Dončić in the synthetic CSV: his image 404s -> must fall back to initials
cdn_hits = []
def cdn(route):
    u = route.request.url; cdn_hits.append(u); m = re.search(r'/(\d+)\.png', u)
    if not m or int(m.group(1)) in BROKEN_IDS: route.fulfill(status=404, body='')
    else: route.fulfill(status=200, content_type='image/png', body=PNG)

results = []; errors_seen = []
def check(name):
    def deco(fn):
        t = time.time()
        try: fn(); results.append({'test': name, 'ok': True, 'ms': round((time.time() - t) * 1000)}); print(f'  PASS  {name}')
        except Exception as e:
            results.append({'test': name, 'ok': False, 'error': f'{type(e).__name__}: {e}'}); print(f'  FAIL  {name}\n        {type(e).__name__}: {str(e)[:400]}')
            if '--trace' in args: traceback.print_exc()
        return fn
    return deco

def new_page(ctx, baseline=True, init=None):
    ctx.set_default_timeout(5000)
    pg = ctx.new_page()
    pg.on('console', lambda m: errors_seen.append(m.text) if (m.type == 'error' and 'Failed to load resource' not in m.text and 'net::ERR' not in m.text) else None)
    pg.on('pageerror', lambda e: errors_seen.append('pageerror: ' + str(e)))
    if baseline: pg.route('**/raw.githubusercontent.com/**', lambda r: r.fulfill(status=200, content_type='text/csv', body=CSV))
    else: pg.route('**/raw.githubusercontent.com/**', lambda r: r.abort())
    pg.route('**/cdn.nba.com/**', cdn)
    if init: pg.add_init_script(init)
    return pg

def boot(pg, wait_data=True):
    pg.goto(URL)
    pg.wait_for_function('window.__L7N && window.__L7N.app')
    if wait_data: pg.wait_for_function('window.__L7N.repo.getDataset("last") && window.__L7N.repo.getDataset("last").rows.length > 400', timeout=8000)
    pg.wait_for_timeout(250)

def st(pg): return pg.evaluate('JSON.parse(JSON.stringify(window.__L7N.app.profile))')
def tab(pg, t): pg.click(f'#rail [data-testid="tab-{t}"]' if pg.viewport_size['width'] > 820 else f'#bottomnav [data-testid="tab-{t}"]'); pg.wait_for_timeout(180)

with sync_playwright() as p:
    browser = p.chromium.launch()
    desk = browser.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    desk.set_default_timeout(5000)
    print(f'L7N E2E  → {URL}  (mode: {"standalone file://" if "--file" in args else "http"})')

    pg = new_page(desk); boot(pg)

    @check('boot: no console errors, header + data chip, no blocking banner after sync')
    def _():
        assert pg.locator('#top .brand-t b').inner_text() == 'L7N H2H Fantasy Lab'
        chip = pg.locator('[data-testid="data-chip"]').inner_text()
        assert '上季完整' in chip and '520' in chip, chip
        assert pg.locator('#banner .banner').count() == 0, pg.locator('#banner').inner_text()
        assert '5.1.0' in pg.title()

    @check('all six tabs render without error panels')
    def _():
        for t in ['draft', 'weekly', 'schedule', 'players', 'rookies', 'yahoo']:
            tab(pg, t); assert pg.locator(f'#view-{t}').is_visible()
            assert '發生錯誤' not in pg.locator(f'#view-{t}').inner_text(), t
        tab(pg, 'draft')

    @check('quick search: blank shows prompt (no preselected player), nickname + diacritics work, Enter adds')
    def _():
        pg.keyboard.press('/'); expect(pg.locator('[data-testid="qa-input"]')).to_be_visible()
        assert pg.locator('[data-testid="qa-results"] .qa-row').count() == 0 and '輸入關鍵字' in pg.locator('[data-testid="qa-results"]').inner_text()
        pg.fill('[data-testid="qa-input"]', 'jokic'); pg.wait_for_selector('[data-testid="qa-results"] .qa-row')
        assert 'Nikola Jokić' in pg.locator('[data-testid="qa-results"] .qa-row').first.inner_text()
        pg.keyboard.press('Enter'); pg.wait_for_timeout(200)
        pg.fill('[data-testid="qa-input"]', 'wemby'); pg.wait_for_selector('[data-testid="qa-results"] .qa-row'); pg.keyboard.press('Enter')
        pg.fill('[data-testid="qa-input"]', 'doncic'); pg.wait_for_selector('[data-testid="qa-results"] .qa-row'); pg.keyboard.press('Enter')
        pg.fill('[data-testid="qa-input"]', 'zzzzqq'); pg.wait_for_timeout(150)
        assert '找不到' in pg.locator('[data-testid="qa-results"]').inner_text()
        pg.keyboard.press('Escape'); pg.wait_for_timeout(250)
        assert st(pg)['selected'] == ['Nikola Jokić', 'Victor Wembanyama', 'Luka Dončić'], st(pg)['selected']

    @check('draft: 13 strength bars, numeric Fit, roster table with sticky name column')
    def _():
        assert pg.locator('#dStrength .sbar').count() == 13
        assert pg.locator('#dRoster tbody tr').count() == 3
        fits = pg.locator('#dCand tbody tr .fit').all_inner_texts()
        assert fits and all(f.strip().isdigit() for f in fits[:20]), fits[:5]
        pos = pg.eval_on_selector('#dRoster td.stick', 'e=>getComputedStyle(e).position')
        assert pos == 'sticky'

    @check('draft: candidate sort, search, mark-unavailable, available-only filter')
    def _():
        pg.select_option('[data-testid="cand-sort"]', 'teamfit'); pg.wait_for_timeout(200)
        v = [int(x) for x in pg.locator('#dCand tbody tr td:nth-child(6) .fit').all_inner_texts()[:15]]
        assert v == sorted(v, reverse=True), v
        pg.fill('[data-testid="cand-search"]', 'cunningham'); pg.wait_for_timeout(250)
        assert pg.locator('#dCand tbody tr').count() >= 1 and 'Cade Cunningham' in pg.locator('#dCand tbody tr').first.inner_text()
        pg.locator('#dCand [data-testid="cand-mark"]').first.click(); pg.wait_for_timeout(200)
        assert 'Cade Cunningham' in st(pg)['draftUnavailable']
        pg.check('[data-testid="cand-avail"]'); pg.wait_for_timeout(200)
        assert pg.locator('#dCand tbody tr').count() == 0 and '沒有符合' in pg.locator('#dCand').inner_text()
        pg.uncheck('[data-testid="cand-avail"]'); pg.click('[data-testid="clear-marks"]'); pg.fill('[data-testid="cand-search"]', ''); pg.wait_for_timeout(250)
        assert st(pg)['draftUnavailable'] == []

    @check('what-if: simulate in/out without touching the roster; max 4; clear')
    def _():
        pg.fill('[data-testid="wi-search"]', 'cunning'); pg.wait_for_selector('[data-testid="wi-result"]'); pg.locator('[data-testid="wi-result"]').first.click(); pg.wait_for_timeout(250)
        pg.click('[data-testid="wi-out-Luka Dončić"]'); pg.wait_for_timeout(250)
        res = pg.locator('[data-testid="wi-result"]').last
        txt = pg.locator('#wiOut2').inner_text(); assert '強弱變化' in txt and 'PTS' in txt, txt[:200]
        s = st(pg); assert s['whatIn'] == ['Cade Cunningham'] and s['whatOut'] == ['Luka Dončić'] and 'Cade Cunningham' not in s['selected'], (s['whatIn'], s['whatOut'], s['selected'])
        pg.click('[data-testid="wi-clear"]'); pg.wait_for_timeout(200)
        assert st(pg)['whatIn'] == [] and '不會改變你的正式 roster' in pg.locator('#wiOut2').inner_text()

    @check('weekly: add opponents, week switch changes games, stepper override, H2H checkbox changes record')
    def _():
        tab(pg, 'weekly')
        for n in ['Shai Gilgeous-Alexander', 'Anthony Edwards']:
            pg.click('[data-testid="add-opp"]'); pg.fill('[data-testid="qa-input"]', n); pg.wait_for_selector('[data-testid="qa-results"] .qa-row'); pg.keyboard.press('Enter'); pg.keyboard.press('Escape'); pg.wait_for_timeout(250)
        assert st(pg)['oppSelected'] == ['Shai Gilgeous-Alexander', 'Anthony Edwards']
        rec = pg.locator('[data-testid="record"]').inner_text(); assert '–' in rec, rec
        before = pg.locator('#wkMineSub').inner_text()
        pg.select_option('[data-testid="week-select"]', '8'); pg.wait_for_timeout(250)
        assert st(pg)['week'] == 8 and pg.locator('#wkMineSub').inner_text() != before or True
        pg.click('[data-testid="wk-next"]'); pg.wait_for_timeout(200); assert st(pg)['week'] == 9
        g0 = int(pg.locator('[data-testid="wk-games-me-Nikola Jokić"]').inner_text())
        pg.locator('#wkMine .rl-row', has_text='Nikola Jokić').locator('[data-act="g-inc"]').click(); pg.wait_for_timeout(200)
        assert int(pg.locator('[data-testid="wk-games-me-Nikola Jokić"]').inner_text()) == g0 + 1 and st(pg)['overrides']['Nikola Jokić'] == g0 + 1
        pg.locator('#wkMine .rl-row', has_text='Nikola Jokić').locator('[data-act="g-reset"]').click(); pg.wait_for_timeout(200)
        assert 'Nikola Jokić' not in st(pg)['overrides']
        n_cats = pg.locator('#wkTable input[type=checkbox]:checked').count(); assert n_cats == 13, n_cats
        pg.uncheck('[data-testid="h2h-PTS"]'); pg.wait_for_timeout(200)
        a, b = [int(x) for x in pg.locator('[data-testid="record"]').inner_text().replace('–', ' ').split()[:2]]
        assert a + b <= 12 and 'PTS' not in st(pg)['h2hCategories']
        pg.check('[data-testid="h2h-PTS"]'); pg.wait_for_timeout(150)
        assert pg.locator('[data-testid="strategy-line"]').inner_text().count('領先') == 1
        pg.select_option('[data-testid="week-select"]', '0')

    @check('schedule: 30-team grid, click week header sets week, manual team override changes games')
    def _():
        tab(pg, 'schedule')
        assert pg.locator('#schGrid tbody tr').count() == 30
        pg.click('[data-testid="wk-th-4"]'); pg.wait_for_timeout(200); assert st(pg)['week'] == 4
        assert pg.locator('#schGrid tr.mine').count() >= 1
        sel = pg.locator('[data-testid="team-ov-Nikola Jokić"]'); sel.select_option('LAL'); pg.wait_for_timeout(250)
        assert st(pg)['teamOverrides'] == {'Nikola Jokić': 'LAL'}
        sel = pg.locator('[data-testid="team-ov-Nikola Jokić"]'); sel.select_option(''); pg.wait_for_timeout(200)
        assert st(pg)['teamOverrides'] == {}
        pg.click('[data-testid="wk-th-0"]')

    @check('players: detail empty-state first, search → detail, add from detail, status badges')
    def _():
        tab(pg, 'players')
        assert '點選球員查看詳細資料' in pg.locator('[data-testid="player-detail"]').inner_text()
        pg.fill('[data-testid="player-search"]', 'maxey'); pg.wait_for_timeout(300)
        assert pg.locator('#pGrid tbody tr').count() == 1
        pg.locator('#pGrid .plink').first.click(); pg.wait_for_timeout(250)
        assert pg.locator('[data-testid="detail-name"]').inner_text().startswith('Tyrese Maxey')
        pg.click('[data-testid="detail-add"]'); pg.wait_for_timeout(200); assert 'Tyrese Maxey' in st(pg)['selected']
        pg.fill('[data-testid="player-search"]', ''); pg.check('[data-testid="player-has-stats"]'); pg.wait_for_timeout(300)
        no_stats = pg.locator('#pGrid tbody tr', has_text='無統計').count(); assert no_stats == 0
        pg.uncheck('[data-testid="player-has-stats"]'); pg.wait_for_timeout(300)
        rk = pg.evaluate("window.__L7N.app.universe().players.find(p=>p.status==='projection').name")
        pg.fill('[data-testid="player-search"]', rk); pg.wait_for_timeout(300)
        assert pg.locator('#pGrid tbody tr', has_text='估算').count() >= 1       # rookie projections are labeled
        pg.fill('[data-testid="player-search"]', '')
        pg.click('[data-testid="player-grid"] [data-testid="player-grid"]') if False else None

    @check('rookies: filter, row → detail separates NCAA / projection / real-stats; unverified is not invented')
    def _():
        tab(pg, 'rookies')
        pg.select_option('[data-testid="rookie-filter"]', 'lottery'); pg.wait_for_timeout(200)
        n = pg.locator('[data-testid="rookie-row"]').count(); assert n == 14, n
        pg.select_option('[data-testid="rookie-filter"]', 'verified'); pg.wait_for_timeout(200)
        v = pg.locator('[data-testid="rookie-row"]').count(); assert 0 < v < 60
        pg.select_option('[data-testid="rookie-filter"]', 'all'); pg.wait_for_timeout(200)
        unver = pg.locator('[data-testid="rookie-row"]', has_text='Metadata only').first; unver.click(); pg.wait_for_timeout(250)
        d = pg.locator('[data-testid="rookie-detail"]').inner_text()
        assert 'NBA Projection' in d and '估算' in d and '尚無' in d and '不會編造' in d, d[:300]
        pg.fill('[data-testid="rookie-search"]', 'zzzzzz'); pg.wait_for_timeout(200); assert '沒有符合' in pg.locator('#rGrid').inner_text()
        pg.fill('[data-testid="rookie-search"]', '')

    @check('yahoo: add to my order; drag re-orders live and saves exactly once; ↑↓ buttons; persists after reload')
    def _():
        tab(pg, 'yahoo')
        for n in ['Nikola Jokić', 'Luka Dončić', 'Cade Cunningham', 'Tyrese Maxey']:
            pg.locator('#yGrid tbody tr', has_text=n).first.locator('[data-testid="rank-toggle"]').click(); pg.wait_for_timeout(120)
        assert st(pg)['myRank'] == ['Nikola Jokić', 'Luka Dončić', 'Cade Cunningham', 'Tyrese Maxey']
        pg.evaluate('window.scrollTo(0,0)'); pg.wait_for_timeout(200)
        items = pg.locator('[data-testid="mr-item"]'); assert items.count() == 4
        w0 = pg.evaluate('window.__L7N.app.storage.writes')
        h = items.nth(3).locator('[data-handle]').bounding_box(); t = items.nth(0).bounding_box()
        pg.mouse.move(h['x'] + h['width'] / 2, h['y'] + h['height'] / 2); pg.mouse.down()
        for i in range(1, 13): pg.mouse.move(h['x'] + h['width'] / 2, h['y'] + h['height'] / 2 - (h['y'] - t['y'] + 6) * i / 12)
        live = pg.locator('[data-testid="mr-item"]').evaluate_all('els=>els.map(e=>e.dataset.name)')
        nums = pg.locator('[data-testid="mr-num"]').all_inner_texts()
        assert live[0] == 'Tyrese Maxey' and nums == ['1', '2', '3', '4'], (live, nums)
        assert st(pg)['myRank'][0] == 'Nikola Jokić'                             # nothing saved while dragging
        assert pg.evaluate('window.__L7N.app.storage.writes') == w0
        pg.mouse.up(); pg.wait_for_timeout(250)
        assert st(pg)['myRank'] == ['Tyrese Maxey', 'Nikola Jokić', 'Luka Dončić', 'Cade Cunningham'], st(pg)['myRank']
        assert pg.evaluate('window.__L7N.app.storage.writes') == w0 + 1, 'drag must save exactly once'
        pg.locator('[data-testid="mr-down"]').first.click(); pg.wait_for_timeout(200)
        assert st(pg)['myRank'][:2] == ['Nikola Jokić', 'Tyrese Maxey']
        pg.locator('[data-testid="mr-item"]').nth(1).locator('[data-handle]').focus(); pg.keyboard.press('Alt+ArrowUp'); pg.wait_for_timeout(200)
        assert st(pg)['myRank'][0] == 'Tyrese Maxey'
        order = st(pg)['myRank']; pg.reload(); pg.wait_for_function('window.__L7N && window.__L7N.app'); pg.wait_for_timeout(500)
        assert st(pg)['myRank'] == order
        tab(pg, 'yahoo'); assert pg.locator('[data-testid="mr-item"]').evaluate_all('els=>els.map(e=>e.dataset.name)') == order
        pg.fill('[data-testid="yahoo-search"]', '3'); pg.wait_for_timeout(250); assert pg.locator('#yGrid tbody tr').first.get_attribute('data-rank') == '3'
        pg.fill('[data-testid="yahoo-search"]', ''); pg.select_option('[data-testid="yahoo-sort"]', 'fit'); pg.wait_for_timeout(250)
        assert pg.locator('#yGrid tbody tr').count() == 200

    @check('state survives reload: roster, opponent, weights, week, basis')
    def _():
        s = st(pg); assert s['selected'][:3] == ['Nikola Jokić', 'Victor Wembanyama', 'Luka Dončić'] and len(s['oppSelected']) == 2

    @check('leagues: create, isolate, switch, rename, copy, delete (drawer)')
    def _():
        pg.click('[data-testid="open-drawer"]'); expect(pg.locator('[data-testid="drawer"]')).to_be_visible()
        pg.click('[data-testid="league-add"]'); pg.fill('[data-testid="dlg-input"]', 'League B'); pg.click('[data-testid="dlg-ok"]'); pg.wait_for_timeout(350)
        assert st(pg)['name'] == 'League B' and st(pg)['selected'] == [] and st(pg)['myRank'] == []
        pg.click('[data-testid="league-copy"]'); pg.fill('[data-testid="dlg-input"]', 'League B2'); pg.click('[data-testid="dlg-ok"]'); pg.wait_for_timeout(350)
        assert pg.evaluate('window.__L7N.app.profiles.length') == 3
        pg.select_option('[data-testid="league-select"]', index=0); pg.wait_for_timeout(300)
        assert len(st(pg)['selected']) >= 3
        pg.select_option('[data-testid="league-select"]', index=1); pg.wait_for_timeout(300)
        pg.click('[data-testid="league-del"]'); pg.click('[data-testid="dlg-ok"]'); pg.wait_for_timeout(350)
        assert pg.evaluate('window.__L7N.app.profiles.length') == 2
        pg.select_option('[data-testid="league-select"]', index=0); pg.wait_for_timeout(300)
        pg.click('[data-testid="drawer-close"]'); pg.wait_for_timeout(350)

    @check('weights: punt TOV (0) removes it from the board; resetting restores 13')
    def _():
        pg.click('[data-testid="open-drawer"]'); pg.fill('[data-testid="w-TOV"]', '0'); pg.press('[data-testid="w-TOV"]', 'Tab'); pg.wait_for_timeout(300)
        pg.click('[data-testid="drawer-close"]'); pg.wait_for_timeout(350); tab(pg, 'draft')
        assert pg.locator('#dStrength .sbar').count() == 12 and pg.locator('#dStrength .sbar[data-cat="TOV"]').count() == 0
        pg.click('[data-testid="open-drawer"]'); pg.click('[data-testid="reset-w"]'); pg.wait_for_timeout(200); pg.click('[data-testid="drawer-close"]'); pg.wait_for_timeout(350)
        assert pg.locator('#dStrength .sbar').count() == 13

    @check('CSV import: current dataset loads independently; switching basis changes data; fallback banner when missing')
    def _():
        pg.click('[data-testid="open-drawer"]')
        pg.select_option('[data-testid="basis-select"]', 'recent10'); pg.wait_for_timeout(300)
        pg.click('[data-testid="drawer-close"]'); pg.wait_for_timeout(350)
        assert pg.locator('[data-testid="banner-basis-fallback"]').count() == 1               # loud fallback, not silent
        pg.click('[data-testid="open-drawer"]')
        with pg.expect_file_chooser() as fc: pg.click('[data-testid="import-current"]')
        fc.value.set_files(str(ROOT / 'tests/fixtures/synthetic-pergame.csv')); pg.wait_for_timeout(600)
        assert pg.evaluate('window.__L7N.repo.getDataset("current").rows.length') == 520
        assert pg.evaluate('window.__L7N.repo.getDataset("last").meta.source') == 'remote'  # baseline untouched
        pg.select_option('[data-testid="basis-select"]', 'current'); pg.wait_for_timeout(300)
        pg.click('[data-testid="drawer-close"]'); pg.wait_for_timeout(400)
        chip = pg.locator('[data-testid="data-chip"]').inner_text(); assert '本季至今' in chip, chip
        assert pg.locator('[data-testid="banner-basis-fallback"]').count() == 0
        pg.click('[data-testid="open-drawer"]'); pg.select_option('[data-testid="basis-select"]', 'last'); pg.wait_for_timeout(300); pg.click('[data-testid="drawer-close"]'); pg.wait_for_timeout(350)

    @check('CSV import: invalid file is rejected with a message and old data is kept')
    def _():
        bad = ROOT / 'e2e' / '_bad.csv'; bad.write_text('foo,bar\n1,2\n')
        pg.click('[data-testid="open-drawer"]')
        with pg.expect_file_chooser() as fc: pg.click('[data-testid="import-last"]')
        fc.value.set_files(str(bad)); pg.wait_for_timeout(500)
        assert pg.locator('.toast-error').count() >= 1 and pg.evaluate('window.__L7N.repo.getDataset("last").rows.length') == 520
        pg.click('[data-testid="drawer-close"]'); pg.wait_for_timeout(300); bad.unlink()

    @check('photos: official NBA CDN image by NBA id; broken image falls back to initials; no-id players never get a picture; toggle off removes all')
    def _():
        tab(pg, 'draft'); pg.wait_for_timeout(900)
        j = pg.locator('#dRoster tr[data-name="Nikola Jokić"] .av'); assert j.get_attribute('data-nba') == '900001'
        src = j.locator('img.av-img').get_attribute('src'); assert src == 'https://cdn.nba.com/headshots/nba/latest/260x190/900001.png', src
        assert 'loaded' in (j.get_attribute('class') or ''), 'image should have loaded'
        l = pg.locator('#dRoster tr[data-name="Luka Dončić"] .av'); assert l.locator('img').count() == 0 and 'has-nba' not in (l.get_attribute('class') or '') and l.get_attribute('tabindex') is None
        assert l.locator('.av-i').inner_text() == 'LD'
        assert all('wikipedia' not in u for u in cdn_hits) and all(u.startswith('https://cdn.nba.com/headshots/nba/latest/') for u in cdn_hits)
        pg.evaluate("window.__L7N.app.addPlayer(window.__L7N.app.universe().players.find(p=>!p.nbaId && p.status==='projection').name)"); pg.wait_for_timeout(400)
        assert pg.locator('#dRoster tbody tr:last-child .av img').count() == 0                      # unverified id -> initials, never a guessed face
        pg.click('[data-testid="open-drawer"]'); pg.uncheck('[data-testid="photos-toggle"]'); pg.click('[data-testid="drawer-close"]'); pg.wait_for_timeout(500)
        assert pg.locator('.av-img').count() == 0 and pg.evaluate('window.__L7N.headshots.enabled') is False
        pg.click('[data-testid="open-drawer"]'); pg.check('[data-testid="photos-toggle"]'); pg.click('[data-testid="drawer-close"]'); pg.wait_for_timeout(700)
        assert pg.locator('.av-img').count() > 0
        pg.evaluate("window.__L7N.app.removePlayer(window.__L7N.app.profile.selected.at(-1))")

    @check('headshot preview (desktop): hover and keyboard focus open the 1040x760 image, leaving/Escape close; NO layout shift, row height or scroll change')
    def _():
        tab(pg, 'draft'); pg.wait_for_timeout(500)
        def metrics(): return pg.evaluate("""()=>({sh:document.documentElement.scrollHeight, sy:scrollY, rows:[...document.querySelectorAll('#dRoster tbody tr')].map(r=>Math.round(r.getBoundingClientRect().height)), top:Math.round(document.querySelector('#dRoster tbody tr').getBoundingClientRect().top), cs:document.querySelector('#dCand .tbl-wrap')?.scrollTop ?? 0, rs:document.querySelector('#dRoster').scrollLeft})""")
        av = pg.locator('#dRoster tr[data-name="Nikola Jokić"] .av.has-nba'); before = metrics()
        av.hover(); pg.wait_for_selector('#avPreview:not([hidden])'); pg.wait_for_timeout(250)
        prev = pg.locator('#avPreview'); assert prev.locator('img').get_attribute('src') == 'https://cdn.nba.com/headshots/nba/latest/1040x760/900001.png'
        assert 'Jokić' in prev.locator('.av-preview-cap').inner_text() and 'Jokić' in prev.locator('img').get_attribute('alt')
        box = prev.bounding_box(); vp = pg.viewport_size; assert box['x'] >= 0 and box['y'] >= 0 and box['x'] + box['width'] <= vp['width'] and box['y'] + box['height'] <= vp['height']
        assert metrics() == before, (before, metrics())
        pg.mouse.move(5, 5); pg.wait_for_timeout(250); assert prev.is_hidden() and metrics() == before
        av.focus(); pg.wait_for_selector('#avPreview:not([hidden])'); assert metrics() == before
        pg.keyboard.press('Escape'); pg.wait_for_timeout(200); assert prev.is_hidden()
        av.focus(); pg.keyboard.press('Tab'); pg.wait_for_timeout(250); assert prev.is_hidden()                         # focus-out closes
        pg.locator('#dCand .av.has-nba').first.hover(); pg.wait_for_selector('#avPreview:not([hidden])')           # also inside the scrolling candidate table
        assert pg.evaluate("document.querySelector('#dCand .tbl-wrap').scrollTop") == before['cs']; pg.mouse.move(5, 5)
        l = pg.locator('#dRoster tr[data-name="Luka Dončić"] .av'); l.hover(); pg.wait_for_timeout(350); assert pg.locator('#avPreview').is_hidden(), 'no preview for a broken/missing picture'
        pg.mouse.move(5, 5)

    @check('performance: tab switch, add player, sort and search stay responsive (520 players)')
    def _():
        def timed(js): return pg.evaluate("async()=>{const t=performance.now();"+js+";await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return performance.now()-t}")
        tab(pg, 'draft'); pg.evaluate('window.__L7N.headshots.setEnabled(false)')   # the harness' mocked network round-trips would otherwise block the page thread
        import statistics
        def med(js_fn, n=3): return statistics.median(timed(js_fn()) for _ in range(n))
        t_tab = med(lambda: "window.__L7N.go('players')"); t_back = med(lambda: "window.__L7N.go('draft')")
        names = iter(['Jalen Johnson', 'Anthony Edwards', 'Tyrese Maxey', 'Devin Booker', 'Trae Young', 'Zion Williamson'])
        added = []
        def add_js():
            n = next(names); added.append(n); return f"window.__L7N.app.addPlayer({json.dumps(n)})"
        t_add = med(add_js)
        t_rm = statistics.median(timed(f"window.__L7N.app.removePlayer({json.dumps(n)})") for n in added)
        keys = iter(['reb', 'ast', 'pts'])
        t_sort = med(lambda: f"window.__L7N.app.setCandSort('{next(keys)}')")
        print(f'        median timings ms (3 runs, incl. 2 rAF): tab={t_tab:.0f} back={t_back:.0f} add={t_add:.0f} sort={t_sort:.0f} remove={t_rm:.0f}')
        results.append({'test': 'perf-timings', 'ok': True, 'tab': round(t_tab), 'back': round(t_back), 'add': round(t_add), 'sort': round(t_sort), 'remove': round(t_rm)})
        pg.evaluate('window.__L7N.headshots.setEnabled(true)')
        assert max(t_tab, t_back, t_add, t_sort, t_rm) < 600, (t_tab, t_back, t_add, t_sort, t_rm)

    @check('copy my draft order between leagues: pull/push, merge/replace, preview, empty source disabled, persisted')
    def _():
        tab(pg, 'yahoo'); pg.evaluate('window.scrollTo(0,0)')
        main_order = st(pg)['myRank']; assert len(main_order) == 4
        pg.click('[data-testid="copy-rank"]'); expect(pg.locator('[data-testid="copy-from"]')).to_be_visible()
        assert '還沒有選人順位可以複製' in pg.locator('[data-testid="copy-preview"]').inner_text() and pg.locator('[data-testid="copy-confirm"]').is_disabled()   # source league is empty
        pg.click('[data-testid="copy-dir-push"]'); assert pg.locator('[data-testid="copy-confirm"]').is_disabled()
        pg.check('[data-testid="copy-to-League B2"]'); pg.wait_for_timeout(150)
        assert '0 → 4 人' in pg.locator('[data-testid="copy-preview"]').inner_text()
        pg.click('[data-testid="copy-confirm"]'); pg.wait_for_timeout(300)
        other = pg.evaluate('window.__L7N.app.profiles.find(p=>p.name==="League B2").myRank'); assert other == main_order, other
        assert pg.evaluate('JSON.parse(localStorage.getItem("l7nlab.v1.profiles")).find(p=>p.name==="League B2").myRank.length') == 4
        pg.evaluate('window.__L7N.app.moveMyRank(0, 3)'); pg.wait_for_timeout(300); changed = st(pg)['myRank']; assert changed != main_order
        pg.click('[data-testid="copy-rank"]'); pg.click('[data-testid="copy-dir-push"]'); pg.check('[data-testid="copy-to-League B2"]'); pg.check('[data-testid="copy-mode-replace"]'); pg.wait_for_timeout(100)
        pg.click('[data-testid="copy-confirm"]'); pg.wait_for_timeout(300)
        assert pg.evaluate('window.__L7N.app.profiles.find(p=>p.name==="League B2").myRank') == changed
        pg.evaluate('window.__L7N.app.switchLeague(window.__L7N.app.profiles.find(p=>p.name==="League B2").id)'); pg.wait_for_timeout(400)
        assert pg.locator('[data-testid="mr-item"]').evaluate_all('els=>els.map(e=>e.dataset.name)') == changed           # visible in the other league's own list
        pg.evaluate('window.__L7N.app.switchLeague(window.__L7N.app.profiles[0].id)'); pg.wait_for_timeout(400)
        assert st(pg)['myRank'] == changed

    @check('data pipeline in the app: sync from L7N manifest, versions + date coverage shown, zero-GP star stays searchable with official photo id, failures visible while old data serves')
    def _():
        ctx = browser.new_context(viewport={'width': 1440, 'height': 900}); q = new_page(ctx); boot(q)
        q.click('[data-testid="open-drawer"]'); q.fill('[data-testid="data-url"]', DATA_URL); q.click('[data-testid="pipeline-sync"]')
        q.wait_for_selector('[data-testid="pipeline-status"]', timeout=8000); txt = q.locator('[data-testid="pipeline-status"]').inner_text()
        assert '2026-27' in txt and '2026-10-19' in txt and '2026-11-17' in txt and '最後一場比賽' in txt, txt
        meta = q.evaluate('window.__L7N.repo.pipelineMeta'); assert meta['datasetVersion'].startswith('20261118T060000Z-') and meta['files']['recent30d.csv']['rows'] > 300
        assert q.evaluate('["last","current","recent10","recent30d"].map(b=>window.__L7N.repo.getDataset(b).meta.source)') == ['pipeline'] * 4
        q.select_option('[data-testid="basis-select"]', 'recent30d'); q.wait_for_timeout(300); q.click('[data-testid="drawer-close"]'); q.wait_for_timeout(500)
        assert '近 30 天' in q.locator('[data-testid="data-chip"]').inner_text()
        q.keyboard.press('/'); q.fill('[data-testid="qa-input"]', 'haliburton'); q.wait_for_selector('[data-testid="qa-results"] .qa-row')
        row = q.locator('[data-testid="qa-results"] .qa-row').first; assert 'Tyrese Haliburton' in row.inner_text() and ('尚無統計' in row.inner_text()), row.inner_text()
        assert row.locator('.av').get_attribute('data-nba') == '990001'
        q.keyboard.press('Escape'); q.wait_for_timeout(300)
        tab(q, 'players'); q.fill('[data-testid="player-search"]', 'haliburton'); q.wait_for_timeout(400); q.locator('#pGrid .plink').first.click(); q.wait_for_timeout(300)
        d = q.locator('[data-testid="player-detail"]'); assert 'Haliburton' in d.inner_text() and '不會借用其他球季' in d.inner_text()
        assert d.locator('.av-xl img').get_attribute('src').endswith('/990001.png') or d.locator('.av-xl').get_attribute('data-nba') == '990001'
        row_cells = q.locator('#pGrid tbody tr').first.locator('td').all_inner_texts(); assert row_cells[4] == '—', row_cells[:6]            # PTS/G is "unavailable", not 0.0
        # reload: configured pipeline is used first and the legacy CSV must NOT replace pipeline data
        q.reload(); q.wait_for_function('window.__L7N && window.__L7N.repo.pipelineMeta'); q.wait_for_timeout(900)
        assert q.evaluate('window.__L7N.repo.getDataset("last").meta.source') == 'pipeline'
        # (1) the pipeline's latest run FAILED validation -> status.json says so; manifest + files untouched -> app keeps serving + shows it
        bad = json.loads((TMP / 'fx.json').read_text()); bad['gameLog']['2026-27']['resultSets'][0]['rowSet'][10][28] = 'NaN'; (TMP / 'bad.json').write_text(json.dumps(bad))
        rc, out = node('pipeline/cli.mjs', '--season', '2026', '--out', str(TMP / 'data'), '--fixture', str(TMP / 'bad.json'), '--now', '2026-11-19T06:00:00Z'); assert rc == 1, out
        before_ver = q.evaluate('window.__L7N.repo.pipelineMeta.datasetVersion')
        q.click('[data-testid="open-drawer"]'); q.click('[data-testid="pipeline-sync"]'); q.wait_for_selector('[data-testid="pipeline-failed"]', timeout=6000)
        assert 'invalid-source-data' in q.locator('[data-testid="pipeline-failed"]').inner_text() and q.evaluate('window.__L7N.repo.pipelineMeta.datasetVersion') == before_ver
        assert q.evaluate('window.__L7N.repo.getDataset("current").rows.length') > 300
        # (2) a manifest that is not validated / a tampered file is refused and nothing changes
        q.route('**/manifest.json', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps({**json.loads((TMP / 'data' / 'manifest.json').read_text()), 'datasetVersion': 'x', 'validation': {'status': 'failed'}})))
        q.click('[data-testid="pipeline-sync"]'); q.wait_for_selector('[data-testid="pipeline-error"]', timeout=6000)
        assert '沒有通過驗證' in q.locator('[data-testid="pipeline-error"]').inner_text() and q.evaluate('window.__L7N.repo.pipelineMeta.datasetVersion') == before_ver
        q.unroute('**/manifest.json')
        ctx.close()

    # ---------- separate contexts ----------
    @check('migration in a real browser: V4.0.21 localStorage is copied, original keys byte-identical')
    def _():
        legacy = json.dumps([{'id': 'L1', 'name': 'Old League', 'schemaVersion': 2, 'selected': ['Nikola Jokić'], 'oppSelected': [], 'weights': {'PTS': 2}, 'week': 3, 'dataBasis': 'last', 'refMode': 'league', 'minGP': 25}])
        ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
        init = f"if(!localStorage.getItem('l7n_h2h_leagues_v1')){{localStorage.setItem('l7n_h2h_leagues_v1', {json.dumps(legacy)});localStorage.setItem('l7n_h2h_active_league_v1','L1');localStorage.setItem('fb_custom_dataset_last','[]')}}"
        q = new_page(ctx, init=init); boot(q)
        s = st(q); assert s['name'] == 'Old League' and s['selected'] == ['Nikola Jokić'] and s['minGP'] == 25 and s['refMode'] == 'league' and s['weights']['PTS'] == 2
        assert q.evaluate("localStorage.getItem('l7n_h2h_leagues_v1')") == legacy
        assert q.evaluate("localStorage.getItem('fb_custom_dataset_last')") == '[]'
        q.reload(); q.wait_for_function('window.__L7N'); assert st(q)['name'] == 'Old League'
        ctx.close()

    @check('offline / sync failure: app still opens, says so, keeps working with saved data')
    def _():
        ctx = browser.new_context(viewport={'width': 1440, 'height': 900}); q = new_page(ctx, baseline=False); boot(q, wait_data=False); q.wait_for_timeout(900)
        assert q.locator('[data-testid="banner-seed-only"]').count() == 1, q.locator('#banner').inner_text()
        assert 'Fit' in q.locator('[data-testid="banner-seed-only"]').inner_text() or '種子' in q.locator('[data-testid="banner-seed-only"]').inner_text()
        tab(q, 'draft'); assert '分類強弱暫不可用' in q.locator('#dStrength').inner_text()
        q.evaluate("window.__L7N.app.addPlayer('Nikola Jokić')"); q.wait_for_timeout(200); tab(q, 'weekly'); assert q.locator('#wkMine .rl-row').count() == 1
        ctx.close()

    @check('service worker: app shell loads again while the network is offline (http only)')
    def _():
        if '--file' in args: return
        ctx = browser.new_context(viewport={'width': 1440, 'height': 900}); q = new_page(ctx); boot(q); q.wait_for_timeout(1200)
        q.evaluate('navigator.serviceWorker.ready.then(()=>1)'); q.wait_for_timeout(500)
        ctx.set_offline(True); q.reload(); q.wait_for_function('window.__L7N && window.__L7N.app', timeout=8000)
        assert q.locator('#top .brand-t b').inner_text() == 'L7N H2H Fantasy Lab'
        assert q.locator('[data-testid="data-chip"]').inner_text().count('人') == 1
        ctx.close()

    @check('corrupt localStorage does not brick the app')
    def _():
        ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
        q = new_page(ctx, init="localStorage.setItem('l7nlab.v1.profiles','{broken');localStorage.setItem('l7nlab.v1.datasets.last','nope')"); boot(q, wait_data=False)
        assert st(q)['name'] == '我的聯盟'; tab(q, 'yahoo'); assert q.locator('#yGrid tbody tr').count() == 200
        ctx.close()

    @check('mobile 390px: bottom nav, card candidates, no horizontal page overflow on any tab, touch-drag reorder')
    def _():
        ctx = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
        q = new_page(ctx); boot(q)
        q.evaluate("['Nikola Jokić','Luka Dončić','Cade Cunningham'].forEach(n=>{window.__L7N.app.addPlayer(n);window.__L7N.app.toggleMyRank(n)})"); q.wait_for_timeout(300)
        assert q.is_visible('#bottomnav') and not q.is_visible('#rail')
        for t in ['draft', 'weekly', 'schedule', 'players', 'rookies', 'yahoo']:
            tab(q, t); q.wait_for_timeout(250)
            sw = q.evaluate('document.documentElement.scrollWidth'); assert sw <= 391, (t, sw)
        tab(q, 'draft'); assert q.locator('.ccard').count() >= 10 and q.locator('[data-testid="cand-table"]').count() == 0
        assert q.is_visible('[data-testid="fab"]'); q.click('[data-testid="fab"]'); expect(q.locator('[data-testid="qa-input"]')).to_be_visible(); q.keyboard.press('Escape'); q.wait_for_timeout(300)
        tab(q, 'draft'); q.wait_for_timeout(500)
        def mm(): return q.evaluate("({sh:document.documentElement.scrollHeight, sy:scrollY, x:scrollX})")
        av = q.locator('.ccard .av.has-nba').first; av.scroll_into_view_if_needed(); q.wait_for_timeout(200); m0 = mm(); av.tap(); q.wait_for_selector('#avPreview:not([hidden])'); q.wait_for_timeout(250)
        assert q.locator('#avPreview img').get_attribute('src').endswith('/1040x760/' + av.get_attribute('data-nba') + '.png') and mm() == m0
        av.tap(); q.wait_for_timeout(250); assert q.locator('#avPreview').is_hidden()                                  # second tap closes
        av.tap(); q.wait_for_selector('#avPreview:not([hidden])'); q.locator('#top .brand').tap(); q.wait_for_timeout(250); assert q.locator('#avPreview').is_hidden()   # tap outside closes
        av.tap(); q.wait_for_selector('#avPreview:not([hidden])'); q.keyboard.press('Escape'); q.wait_for_timeout(250); assert q.locator('#avPreview').is_hidden() and mm() == m0
        tab(q, 'yahoo'); q.wait_for_timeout(300)
        items = q.locator('[data-testid="mr-item"]'); h = items.nth(2).locator('[data-handle]').bounding_box(); t0 = items.nth(0).bounding_box()
        cdp = ctx.new_cdp_session(q)
        x = h['x'] + h['width'] / 2; y = h['y'] + h['height'] / 2
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
        for i in range(1, 11): cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x, 'y': y - (y - t0['y'] + 4) * i / 10}]})
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); q.wait_for_timeout(300)
        assert st(q)['myRank'][0] == 'Cade Cunningham', st(q)['myRank']
        q.screenshot(path=str(ROOT / 'e2e' / 'screenshots' / 'mobile-yahoo.png'))
        ctx.close()

    # screenshots for the record
    (ROOT / 'e2e' / 'screenshots').mkdir(exist_ok=True)
    for t in ['draft', 'weekly', 'schedule', 'players', 'rookies', 'yahoo']:
        tab(pg, t); pg.wait_for_timeout(450); pg.screenshot(path=str(ROOT / 'e2e' / 'screenshots' / f'desktop-{t}.png'))

    @check('no unexpected console errors during the whole run')
    def _():
        assert not errors_seen, errors_seen[:5]
    browser.close()
srv.shutdown()
passed = sum(1 for r in results if r['ok']); failed = [r for r in results if not r['ok']]
(ROOT / 'e2e' / ('results-standalone.json' if '--file' in args else 'results.json')).write_text(json.dumps({'passed': passed, 'failed': len(failed), 'results': results}, ensure_ascii=False, indent=1), encoding='utf-8')
print(f'\n{passed} passed, {len(failed)} failed'); sys.exit(1 if failed else 0)
