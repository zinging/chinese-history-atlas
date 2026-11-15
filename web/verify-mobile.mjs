#!/usr/bin/env node
/**
 * 移动端适配回归验证（零依赖，仅用 Node 内置模块 + 本机 Chrome）。
 *
 * 为什么需要它：这套移动端适配全部失效面都在「断点、输入类型、抽屉状态」上，
 * 单看代码或窄窗口截图看不出问题——横屏退回桌面布局、tap 把弹层点开即关、
 * 抽屉打开后键盘无出口，都是必须真机尺寸 + 真实事件序列才会暴露的。
 *
 * 用法：
 *   node web/verify-mobile.mjs                 # 自起服务（自动挑空闲端口），跑全部移动端断言
 *   node web/verify-mobile.mjs --base <url>    # 追加「桌面几何与基线逐元素一致」的 A/B
 *                                              # 基线一般是父提交的另一份 checkout
 *   node web/verify-mobile.mjs --port 5601     # 指定端口
 *   node web/verify-mobile.mjs --keep          # 保留临时 Chrome profile（排查用）
 *
 * 退出码 0 = 全部通过；1 = 有失败项（逐条打印原因）。需要本机 Chrome。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const argv = process.argv.slice(2);
const argVal = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };
const BASE = argVal('--base', '');
const PORT = Number(argVal('--port', 0));
const KEEP = argv.includes('--keep');

const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p));
if (!CHROME) { console.error('未找到 Chrome，无法验证'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = (start) => new Promise((ok) => {
  const probe = (p, left) => {
    const s = createServer();
    s.once('error', () => { s.close(); if (left <= 0) ok(0); else probe(p + 1, left - 1); });
    s.once('listening', () => s.close(() => ok(p)));
    s.listen(p, '127.0.0.1');
  };
  probe(start, 60);
});

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const expr = (tpl) => tpl.replace(/\n\s*/g, ' ');

/* ---------- 自起本地静态服务 ---------- */
let server = null;
let HOST = '';
async function startServer() {
  const port = PORT || await freePort(5600);
  if (!port) throw new Error('找不到空闲端口');
  server = spawn(process.execPath, [join(HERE, 'serve.mjs'), String(port)], { cwd: ROOT, stdio: 'ignore' });
  HOST = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`${HOST}/web/index.html`); if (r.ok) return; } catch { /* 还在起 */ }
    await sleep(100);
  }
  throw new Error('本地服务启动超时');
}

