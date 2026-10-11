// 量两个模块正文区的窗口绝对坐标与宽度（正文是否为窗口居中、是否被侧栏推移）
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(mega, W, H) {
  const port = 9300 + Math.floor(Math.random() * 80) + (mega === 'guoxue' ? 40 : 0);
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
    const off = isG ? f.getBoundingClientRect() : { left: 0, top: 0 };
    const app = d.querySelector('#app'), cs = getComputedStyle(app);
    const padL = parseFloat(cs.paddingLeft), padR = parseFloat(cs.paddingRight);
    const ab = app.getBoundingClientRect();
    const rail = d.querySelector('.tabs-v, .tabs');
    const rb = rail.getBoundingClientRect();
    // 正文左右缘（窗口绝对坐标）
    const L = Math.round(ab.left + off.left + padL);
    const R = Math.round(ab.right + off.left - padR);
    return JSON.stringify({
      win: innerWidth,
      sidebarRight: 90,
      iframe: isG ? { l: Math.round(off.left), r: Math.round(off.left + f.getBoundingClientRect().width) } : null,
      appBox: { l: Math.round(ab.left + off.left), r: Math.round(ab.right + off.left), w: Math.round(ab.width) },
      content: { l: L, r: R, w: R - L },
      contentCenter: Math.round((L + R) / 2),
      windowCenter: Math.round(innerWidth / 2),
      offsetFromWindowCenter: Math.round((L + R) / 2 - innerWidth / 2),
      gapSidebarToContent: L - 90,
      rail: { l: Math.round(rb.left + off.left), r: Math.round(rb.right + off.left) },
      railEatsContent: (Math.round(rb.left + off.left)) < R,
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
  for (const [n, r] of [['帝王谱系', h], ['典籍长河', g]]) {
    console.log(`  ${n}  正文=[${r.content.l},${r.content.r}] 宽${r.content.w}  中心${r.contentCenter} (窗口中心${r.windowCenter}, 偏移${r.offsetFromWindowCenter > 0 ? '+' : ''}${r.offsetFromWindowCenter})  侧栏到正文间隙=${r.gapSidebarToContent}`);
  }
  const dw = h.content.w - g.content.w;
  const dc = g.contentCenter - h.contentCenter;
  console.log(`  → 宽度差 ${dw}px（帝王-典籍）; 中心偏移差 ${dc > 0 ? '+' : ''}${dc}px`);
}
process.exit(0);