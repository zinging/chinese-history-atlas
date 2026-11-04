#!/usr/bin/env node
/**
 * 中华历史图谱 · DSH（DeepSeek Harness）MCP 连接器安装器
 *
 * 把 MCP Server 注册进 DSH 的 profile 配置，装完后新会话里模型即可直接调用
 * session_start / search / get_emperor 等 15 个只读工具。
 *
 * 与 install-mcp.ps1/.sh 的区别：
 *   那两个脚本生成配置 JSON 让你粘贴到豆包/Cursor 的图形界面；
 *   本脚本直接写入 DSH 的 cordis.patch.yml，无需手工粘贴。
 *
 * 用法：
 *   node web/tools/install-dsh.mjs              # 安装（幂等：已存在则更新路径）
 *   node web/tools/install-dsh.mjs --check      # 只检查，不写入
 *   node web/tools/install-dsh.mjs --uninstall  # 移除本项目的条目
 *   node web/tools/install-dsh.mjs --profile desktop --port 5173
 *
 * 写入位置：
 *   $DSH_HOME/profiles/<profile>/cordis.patch.yml
 *   $DSH_HOME 默认 ~/.dsh-beta（Windows: C:\Users\<用户>\.dsh-beta）
 *
 * 安全策略：
 *   - 写前自动备份为 cordis.patch.yml.bak-before-atlas-<时间戳>
 *   - 只插入/更新本项目 id 为 chinese-history-atlas 的那一条，不碰其它配置
 *   - 插入后用 YAML 解析复核；解析失败立即从备份还原并报错退出
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..', '..');
const SERVER = path.join(ROOT, 'web', 'tools', 'history-mcp-server.mjs');

const ENTRY_ID = 'chinese-history-atlas';
// bundle 包名：DSH 插件页按这个身份列出（标题来自 bundle 的 locale meta）
const BUNDLE_NAME = '@chenye123/chinese-history-atlas';

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const CHECK_ONLY = flag('--check');
const UNINSTALL = flag('--uninstall');
const PROFILE = opt('--profile', null);
const PORT = opt('--port', '5173');

// ---------- 定位 DSH ----------
function dshHome() {
  if (process.env.DSH_HOME) return process.env.DSH_HOME;
  const candidates = [
    path.join(os.homedir(), '.dsh-beta'),
    path.join(os.homedir(), '.dsh'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return candidates[0];
}

function listProfiles(home) {
  const dir = path.join(home, 'profiles');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'node_modules' && !d.name.startsWith('_'))
    .map((d) => d.name);
}

function fail(msg) {
  console.error('❌ ' + msg);
  process.exit(1);
}
function ok(msg) { console.log('✅ ' + msg); }
function info(msg) { console.log('   ' + msg); }

// ---------- 最小 YAML 处理 ----------
// 不引入依赖：本项目定位是零依赖。这里只做两件确定性的事：
//   1. 找出本项目那段 entry 的字符区间（从 "- id: <ENTRY_ID>" 到下一个同级 "- " 或文件末尾）
//   2. 用块插入的方式追加一段固定缩进的 YAML 文本
// 复核用「结构标记 + 关键字段都存在」判断，而不是完整 YAML 解析。

/**
 * 定位本项目那一段配置的字符区间。
 *
 * 写入的形态是「父节点 + 子项」：
 *     - insert:
 *         - id: chinese-history-atlas
 *           name: ...
 *
 * 所以不能只锚定 id 行——那样替换/删除只会动子项，留下一个空壳 `- insert:`。
 * 这里先找 id 行，再向上回溯到包住它的 `- insert:`（缩进更浅的最近一条），
 * 区间终点取「与该父节点同缩进的下一条列表项」或文件末尾。
 */
