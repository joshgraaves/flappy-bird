// Headless Chrome test over the DevTools Protocol. Needs Node 22+ (global WebSocket) and Python for a static server.
// Usage: node tools/test.mjs [outDir]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || join(root, 'tools', 'shots');
mkdirSync(out, { recursive: true });
const PORT = 8737, CDP = 9337;
const chromePath = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = spawn('python', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
const chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'flappyBird-'))}`,
  '--no-first-run', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill(); } catch {} try { server.kill(); } catch {} };
process.on('exit', cleanup);

let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); break; } catch { await sleep(200); } }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const logs = [];
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map(a => a.value).join(' '));
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + JSON.stringify(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
});
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, m => m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || expr); return r.result.value; };
const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(out, name), Buffer.from(r.data, 'base64')); console.log('saved', name); };
const tap = async (x = 195, y = 500) => {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
let fails = 0; const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };

await send('Page.enable'); await send('Runtime.enable');

// --- icons ---
await send('Emulation.setDeviceMetricsOverride', { width: 512, height: 512, deviceScaleFactor: 1, mobile: false });
for (const s of [180, 192, 512]) {
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/tools/icon.html?s=${s}` }); await sleep(600);
  const data = await ev(`document.getElementById('c').toDataURL('image/png')`);
  writeFileSync(join(root, `icon-${s}.png`), Buffer.from(data.split(',')[1], 'base64'));
  console.log('icon', s);
}

