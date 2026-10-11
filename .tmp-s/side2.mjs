// 用「实际可见的正文元素」量，而不是 #app（两模块 #app 层级不同，不能直接比）
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(mega, W, H) {
  const port = 9350 + Math.floor(Math.random() * 60) + (mega === 'guoxue' ? 30 : 0);
  const profile = mkdtempSync(join(tmpdir(), 'cdp-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--hide-scrollbars', '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  let pg;
  for (let i = 0; i < 60 && !pg; i++) {
    try { pg = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl); } catch {}
    if (!pg) await sleep(250);
  }
  const ws = new WebSocket(pg.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); } };
  const send = (m, p = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:5173/web/' });
  await sleep(3000);
  if (mega === 'guoxue') { await send('Runtime.evaluate', { expression: `document.querySelector('[data-mega=guoxue]').click()` }); await sleep(2600); }

  const expr = `(() => {
    const isG = ${JSON.stringify(mega)} === 'guoxue';
    const f = document.querySelector('.guoxue-frame');
    const d = isG ? f.contentDocument : document;
    const off = isG ? f.getBoundingClientRect() : { left: 0 };
    const R = (e) => { const b = e.getBoundingClientRect(); return { l: Math.round(b.left + off.left), r: Math.round(b.right + off.left), w: Math.round(b.width) }; };
    const pick = (sels) => { for (const s of sels) { const e = d.querySelector(s); if (e && e.getClientRects().length) return { sel: s, ...R(e) }; } return null; };
    // 两模块各自的「顶部切换条」= 最外层正文元素，直接可比
    const sw = pick(['.sect-switch', '.dynasty-switch']);
    const tabs = pick(['.tabs-v', '.tabs']);
    const app = d.querySelector('#app');
    const area = d.querySelector('.mega-area:not(.hidden)');
    const first = pick(['.timeline-wrap', '.books-scroll']);
    return JSON.stringify({
      win: innerWidth,
      appEl: app ? { ...R(app), padL: getComputedStyle(app).paddingLeft, padR: getComputedStyle(app).paddingRight, maxW: getComputedStyle(app).maxWidth } : null,
      areaEl: area ? { ...R(area), mL: getComputedStyle(area).marginLeft } : null,
      header: sw, tabs, first,
      sidebarRight: 90,
    });
  })()`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  ws.close(); chrome.kill();
  return JSON.parse(r.result.result.value);
}

for (const W of [1920, 1655, 1366, 1279]) {
  const h = await run('history', W, 950);
  const g = await run('guoxue', W, 950);
  console.log(`\n=== 窗口 ${W} ===`);
  console.log(`  帝王谱系  顶部条=[${h.header.l},${h.header.r}] 宽${h.header.w}  #app=${JSON.stringify(h.appEl && {l:h.appEl.l,r:h.appEl.r,w:h.appEl.w,maxW:h.appEl.maxW})}  .mega-area marginLeft=${h.areaEl && h.areaEl.mL} 面积=[${h.areaEl && h.areaEl.l},${h.areaEl && h.areaEl.r}]`);
  console.log(`  典籍长河  顶部条=[${g.header.l},${g.header.r}] 宽${g.header.w}  #app=${JSON.stringify(g.appEl && {l:g.appEl.l,r:g.appEl.r,w:g.appEl.w,maxW:g.appEl.maxW})}`);
  console.log(`  → 顶部条宽度差 ${h.header.w - g.header.w}px；左缘差 ${g.header.l - h.header.l}px；右缘差 ${g.header.r - h.header.r}px`);
  console.log(`  → 胶囊: 帝王=[${h.tabs.l},${h.tabs.r}] 典籍=[${g.tabs.l},${g.tabs.r}]`);
}
process.exit(0);