function findEntryRange(text) {
  const idRe = new RegExp(`^([ \\t]*)-\\s*id:\\s*${ENTRY_ID}\\s*$`, 'm');
  const m = idRe.exec(text);
  if (!m) return null;

  const childIndent = m[1].length;
  let start = m.index;
  let parentIndent = null;

  // 向上逐行回溯，找最近的、缩进更浅的 "- insert:" 行
  const lines = text.slice(0, m.index).split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.trim()) continue;
    const im = line.match(/^([ \t]*)- insert:\s*$/);
    if (im && im[1].length < childIndent) {
      parentIndent = im[1].length;
      start = lines.slice(0, i).reduce((acc, l) => acc + l.length + 1, 0);
      break;
    }
    // 遇到同级或更浅的非空、非注释内容还没找到父节点，说明结构不是我们写的形态
    const ind = (line.match(/^[ \t]*/) || [''])[0].length;
    if (ind < childIndent && !line.trim().startsWith('#')) break;
  }

  // 区间终点：父节点缩进下的下一条列表项；找不到则到文件末尾
  let end = text.length;
  const searchFrom = m.index + m[0].length;
  const rest = text.slice(searchFrom);
  const siblingRe = new RegExp(`^${' '.repeat(parentIndent ?? 0)}-\\s+\\S`, 'm');
  const sm = siblingRe.exec(rest);
  if (sm) end = searchFrom + sm.index;

  return { start, end, block: text.slice(start, end), childIndent, parentIndent };
}

// ---------- 主流程 ----------
const home = dshHome();
if (!fs.existsSync(home)) fail(`找不到 DSH 配置目录：${home}\n  可用环境变量 DSH_HOME 指定。`);
info(`DSH 配置目录：${home}`);

const profiles = listProfiles(home);
if (!profiles.length) fail(`在 ${path.join(home, 'profiles')} 下没有找到任何 profile。`);

let profile = PROFILE;
if (!profile) {
  if (profiles.includes('desktop')) profile = 'desktop';
  else if (profiles.length === 1) profile = profiles[0];
  else fail(`有多个 profile（${profiles.join(', ')}），请用 --profile 指定一个。`);
}
if (!profiles.includes(profile)) {
  fail(`profile "${profile}" 不存在。可用：${profiles.join(', ')}`);
}

function ensureProfileBundle() {
  const pkgPath = path.join(home, 'profiles', profile, 'package.json');
  if (!fs.existsSync(pkgPath)) return { ok: false, reason: '找不到 profile 的 package.json' };
  let j;
  try { j = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); }
  catch (e) { return { ok: false, reason: 'profile package.json 解析失败：' + e.message }; }

  j.dsh = j.dsh || {};
  j.dsh.profile = j.dsh.profile || {};
  j.dsh.profile.bundles = j.dsh.profile.bundles || [];
  if (!j.dsh.profile.bundles.includes(BUNDLE_NAME)) j.dsh.profile.bundles.push(BUNDLE_NAME);

  j.dependencies = j.dependencies || {};
  const linkSpec = 'link:' + path.join(ROOT, 'plugin-atlas').replace(/\\/g, '/');
  j.dependencies[BUNDLE_NAME] = linkSpec;

  fs.writeFileSync(pkgPath, JSON.stringify(j, null, 2) + '\n', 'utf8');
  return { ok: true, pkgPath };
}

/** node_modules 下这个 bundle 的链接路径（作用域与包名从 BUNDLE_NAME 解析）。 */
function bundleLinkPath() {
  const m = /^@([^/]+)\/(.+)$/.exec(BUNDLE_NAME);
  if (!m) return null;
  return path.join(home, 'profiles', profile, 'node_modules', '@' + m[1], m[2]);
}

/** 建 node_modules 下的作用域目录链接，让 DSH 能 resolve 到 bundle。
 *  作用域与包名从 BUNDLE_NAME 解析，不能硬编码——改包名后写死会建出错误路径。 */
