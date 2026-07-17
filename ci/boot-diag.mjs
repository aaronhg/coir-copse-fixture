// One-shot: connect via copse and report WHY the scene may be empty on this runner —
// copse's OWN Chrome (not a standalone probe): WebGL renderer, scene boot timing, page errors.
const { connect } = await import(process.env.COPSE_DRIVER || '/tmp/copse/src/drivers/puppeteer.js');
const url = process.argv[2] || 'http://127.0.0.1:8899/';
const headed = process.argv.includes('--headed');
const cp = await connect(url, { headless: headed ? false : 'new', bootTries: 20, readyTries: 45 });
const val = (r) => (r && typeof r === 'object' && 'value' in r) ? r.value : r;
let code = 0;
try {
  const gl = val(await cp.eval(`(()=>{try{const c=document.createElement('canvas');const g=c.getContext('webgl2')||c.getContext('webgl');const e=g&&g.getExtension('WEBGL_debug_renderer_info');return g?((g instanceof WebGL2RenderingContext?'webgl2 ':'webgl1 ')+(e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):'ctx-ok')):'NULL-CONTEXT'}catch(e){return 'ERR:'+e.message}})()`));
  const scene = val(await cp.eval(`(()=>{try{const s=window.cc&&window.cc.director&&window.cc.director.getScene&&window.cc.director.getScene();return s?{name:s.name,children:(s.children||[]).length}:'NO-SCENE'}catch(e){return 'ERR:'+e.message}})()`));
  const cc = val(await cp.eval(`(()=>{try{return {hasCc:!!window.cc,hasDirector:!!(window.cc&&window.cc.director),game:!!(window.cc&&window.cc.game),canvases:document.querySelectorAll('canvas').length}}catch(e){return 'ERR:'+e.message}})()`));
  console.log('WEBGL (copse chrome):', JSON.stringify(gl));
  console.log('SCENE:', JSON.stringify(scene));
  console.log('CC:', JSON.stringify(cc));
  console.log('--- page console + pageerrors (last 50) ---');
  for (const l of (cp.logs() || []).slice(-50)) console.log(`  [${l.level}] ${(l.text||'').slice(0,300)}`);
  // exit non-zero when the scene is empty so CI can fail fast (skip the ~15-min copse boot-wait spin)
  code = (scene && typeof scene === 'object' && scene.children > 0) ? 0 : 3;
} catch (e) { console.log('DIAG-ERROR:', e.message); code = 3; }
finally { await cp.close(); }
process.exit(code);