/* ---------- CDP 客户端 ---------- */
const profile = mkdtempSync(join(tmpdir(), 'vmb-'));
const cport = 9400 + Math.floor(Math.random() * 200);
let chrome = null, ws = null, sessionId, targetId, send;
async function connect() {
  chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cport}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let wsUrl;
  for (let i = 0; i < 120; i++) {
    try { const j = await (await fetch(`http://127.0.0.1:${cport}/json/version`)).json(); if (j.webSocketDebuggerUrl) { wsUrl = j.webSocketDebuggerUrl; break; } } catch { /* 未就绪 */ }
    await sleep(200);
  }
  if (!wsUrl) throw new Error('Chrome 未就绪');
  ws = new WebSocket(wsUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  let seq = 0;
  const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  send = (method, params = {}, sid) => {
    const id = ++seq;
    return new Promise((ok, no) => {
      const t = setTimeout(() => { pend.delete(id); no(new Error('timeout ' + method)); }, 25000);
      pend.set(id, (m) => { clearTimeout(t); m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result); });
      ws.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) }));
    });
  };
  const t = await send('Target.createTarget', { url: 'about:blank' });
  targetId = t.targetId;
  sessionId = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
}
const S = (m, p) => send(m, p, sessionId);
async function ev(code) {
  const r = await S('Runtime.evaluate', { expression: code, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description || 'eval error' };
  return r.result.value;
}
async function load(url, w, h, mobile) {
  await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: !!mobile, screenWidth: w, screenHeight: h });
  await S('Emulation.setTouchEmulationEnabled', { enabled: !!mobile, maxTouchPoints: 5 });
  await S('Page.navigate', { url });
  for (let i = 0; i < 150; i++) { if ((await ev('document.readyState')) === 'complete') break; await sleep(100); }
  for (let i = 0; i < 60; i++) { if ((await ev('document.querySelectorAll(".emp-card").length >= 3')) === true) break; await sleep(120); }
  await sleep(900);
}
async function tap(x, y) {
  await S('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 1, radiusY: 1, force: 1 }] });
  await sleep(40);
  await S('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(400);
}
const key = async (k, code, vk, shift = false) => {
  const base = { key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: shift ? 8 : 0 };
  await S('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await S('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(250);
};
const GEO = `(() => {
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const t = el.tagName;
    if (t === 'SCRIPT' || t === 'STYLE' || t === 'SVG' || t === 'PATH' || t === 'LINE') continue;
    const cls0 = typeof el.className === 'string' ? el.className : '';
    if (/gl-text|gl-dots/.test(cls0)) continue;   // 「正在加载」走字动画，宽度随帧变化
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const cls = cls0.replace(/\\s+/g, '.').slice(0, 70);
    out.push(t + '|' + cls + '|' + Math.round(r.left * 10) / 10 + '|' + Math.round(r.top * 10) / 10 + '|' + Math.round(r.width * 10) / 10 + '|' + Math.round(r.height * 10) / 10);
  }
  return out;
})()`;

/* ---------- 断言 ---------- */
try {
  await startServer();
  await connect();
  const PAGE = `${HOST}/web/index.html?page=timeline`;

  // 1) 桌面：几何与基线一致（可选）；短窗口不误命中横屏分支
  if (BASE) {
    for (const [w, h] of [[1280, 800], [1366, 768], [1440, 900], [1536, 864], [1920, 1080], [2560, 1440]]) {
      await load(PAGE, w, h, false);
      const a = await ev(GEO);
      await load(`${BASE}/web/index.html?page=timeline`, w, h, false);
      const b = await ev(GEO);
      let diff = 0; const sample = []; let clsOnly = 0;
      // 指纹形如 TAG|cls|left|top|w|h：几何比较时剥掉类名段。
      // 只改类名（如给容器补一个移动端专用类）不改变任何盒模型，不应判红；
      // 位置或尺寸任何一位变化仍会被 diff 抓到。
      const geo = (s) => String(s).replace(/^([A-Z0-9-]+)\|[^|]*\|/, '$1|');
      if (Array.isArray(a) && Array.isArray(b)) {
        for (let i = 0; i < Math.max(a.length, b.length); i++) {
          if (geo(a[i]) !== geo(b[i])) { diff++; if (sample.length < 2) sample.push({ now: a[i] ?? null, base: b[i] ?? null }); }
          else if (a[i] !== b[i]) clsOnly++;
        }
      } else diff = -1;
      check(`桌面 ${w}×${h}：几何与基线逐元素一致`, diff === 0, `元素 ${Array.isArray(a) ? a.length : '?'}，几何差异 ${diff}${clsOnly ? `，仅类名差异 ${clsOnly}（不影响盒模型）` : ''}${sample.length ? ' ' + JSON.stringify(sample) : ''}`);
    }
  } else {
    console.log('（跳过桌面 A/B：未提供 --base，可用 --base <父提交的服务地址> 追加）');
  }
  for (const [w, h] of [[1440, 450], [1280, 480]]) {
    await load(PAGE, w, h, false);
    const d = await ev(expr(`(() => ({ isMobile: document.body.classList.contains('is-mobile'),
      tabs: getComputedStyle(document.querySelector('.tabs')).position,
      ham: !!document.querySelector('.mobile-menu-btn'),
      gutter: getComputedStyle(document.querySelector('.module-inner')).paddingRight }))()`));
    check(`桌面短窗口 ${w}×${h}：不误命中横屏分支`, d.isMobile === false && d.tabs === 'fixed' && d.ham === false,
      JSON.stringify(d));
  }
  // 桌面「支持」：click 不改状态，hover 才开
  await load(PAGE, 1440, 900, false);
  const pop = await ev(expr(`(() => { const p = document.getElementById('support-pop'), b = document.getElementById('support-btn');
    b.click(); const afterClick = !p.classList.contains('hidden');
    b.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    return { afterClick, afterHover: !p.classList.contains('hidden') }; })()`));
  check('桌面「支持」：click 不改状态、hover 才打开', pop.afterClick === false && pop.afterHover === true, JSON.stringify(pop));

  // 2) 竖屏：布局、触控目标、无溢出
  for (const [w, h] of [[390, 844], [360, 800], [320, 568]]) {
    await load(PAGE, w, h, true);
    const m = await ev(expr(`(() => {
      const tabs = Array.from(document.querySelectorAll('.tabs .tab'));
      return { vw: innerWidth, docW: document.scrollingElement.scrollWidth,
        inert: document.querySelector('.mega-sidebar').hasAttribute('inert'),
        tabs: tabs.map(t => { const r = t.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), ovf: t.scrollWidth - t.clientWidth }; }) }; })()`));
    const minH = Math.min.apply(null, m.tabs.map((t) => t.h));
    check(`${w}×${h}：四格全可见、无横向溢出`, m.docW <= m.vw + 1 && m.tabs.every((t) => t.right <= m.vw && t.w >= 40),
      `docW=${m.docW} ` + m.tabs.map((t) => `${t.w}×${t.h}`).join(' '));
    check(`${w}×${h}：页签触控高 ≥44 且文字不内溢`, minH >= 44 && m.tabs.every((t) => t.ovf <= 0), `min=${minH}px`);
    check(`${w}×${h}：抽屉关闭时侧栏 inert`, m.inert === true);
  }

  // 3) 抽屉：打开→锁滚→焦点→关闭按钮→Esc→Tab 循环
  await load(PAGE, 390, 844, true);
  const ham = await ev(`(() => { const r = document.querySelector('.mobile-menu-btn').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  await tap(ham.x, ham.y);
  await sleep(300);
  const opened = await ev(expr(`(() => { const sb = document.querySelector('.mega-sidebar');
    const c = document.getElementById('drawer-close'); const cr = c ? c.getBoundingClientRect() : null;
    return { open: document.body.classList.contains('sidebar-open'),
      lock: document.documentElement.classList.contains('drawer-lock'),
      overflow: getComputedStyle(document.documentElement).overflow,
      inert: sb.hasAttribute('inert'), left: Math.round(sb.getBoundingClientRect().left),
      active: document.activeElement ? document.activeElement.id || document.activeElement.className : null,
      close: cr ? { w: Math.round(cr.width), h: Math.round(cr.height), vis: cr.top >= 0 && cr.right <= innerWidth, z: getComputedStyle(c).zIndex } : null }; })()`));
  check('抽屉打开：侧栏解除 inert 并滑入', opened.inert === false && opened.left <= 1, `inert=${opened.inert} left=${opened.left}`);
  check('抽屉打开：html 加锁，背景锁滚', opened.lock === true && opened.overflow === 'hidden', `lock=${opened.lock} overflow=${opened.overflow}`);
  check('抽屉打开：焦点进入抽屉（不是 body）', String(opened.active) === 'drawer-close', String(opened.active));
  check('抽屉打开：有可见的关闭按钮（44×44、z>侧栏）',
    !!opened.close && opened.close.vis && opened.close.w === 44 && opened.close.h === 44 && opened.close.z === '1001',
    JSON.stringify(opened.close));
  await S('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 320, y: 300, deltaX: 0, deltaY: 600 });
  await sleep(400);
  const wheel = await ev('window.scrollY');
  check('抽屉打开：真实滚轮手势不滚动背景', wheel === 0, `scrollY=${wheel}`);
  // Tab 循环
  await ev(expr(`(() => { const list = Array.from(document.querySelector('.mega-sidebar').querySelectorAll('button, a[href]'))
      .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    (list[list.length - 1] || document.getElementById('drawer-close')).focus(); })()`));
  await key('Tab', 'Tab', 9);
  const trap = await ev(`(() => document.activeElement.id)()`);
  check('Tab 不逃出抽屉（末尾 Tab 回到关闭按钮）', trap === 'drawer-close', String(trap));
  const cpos = await ev(`(() => { const r = document.getElementById('drawer-close').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  await tap(cpos.x, cpos.y);
  const afterClose = await ev(expr(`(() => ({ open: document.body.classList.contains('sidebar-open'),
    lock: document.documentElement.classList.contains('drawer-lock'),
    gone: !document.getElementById('drawer-close'),
    active: document.activeElement ? document.activeElement.id : null,
    inert: document.querySelector('.mega-sidebar').hasAttribute('inert') }))()`));
  check('点关闭按钮：关闭 + 解锁 + 控件移除 + 焦点回汉堡',
    afterClose.open === false && afterClose.lock === false && afterClose.gone === true &&
    afterClose.active === 'mobile-menu-btn' && afterClose.inert === true, JSON.stringify(afterClose));
  // Esc
  await tap(ham.x, ham.y);
  await key('Escape', 'Escape', 27);
  const esc = await ev(expr(`(() => ({ open: document.body.classList.contains('sidebar-open'),
    lock: document.documentElement.classList.contains('drawer-lock'),
    active: document.activeElement ? document.activeElement.id : null }))()`));
  check('Esc 关闭抽屉并解锁', esc.open === false && esc.lock === false && esc.active === 'mobile-menu-btn', JSON.stringify(esc));

  // 4) 触屏「支持」：只走 click，tap 后保持打开
  const supOpen = await ev(expr(`(() => { const p = document.getElementById('support-pop'), b = document.getElementById('support-btn');
    p.classList.add('hidden');
    b.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false })); const afterEnter = !p.classList.contains('hidden');
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return { afterEnter, afterClick: !p.classList.contains('hidden') }; })()`));
  check('触屏下 mouseenter→click 不自相抵消（tap 能打开）',
    supOpen.afterEnter === false && supOpen.afterClick === true, JSON.stringify(supOpen));

  // 5) 横屏：命中移动端分支、入口可达
  await load(PAGE, 844, 390, true);
  const land = await ev(expr(`(() => { const q = (s) => document.querySelector(s);
    return { isMobile: document.body.classList.contains('is-mobile'),
      tabs: getComputedStyle(q('.tabs')).position,
      ham: !!q('.mobile-menu-btn'), docW: document.scrollingElement.scrollWidth, vw: innerWidth,
      left: Math.round(q('.mega-sidebar').getBoundingClientRect().left) }; })()`));
  check('横屏 844×390：走移动端布局（抽屉 + 横排页签）',
    land.isMobile === true && land.tabs === 'static' && land.ham === true && land.left < 0 && land.docW <= land.vw + 1,
    JSON.stringify(land));
  const lham = await ev(`(() => { const r = document.querySelector('.mobile-menu-btn').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  await tap(lham.x, lham.y);
  const lend = await ev(expr(`(() => { const s = document.querySelector('.mega-sidebar'), sup = document.getElementById('support-btn');
    s.scrollTop = 9999; const r = sup.getBoundingClientRect();
    return { open: document.body.classList.contains('sidebar-open'),
      visible: r.top >= 0 && r.bottom <= innerHeight, bottom: Math.round(r.bottom), vh: innerHeight }; })()`));
  check('横屏 844×390：抽屉内底部入口可达', lend.open === true && lend.visible === true, JSON.stringify(lend));

  // 6) 断点边界
  for (const w of [760, 761]) {
    await load(PAGE, w, 900, w <= 760);
    const b = await ev(expr(`(() => ({ isMobile: document.body.classList.contains('is-mobile'),
      tabs: getComputedStyle(document.querySelector('.tabs')).position }))()`));
    check(`${w}px：${w <= 760 ? '移动端' : '桌面端'}分支`, b.isMobile === (w <= 760) && b.tabs === (w <= 760 ? 'static' : 'fixed'), JSON.stringify(b));
  }

  // 7) prefers-reduced-motion
  await S('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await load(PAGE, 390, 844, true);
  const rm = await ev(expr(`(() => ({ sidebar: getComputedStyle(document.querySelector('.mega-sidebar')).transitionDuration,
    tab: getComputedStyle(document.querySelector('.tabs .tab')).transitionDuration }))()`));
  check('prefers-reduced-motion：抽屉与页签过渡归零', /^0s/.test(rm.sidebar) && /^0s/.test(rm.tab), JSON.stringify(rm));
  await S('Emulation.setEmulatedMedia', { features: [] });
} catch (e) {
  console.error('验证中断：' + (e && e.message ? e.message : e));
  results.push({ name: '执行中断', ok: false, detail: String(e && e.message) });
} finally {
  try { if (send && targetId) await send('Target.closeTarget', { targetId }); } catch { /* ignore */ }
  try { if (ws) ws.close(); } catch { /* ignore */ }
  try { if (chrome) chrome.kill(); } catch { /* ignore */ }
  try { if (server) server.kill(); } catch { /* ignore */ }
  await sleep(300);
  if (!KEEP) { try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ } }
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed} / ${results.length} 通过`);
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log('未通过：');
  failed.forEach((f) => console.log(`  - ${f.name}   ${f.detail}`));
  process.exit(1);
}
process.exit(0);
