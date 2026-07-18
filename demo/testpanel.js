// coir × copse — in-browser test panel.
//
// Runs the SAME flow suite + coverage join the CI gate runs, but entirely client-side, against
// the live game on this page. copse's in-page engine (window.__copse, installed from
// copse.inject.js) does press/get/patch/clickSurface; the puppeteer/Node half is only transport,
// so none of it is needed here. subsetMatch (assertions) and coverageJoin are copse's own pure
// functions, inlined. Loaded on the deployed demo alongside copse.inject.js.
(function () {
  'use strict';

  // ── copse/src/script.js · subsetMatch (expected ⊆ actual) ───────────────────────────────
  function subsetMatch(expected, actual, path) {
    path = path || '';
    var at = path || '(root)';
    if (expected === null || typeof expected !== 'object')
      return expected === actual ? null : { path: at, expected: expected, actual: actual };
    if (Array.isArray(expected)) {
      if (!Array.isArray(actual)) return { path: at, expected: expected, actual: actual };
      for (var i = 0; i < expected.length; i++)
        if (!actual.some(function (a) { return !subsetMatch(expected[i], a); }))
          return { path: at + '[' + i + ']', expected: expected[i], actual: actual };
      return null;
    }
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual))
      return { path: at, expected: expected, actual: actual };
    for (var k in expected) if (Object.prototype.hasOwnProperty.call(expected, k)) {
      var m = subsetMatch(expected[k], actual[k], path ? path + '.' + k : k);
      if (m) return m;
    }
    return null;
  }

  // ── copse/src/coverage.js · coverageJoin (the coir × copse JOIN) ─────────────────────────
  var segs = function (p) { return String(p == null ? '' : p).split('/').filter(Boolean); };
  var nameOf = function (s) { return s.replace(/\[\d+\]$/, ''); };
  var MIN_FUZZY_TAIL = 2;
  function tailMatch(staticPath, runtimeRef) {
    var s = segs(staticPath), r = segs(runtimeRef);
    var n = Math.min(s.length, r.length);
    if (!n) return null;
    for (var k = 1; k <= n; k++) if (nameOf(s[s.length - k]) !== nameOf(r[r.length - k])) return null;
    if (n < MIN_FUZZY_TAIL && s.length !== r.length) return null;
    return { mount: r.slice(0, r.length - n).join('/'), dropped: s.slice(0, s.length - n).join('/') };
  }
  function coverageJoin(staticRows, runtimeRows) {
    var covered = [], blocked = [], unreached = [], ambiguous = [], uncertain = [], codeRegistered = [], codeOnly = [];
    var live = (runtimeRows || []).filter(Boolean);
    var exact = new Map(live.filter(function (r) { return r.method != null; }).map(function (r) { return [r.ref + ' ' + r.method, r]; }));
    var consumed = new Set();
    var claims = new Map();
    (staticRows || []).forEach(function (s) {
      if (!s || s.method == null) return;
      var hit = exact.get(s.nodePath + ' ' + s.method), via = 'exact', tail;
      if (!hit) {
        var cands = live.filter(function (r) { return r.method === s.method && tailMatch(s.nodePath, r.ref); });
        if (cands.length > 1) { ambiguous.push(Object.assign({}, s, { candidates: cands.map(function (c) { return c.ref; }), reason: 'fan-out' })); cands.forEach(function (c) { consumed.add(c); }); return; }
        if (cands.length === 1) { hit = cands[0]; via = 'prefix'; tail = tailMatch(s.nodePath, hit.ref); }
      }
      if (!hit) { unreached.push(s); return; }
      var arr = claims.get(hit); if (arr) arr.push({ s: s, via: via, tail: tail }); else claims.set(hit, [{ s: s, via: via, tail: tail }]);
    });
    claims.forEach(function (rows, hit) {
      consumed.add(hit);
      if (rows.length > 1) { rows.forEach(function (x) { ambiguous.push(Object.assign({}, x.s, { candidates: [hit.ref], reason: 'fan-in' })); }); return; }
      var s = rows[0].s, via = rows[0].via, tail = rows[0].tail;
      var row = via === 'prefix' ? Object.assign({}, s, { runtime: hit, via: via, mount: tail.mount, dropped: tail.dropped }) : Object.assign({}, s, { runtime: hit, via: via });
      if (hit.reachable === false || hit.interactable === false) blocked.push(row);
      else if (hit.reachable === 'unsure' || hit.occludedBy) uncertain.push(row);
      else covered.push(row);
    });
    live.forEach(function (r) { if (consumed.has(r)) return; if (r.codeHandlers && r.codeHandlers.length) codeRegistered.push(r); else codeOnly.push(r); });
    return { covered: covered, blocked: blocked, unreached: unreached, ambiguous: ambiguous, uncertain: uncertain, codeRegistered: codeRegistered, codeOnly: codeOnly };
  }

  // ── in-page driver over __copse (the ops the flow scripts use) ───────────────────────────
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var cc = function () { return window.cc; };
  function sceneLive() { try { var s = cc().director.getScene(); return !!(s && (s.children || []).length); } catch (e) { return false; } }
  async function waitLive(ms) { var t = Date.now() + (ms || 15000); while (Date.now() < t) { if (sceneLive()) return true; await sleep(120); } return sceneLive(); }
  function ensureCopse() { if (!window.__copse && window.copse) try { window.copse.install(window.cc); } catch (e) {} return !!window.__copse; }
  async function reset() {
    // reload the scene for test isolation (mirrors copse run's reload between scripts): a fresh
    // component instance drops the previous script's RNG patches and combat state.
    try { var n = cc().director.getScene().name; cc().director.loadScene(n); }
    catch (e) { try { cc().game.restart(); } catch (e2) {} }
    await sleep(120); await waitLive(); ensureCopse();
  }
  async function runStep(step) {
    if (step.op === 'sleep') { await sleep(step.ms || 0); return { ok: true }; }
    var K = window.__copse, result;
    try {
      switch (step.op) {
        case 'patch': result = K.patch(step.sel, step.hooks || {}); break;
        case 'press': result = K.press(step.ref, step.opts || {}); break;
        case 'get': result = K.get(step.sel); break;
        case 'eval': result = { ok: true, value: (0, eval)(step.expr) }; break;   // in-page: cc/window in scope
        case 'clickSurface': result = { ok: true, rows: K.clickSurface(step.opts || {}) }; break;
        default: result = { ok: false, reason: 'unknown-op', op: step.op };
      }
      result = await result;
    } catch (e) { result = { ok: false, reason: 'threw', error: String((e && e.message) || e) }; }
    var ok = true, mismatch = null;
    if (step.expect !== undefined) { mismatch = subsetMatch(step.expect, result); ok = !mismatch; }
    else if (result && result.ok === false) ok = false;
    return { ok: ok, result: result, mismatch: mismatch };
  }
  async function runScript(script) {
    var steps = [], pass = true, failedAt = -1;
    for (var i = 0; i < script.steps.length; i++) {
      var r = await runStep(script.steps[i]);
      steps.push({ step: script.steps[i], ok: r.ok, result: r.result, mismatch: r.mismatch });
      if (!r.ok) { pass = false; failedAt = i; break; }
    }
    if (!steps.length) pass = false;
    return { pass: pass, failedAt: failedAt, steps: steps };
  }

  var TESTS = ['1-green-combat.json', '2-floor-desync-tripwire.json', '3-defeat-keeps-tally-tripwire.json', '4-menu-close-disabled-tripwire.json'];
  async function loadJSON(u) { var r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error(u + ' → ' + r.status); return r.json(); }

  async function runSuite(cb) {
    if (!ensureCopse()) throw new Error('copse engine not installed (window.copse missing)');
    await reset();
    var rows = await loadJSON('coir-rows.json');
    var cov = coverageJoin(rows, window.__copse.clickSurface());
    cb.coverage(rows, cov);
    var tests = await Promise.all(TESTS.map(function (f) { return loadJSON('tests/' + f).then(function (j) { return { file: f, name: j.name || f, script: j }; }); }));
    var passed = 0;
    for (var i = 0; i < tests.length; i++) {
      cb.running(tests[i]);
      await reset();
      var res = await runScript(tests[i].script);
      if (res.pass) passed++;
      cb.script(tests[i], res);
    }
    cb.summary(passed, tests.length);
    await reset();               // leave the game clean + playable
    return { passed: passed, total: tests.length, coverage: cov, rows: rows };
  }

  // ── panel UI ─────────────────────────────────────────────────────────────────────────────
  var css = '\
  #ccpanel{position:fixed;top:12px;right:12px;z-index:99999;width:300px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow:auto;\
    font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#e6edf3;background:rgba(13,17,23,.94);\
    border:1px solid #30363d;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.5);backdrop-filter:blur(3px)}\
  #ccpanel .hd{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #21262d;position:sticky;top:0;background:inherit}\
  #ccpanel .hd b{font-size:12px;letter-spacing:.02em}#ccpanel .hd .x{margin-left:auto;cursor:pointer;color:#8b949e;padding:2px 6px;border-radius:6px}\
  #ccpanel .hd .x:hover{background:#21262d;color:#e6edf3}\
  #ccpanel .bd{padding:10px 12px}\
  #ccpanel button.run{width:100%;padding:9px;border:0;border-radius:8px;background:#238636;color:#fff;font:600 13px ui-monospace,monospace;cursor:pointer}\
  #ccpanel button.run:hover{background:#2ea043}#ccpanel button.run:disabled{opacity:.6;cursor:default}\
  #ccpanel .sec{margin-top:12px}#ccpanel .sec h4{margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#8b949e;font-weight:600}\
  #ccpanel .row{display:flex;gap:8px;padding:3px 0;align-items:baseline}#ccpanel .row .ic{width:14px;flex:0 0 14px;text-align:center}\
  #ccpanel .k{color:#7ee787}#ccpanel .r{color:#ff7b72}#ccpanel .m{color:#d29922}#ccpanel .dim{color:#8b949e}\
  #ccpanel .cov{background:#161b22;border:1px solid #21262d;border-radius:8px;padding:8px 10px;white-space:pre-wrap;color:#c9d1d9}\
  #ccpanel .sum{margin-top:12px;padding:8px 10px;border-radius:8px;text-align:center;font-weight:600}\
  #ccpanel .sum.ok{background:rgba(35,134,54,.18);border:1px solid #238636;color:#7ee787}\
  #ccpanel .sum.bad{background:rgba(248,81,73,.15);border:1px solid #da3633;color:#ff7b72}\
  #ccopen{position:fixed;top:12px;right:12px;z-index:99999;padding:8px 12px;border:1px solid #30363d;border-radius:8px;\
    background:rgba(13,17,23,.94);color:#e6edf3;font:600 12px ui-monospace,monospace;cursor:pointer;display:none}';

  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  function mount() {
    var style = el('style'); style.textContent = css; document.head.appendChild(style);
    var openBtn = el('button', null, '▶ Tests'); openBtn.id = 'ccopen';
    var p = el('div'); p.id = 'ccpanel';
    var hd = el('div', 'hd'); hd.appendChild(el('b', null, 'coir × copse')); var badge = el('span', 'dim', 'live in-browser suite'); badge.style.fontSize = '10px'; hd.appendChild(badge);
    var x = el('span', 'x', '–'); hd.appendChild(x); p.appendChild(hd);
    var bd = el('div', 'bd'); p.appendChild(bd);
    var btn = el('button', 'run', '▶ Run the suite'); bd.appendChild(btn);
    var out = el('div'); bd.appendChild(out);
    document.body.appendChild(openBtn); document.body.appendChild(p);
    x.onclick = function () { p.style.display = 'none'; openBtn.style.display = 'block'; };
    openBtn.onclick = function () { p.style.display = ''; openBtn.style.display = 'none'; };

    var sec = function (title) { var s = el('div', 'sec'); if (title) s.appendChild(el('h4', null, title)); out.appendChild(s); return s; };
    var covSec, scriptSec;
    var cb = {
      coverage: function (rows, cov) {
        covSec = sec('coverage — coir × copse join');
        var box = el('div', 'cov');
        var deadb = cov.codeOnly.map(function (r) { return r.ref + '::' + (r.method || 'null'); });
        box.textContent =
          'wired (coir)  ' + rows.length + '\n' +
          'covered       ' + cov.covered.length + '  ' + cov.covered.map(function (r) { return (r.runtime && r.runtime.ref || r.nodePath).split('/').pop() + '::' + r.method; }).join(', ') + '\n' +
          'dead-button   ' + cov.codeOnly.length + (deadb.length ? '  ' + deadb.join(', ') : '') + '\n' +
          'blocked       ' + cov.blocked.length + '\n' +
          'unreached     ' + cov.unreached.length + '  (need navigation)';
        covSec.appendChild(box);
      },
      running: function (t) { if (!scriptSec) scriptSec = sec('flow suite'); var r = el('div', 'row'); r.dataset.f = t.file; r.appendChild(el('span', 'ic m', '…')); r.appendChild(el('span', null, t.name)); scriptSec.appendChild(r); },
      script: function (t, res) {
        var r = scriptSec.querySelector('[data-f="' + t.file + '"]');
        r.querySelector('.ic').className = 'ic ' + (res.pass ? 'k' : 'r'); r.querySelector('.ic').textContent = res.pass ? '✓' : '✗';
        var steps = res.steps.length; var lbl = r.childNodes[1];
        lbl.textContent = t.name + '  '; var meta = el('span', 'dim', '(' + steps + ' step' + (steps === 1 ? '' : 's') + ')'); r.appendChild(meta);
        if (!res.pass && res.steps[res.failedAt] && res.steps[res.failedAt].mismatch) {
          var mm = res.steps[res.failedAt].mismatch; var d = el('div', 'dim'); d.style.paddingLeft = '22px';
          d.textContent = 'step ' + res.failedAt + ': expected ' + JSON.stringify(mm.expected) + ', got ' + JSON.stringify(mm.actual); scriptSec.appendChild(d);
        }
      },
      summary: function (passed, total) {
        var s = el('div', 'sum ' + (passed === total ? 'ok' : 'bad'));
        s.textContent = passed + '/' + total + ' scripts passed' + (passed === total ? '  ·  green' : '');
        out.appendChild(s);
        var note = el('div', 'dim'); note.style.marginTop = '8px'; note.style.fontSize = '10.5px';
        note.textContent = 'Tripwires assert each buried bug is still present — they turn red the day it is fixed.';
        out.appendChild(note);
      }
    };

    btn.onclick = async function () {
      btn.disabled = true; btn.textContent = 'running…'; out.innerHTML = ''; covSec = scriptSec = null;
      try { await runSuite(cb); }
      catch (e) { var er = el('div', 'sum bad'); er.textContent = 'error: ' + ((e && e.message) || e); out.appendChild(er); }
      btn.disabled = false; btn.textContent = '▶ Run again';
    };
  }

  // expose for headless verification (copse.eval calls this in CI)
  window.__demo = { runSuite: runSuite, coverageJoin: coverageJoin, subsetMatch: subsetMatch, waitLive: waitLive };

  function boot() { waitLive(20000).then(function () { ensureCopse(); mount(); }, function () { mount(); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