// --- iPhone 14 Pro Max-ish portrait (390x844 CSS px @3x) ---
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` }); await sleep(1200);
await ev(`localStorage.clear()`); await send('Page.reload'); await sleep(1200);

const info = await ev(`({W:__flappyBird.W,H:__flappyBird.H,g:__flappyBird.groundY,state:__flappyBird.G.state, sx: document.documentElement.scrollWidth, cw: innerWidth})`);
console.log('layout', info);
check(info.state === 'ready', 'starts on get-ready screen');
check(info.sx <= info.cw, 'no horizontal overflow');
await shot('1-ready.png');

// fixed-timestep check: same input, 60 Hz vs 120 Hz frame pacing -> same physics
const det = await ev(`(() => {
  const L = __flappyBird, G = L.G, run = (hz) => {
    L.reset(); L.flap(); let acc = 0; const ys = [];
    for (let f = 0; f < hz; f++) { acc += 1 / hz; while (acc >= L.T.step - 1e-9) { L.step(L.T.step); acc -= L.T.step; }
      if (f + 1 === Math.round(hz * 0.3)) L.flap(); }
    return G.y;
  };
  const a = run(60), b = run(120); L.reset(); return [a, b];
})()`);
check(Math.abs(det[0] - det[1]) < 0.5, `same height after 1s at 60 vs 120 Hz (${det.map(v => v.toFixed(2)).join(' vs ')})`);

// tap starts run
await tap(); await sleep(100);
check(await ev(`__flappyBird.G.state`) === 'play', 'tap starts the run');
// autopilot via real touch events: flap when below the next gap's center
const pilot = async (ms, shotAt) => {
  const t0 = Date.now(); let shotDone = false;
  while (Date.now() - t0 < ms) {
    const s = await ev(`(() => { const G = __flappyBird.G, bx = __flappyBird.birdX();
      const p = G.pillars.find(p => p.x - G.scroll + __flappyBird.T.pillarW + 6 > bx);
      const tgt = p ? p.c + 10 : __flappyBird.groundY * 0.5;
      return { st: G.state, y: G.y, vy: G.vy, tgt, score: G.score }; })()`);
    if (s.st !== 'play') return s;
    if (s.y > s.tgt && s.vy > -40) await tap();
    if (shotAt && !shotDone && s.score >= shotAt) { await shot('2-playing.png'); shotDone = true; }
    await sleep(16);
  }
  return ev(`({st: __flappyBird.G.state, score: __flappyBird.G.score})`);
};
const r1 = await pilot(9000, 2);
console.log('autopilot', r1);
check(r1.score >= 3, `scoring works (autopilot scored ${r1.score})`);

// now stop tapping -> should die
const t0 = Date.now(); while (await ev(`__flappyBird.G.state`) !== 'over' && Date.now() - t0 < 6000) await sleep(100);
await sleep(1500);
const over = await ev(`({st: __flappyBird.G.state, score: __flappyBird.G.score, best: localStorage.getItem('flappyBird.best')})`);
check(over.st === 'over', 'run ends when not flapping (hits ground or pillar)');
check(+over.best === over.score && over.score > 0, `best saved to localStorage (${over.best})`);
await shot('3-gameover.png');

// retry
await tap(); await sleep(150);
check(await ev(`__flappyBird.G.state`) === 'ready', 'tap on game over returns to get-ready');
await shot('4-ready-best.png');

// double-tap zoom / scroll guard
const vp = await ev(`({scale: visualViewport.scale, y: scrollY})`);
await tap(); await sleep(60); await tap(); await sleep(300);
const vp2 = await ev(`({scale: visualViewport.scale, y: scrollY})`);
check(vp2.scale === vp.scale && vp2.y === 0, 'double tap does not zoom or scroll');

// custom character image: make a test PNG (a plain blue square with a transparent border) and load it via the file input
await ev(`__flappyBird.reset()`); await sleep(200);
const png = await ev(`(() => { const c = document.createElement('canvas'); c.width = 64; c.height = 48;
  const g = c.getContext('2d'); g.fillStyle = '#2a7fff'; g.fillRect(8, 8, 48, 32); g.fillStyle = '#fff'; g.fillRect(40, 14, 8, 8);
  return c.toDataURL('image/png'); })()`);
const pngPath = join(mkdtempSync(join(tmpdir(), 'flappyBird-skin-')), 'test-skin.png');
writeFileSync(pngPath, Buffer.from(png.split(',')[1], 'base64'));
const { root: docRoot } = await send('DOM.getDocument');
const { nodeId } = await send('DOM.querySelector', { nodeId: docRoot.nodeId, selector: '#skinFile' });
await send('DOM.setFileInputFiles', { nodeId, files: [pngPath] }); await sleep(600);
const sk = await ev(`({ w: __flappyBird.skin && __flappyBird.skin.width, h: __flappyBird.skin && __flappyBird.skin.height, saved: !!localStorage.getItem('flappyBird.skin'), btnVisible: getComputedStyle(document.getElementById('ui')).display !== 'none' })`);
check(sk.w === 22 && sk.h > 0 && sk.saved, `custom image loads, cropped + fit to sprite (${sk.w}x${sk.h}), saved`);
check(sk.btnVisible, 'image button visible on title screen');
const stBefore = await ev(`__flappyBird.G.state`);
const br = await ev(`(() => { const r = document.getElementById('skinBtn').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
await send('Page.setInterceptFileChooserDialog', { enabled: true });
await tap(br[0], br[1]); await sleep(150); // tap the button area must not start a run
check(stBefore === 'ready' && await ev(`__flappyBird.G.state`) === 'ready', 'tapping the image button does not start a run');
await shot('5-custom-skin.png');
await send('Page.reload'); await sleep(1200);
check(await ev(`!!__flappyBird.skin`), 'custom image survives reload');
await tap(); await sleep(200);
check(await ev(`getComputedStyle(document.getElementById('ui')).display === 'none'`), 'buttons hide during a run');
await ev(`document.getElementById('skinReset').click()`);
check(await ev(`!__flappyBird.skin && !localStorage.getItem('flappyBird.skin')`), 'reset button goes back to Flappy Bird');

check(!logs.some(l => l.startsWith('EXCEPTION')), 'no page exceptions');
if (logs.length) console.log('console:', logs);
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
ws.close(); cleanup(); process.exit(fails ? 1 : 0);