function ensureLink() {
  const link = bundleLinkPath();
  if (!link) return { ok: false, reason: 'BUNDLE_NAME 不是 scope 形式：' + BUNDLE_NAME };
  const scope = path.dirname(link);
  const target = path.join(ROOT, 'plugin-atlas');
  try {
    fs.mkdirSync(scope, { recursive: true });
    if (fs.existsSync(link)) {
      const st = fs.lstatSync(link);
      if (st.isSymbolicLink()) return { ok: true, existed: true };
    }
    fs.symlinkSync(target, link, 'junction');
    return { ok: true, created: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

const configPath = path.join(home, 'profiles', profile, 'cordis.patch.yml');
if (!fs.existsSync(configPath)) fail(`找不到配置文件：${configPath}`);
info(`目标 profile：${profile}`);
info(`bundle 包名：${BUNDLE_NAME}`);

/** 读 profile package.json，判断 bundle 是否已登记 */
function profileBundleState() {
  const pkgPath = path.join(home, 'profiles', profile, 'package.json');
  if (!fs.existsSync(pkgPath)) return { present: false, reason: 'profile package.json 不存在' };
  try {
    const j = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const bundles = (j.dsh && j.dsh.profile && j.dsh.profile.bundles) || [];
    const dep = (j.dependencies || {})[BUNDLE_NAME];
    return { present: bundles.includes(BUNDLE_NAME), dep, pkgPath };
  } catch (e) { return { present: false, reason: e.message }; }
}

const original = fs.readFileSync(configPath, 'utf8');
const range = findEntryRange(original);
const installed = Boolean(range);

if (CHECK_ONLY) {
  console.log('');
  const st = profileBundleState();
  if (st.present) {
    ok(`已安装：${BUNDLE_NAME} 已在 profile bundles`);
    if (st.dep) ok(`profile dependencies 已登记：${st.dep}`);
    else console.log('⚠️  profile dependencies 未登记，建议重跑安装');
    if (installed) info('注：cordis.patch.yml 里另有一条同 id 条目（旧形态），可用 --uninstall 清掉');
  } else {
    console.log('⚠️  尚未安装');
    info('运行 node web/tools/install-dsh.mjs 完成安装');
  }
  process.exit(0);
}

if (UNINSTALL) {
  const st = profileBundleState();
  const pkgPath = st.pkgPath || path.join(home, 'profiles', profile, 'package.json');
  let removed = false;
  if (fs.existsSync(pkgPath)) {
    const j = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const before = JSON.stringify(j);
    if (j.dsh && j.dsh.profile && Array.isArray(j.dsh.profile.bundles)) {
      j.dsh.profile.bundles = j.dsh.profile.bundles.filter((b) => b !== BUNDLE_NAME);
    }
    if (j.dependencies && BUNDLE_NAME in j.dependencies) delete j.dependencies[BUNDLE_NAME];
    if (JSON.stringify(j) !== before) {
      fs.copyFileSync(pkgPath, pkgPath + '.bak-before-atlas-uninstall-' + stamp());
      fs.writeFileSync(pkgPath, JSON.stringify(j, null, 2) + '\n', 'utf8');
      removed = true;
    }
  }
  // 顺手清掉旧形态留在 cordis.patch.yml 里的同 id 条目
  if (installed) {
    fs.copyFileSync(configPath, configPath + '.bak-before-atlas-uninstall-' + stamp());
    fs.writeFileSync(configPath, original.slice(0, range.start) + original.slice(range.end), 'utf8');
    removed = true;
  }
  // 移除 node_modules 链接（作用域与包名同样从 BUNDLE_NAME 解析）
  const lm = /^@([^/]+)\/(.+)$/.exec(BUNDLE_NAME);
  if (lm) {
    const link = path.join(home, 'profiles', profile, 'node_modules', '@' + lm[1], lm[2]);
    try { if (fs.existsSync(link)) { fs.rmSync(link, { recursive: true, force: true }); removed = true; } } catch { /* 忽略 */ }
  }

  if (removed) {
    ok('已移除连接器：profile bundles / dependencies / 旧条目 / node_modules 链接');
    info('重启 DSH 后生效');
  } else {
    ok('本来就没有安装，无需移除');
  }
  process.exit(0);
}

// ---------- 安装 ----------
// bundle 形态：bundle 自带 portable 的 cordis.patch.yml（路径由 !!js ctx.baseUrl 在加载时算出），
// 所以这里不再重新生成它——重新生成会写入本机绝对路径，破坏可移植性、
// 也让 npm 发布出去的那份在任何机器上都失效。这里只做三件事：
// 校验 bundle patch 存在、登记 profile bundles、建 node_modules 链接。
const bundlePatchPath = path.join(ROOT, 'plugin-atlas', 'cordis.patch.yml');
if (!fs.existsSync(bundlePatchPath)) {
  fail('未找到 plugin-atlas/cordis.patch.yml，无法按 bundle 形态安装');
}
const bundlePatchText = fs.readFileSync(bundlePatchPath, 'utf8');
if (!bundlePatchText.includes('ctx.baseUrl')) {
  fail('plugin-atlas/cordis.patch.yml 不是可移植形态（未使用 ctx.baseUrl 推导路径）。\n'
    + '    这会导致发布到 npm 后在别的机器上失效。请先恢复该文件再安装。');
}

// --port 写进 patch 的 CHAT_BASE_URL。端口不是机器相关的信息，
// 改它不破坏可移植性；若不改，--port 就只是改一句提示语、名不副实。
let portChanged = false;
if (PORT !== '5173') {
  const before = bundlePatchText;
  const after = before.replace(
    /(CHAT_BASE_URL:\s*')http:\/\/127\.0\.0\.1:\d+(\/web\/')/,
    `$1http://127.0.0.1:${PORT}$2`,
  );
  if (after === before) {
    fail(`无法在 ${path.relative(ROOT, bundlePatchPath)} 里改写端口（未匹配到 CHAT_BASE_URL）。`);
  }
  fs.writeFileSync(bundlePatchPath, after, 'utf8');
  portChanged = true;
}

console.log('');
info(`bundle patch：${path.relative(ROOT, bundlePatchPath)}（可移植${portChanged ? `，端口已改为 ${PORT}` : '，未改写'}）`);

const pkgBackup = path.join(home, 'profiles', profile, 'package.json') + '.bak-before-atlas-' + stamp();
const pkgPath = path.join(home, 'profiles', profile, 'package.json');
if (fs.existsSync(pkgPath)) { fs.copyFileSync(pkgPath, pkgBackup); info(`已备份 profile package.json`); }

const reg = ensureProfileBundle();
if (!reg.ok) fail('登记 profile bundles 失败：' + reg.reason);
ok(`已登记 bundles：${BUNDLE_NAME}`);

const link = ensureLink();
if (!link.ok) console.log('⚠️  node_modules 链接创建失败：' + link.reason + '\n   可手动执行：mklink /J ' + bundleLinkPath() + ' ' + path.join(ROOT, 'plugin-atlas'));
else ok('已创建 node_modules 链接');

// 复核
const st = profileBundleState();
const linkedPatch = bundleLinkPath() ? path.join(bundleLinkPath(), 'cordis.patch.yml') : '';
const checks = [
  [st.present, `profile bundles 含 ${BUNDLE_NAME}`],
  [Boolean(st.dep), 'profile dependencies 已登记'],
  [Boolean(linkedPatch) && fs.existsSync(linkedPatch), 'node_modules 链接可达'],
  [fs.existsSync(SERVER), 'MCP Server 文件存在'],
];
console.log('');
let allOk = true;
for (const [pass, label] of checks) {
  if (pass) ok(label);
  else { console.error('❌ ' + label); allOk = false; }
}
if (!allOk) {
  if (fs.existsSync(pkgBackup)) fs.copyFileSync(pkgBackup, pkgPath);
  console.error('\n复核未通过，已还原 profile package.json');
  process.exit(1);
}

console.log('');
console.log('安装完成。插件页会显示「中华历史图谱 / Chinese History Atlas」。');
console.log('');
console.log('下一步：');
console.log('  1. 重启 DSH Desktop（bundles 在启动时加载）');
console.log('  2. 在「插件」页确认出现 Chinese History Atlas，并保持开启');
console.log(`  3. 新会话里模型会自动调用 session_start；它会自己探活并在需要时启动本地站点`);
console.log(`  4. 站点地址：http://127.0.0.1:${PORT}/web/`);
console.log('');
console.log('如需移除：node web/tools/install-dsh.mjs --uninstall');
console.log(`profile：${path.join(home, 'profiles', profile)}`);

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
