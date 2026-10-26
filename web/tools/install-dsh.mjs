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
const SERVER_NAME = 'atlas';
// bundle 包名：DSH 插件页按这个身份列出（标题来自 bundle 的 locale meta）
const BUNDLE_NAME = '@chinese-history/atlas';

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

function buildEntryBlock(indent) {
  const pad = ' '.repeat(indent);
  // 路径统一用正斜杠：YAML 双引号内反斜杠是转义符，Windows 路径必须转成 /
  const server = SERVER.replace(/\\/g, '/');
  const root = ROOT.replace(/\\/g, '/');
  return [
    `${pad}- insert:`,
    `${pad}    - id: ${ENTRY_ID}`,
    `${pad}      name: '@deepseek-ai/dsh-mcp-client'`,
    `${pad}      config:`,
    `${pad}        serverName: ${SERVER_NAME}`,
    `${pad}        transport: stdio`,
    `${pad}        command: node`,
    `${pad}        args:`,
    `${pad}          - '${server}'`,
    `${pad}        env:`,
    `${pad}          CHAT_BASE_URL: 'http://127.0.0.1:${PORT}/web/'`,
    `${pad}        cwd: '${root}'`,
    '',
  ].join('\n');
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

/**
 * 维护 bundle 形态（推荐路径）。
 *
 * DSH 的插件列表读的是 profile 的 dependencies + dsh.profile.bundles，
 * 所以要让连接器以「Chinese History Atlas」出现在插件页并可控启用/停用，
 * 必须同时做三件事：写 bundle 自己的 patch、加进 bundles 列表、建 node_modules 链接。
 * 单独往 cordis.patch.yml 插条目只会让它作为匿名行存在，插件页看不到。
 *
 * 作用域：patch 采用「id 定向 override preset-standard + 追加 MCP 行」的形态，
 * 让 15 个工具只在标准模式出现，不污染 minimal / ptc / lean-eng。
 * 官方标准预设的内容由脚本从 dsh-web-app 逐字复制，避免手抄漏行。
 *
 * ⚠️ 必须是 override 而不是顶层 insert：dsh-web-app 的 presets/standard.patch.yml
 * 已经 insert 过 preset-standard，再 insert 一份就是 duplicate loader entry id，
 * Desktop 启动会在 profile 组合阶段直接失败并进恢复模式。
 */
function writeBundlePatch() {
  const bundleDir = path.join(ROOT, 'plugin-atlas');
  const patchPath = path.join(bundleDir, 'cordis.patch.yml');
  if (!fs.existsSync(bundleDir)) return null;

  const server = SERVER.replace(/\\/g, '/');
  const root = ROOT.replace(/\\/g, '/');

  // override 形态下 preset-standard 的 config.plugins 列表项缩进是 6：
  //   config:            (0)
  //     plugins:         (4)
  //       - id: persona  (6)
  const MCP = [
    '      # ── 追加：中华历史图谱 MCP 连接器（只在此预设内注册） ──',
    `      - id: ${ENTRY_ID}`,
    `        name: '@deepseek-ai/dsh-mcp-client'`,
    '        config:',
    `          serverName: ${SERVER_NAME}`,
    '          transport: stdio',
    '          command: node',
    '          args:',
    `            - '${server}'`,
    '          env:',
    `            CHAT_BASE_URL: 'http://127.0.0.1:${PORT}/web/'`,
    `          cwd: '${root}'`,
    '',
  ].join('\n');

  const HEADER = [
    '# 中华历史图谱 · DSH 连接器（bundle）',
    '#',
    '# 本文件由 node web/tools/install-dsh.mjs 生成：按当前仓库位置写入绝对路径。',
    '# 换机器或移动目录后重跑一次安装即可，不要手改这里的路径。',
    '#',
    '# ── 作用域：只在「标准模式」出现 ──────────────────────────────────────',
    '# 只写顶层 - insert: 的话，MCP 工具注册在根作用域，standard / minimal /',
    '# ptc / lean-eng 四个预设的工具清单里都会出现 mcp__atlas__* 那 15 个工具。',
    '#',
    '# 形态：id 定向 override（- id: preset-standard），不是顶层 - insert:。',
    '#   applyEntryPatches 对无 id 的 insert 是往顶层 push 新行；',
    '#   dsh-web-app/presets/standard.patch.yml 已经 insert 过同一行，',
    '#   再 insert 一份就是 duplicate loader entry id，启动直接失败。',
    '#   override 按 id 命中已有行并整段替换它的 config，',
    '#   所以 standard 原有插件必须全部重述——漏一个就等于删掉那个工具。',
    '#   列表由本脚本从官方 dsh-web-app/presets/standard.patch.yml 逐字复制，',
    '#   仅末尾追加 MCP 一行。',
    '# ⚠️ 升级 DSH 后若官方 standard 预设有变动，重跑安装即可重新同步。',
    '',
  ].join('\n');

  // 取官方 standard 预设作为基底；找不到时退回单条顶层 insert（全模式可用），
  // 保证至少能用，并明确提示作用域会变宽。
  //
  // 官方块是「- insert: + 两个空格缩进的 preset-standard 子项」。要写成 override，
  // 必须先丢掉首行 "- insert:"，再把剩余行去掉 2 空格缩进提升到顶层。
  // 原样拼上 "- insert:" 会让同一 id 出现两行，profile 组合直接失败。
  const official = findOfficialStandard();
  let body;
  if (official) {
    const rows = official.block.split('\n');
    if (rows[0].trim() !== '- insert:') {
      throw new Error('官方 standard.patch.yml 形态已变：首行不是 - insert:，拒绝生成');
    }
    // 子项缩进由官方文件决定（当前是 4 空格），按实际值动态剥离，
    // 不能硬编码 2——否则根序列项会残留前导空格。
    const firstChild = rows.slice(1).find((line) => line.trim() !== '');
    const indent = firstChild ? (firstChild.match(/^[ \t]*/) || [''])[0].length : 0;
    if (indent === 0) {
      throw new Error('官方 standard.patch.yml 形态已变：insert 子项没有缩进，拒绝生成');
    }
    const shifted = rows
      .slice(1)
      .map((line) => (line.startsWith(' '.repeat(indent)) ? line.slice(indent) : line))
      .join('\n')
      .replace(/\s+$/, '\n');
    body = HEADER + shifted + MCP;
  } else {
    body = [
      '# 中华历史图谱 · DSH 连接器（bundle）',
      '#',
      '# ⚠️ 未找到官方 standard.patch.yml，退回顶层注册：工具会在所有模式出现。',
      '',
      '- insert:',
      `    - id: ${ENTRY_ID}`,
      `      name: '@deepseek-ai/dsh-mcp-client'`,
      '      config:',
      `        serverName: ${SERVER_NAME}`,
      '        transport: stdio',
      '        command: node',
      '        args:',
      `          - '${server}'`,
      '        env:',
      `          CHAT_BASE_URL: 'http://127.0.0.1:${PORT}/web/'`,
      `        cwd: '${root}'`,
      '',
    ].join('\n');
  }

  fs.writeFileSync(patchPath, body, 'utf8');
  return { bundleDir, patchPath, scoped: Boolean(official), officialFrom: official ? official.from : null };
}

/** 在常见的 DSH 安装位置里找官方标准预设文件。 */
function findOfficialStandard() {
  const fsx = fs;
  const candidates = [];

  // 1. 显式环境变量（最可靠，跨机器/自定义安装）
  if (process.env.DSH_APP_DIR) {
    candidates.push(path.join(process.env.DSH_APP_DIR, 'node_modules'));
  }

  // 2. 桌面端常见位置：DSH_HOME 无法推出安装目录，改从常见安装前缀猜
  const localApp = process.env.LOCALAPPDATA;
  if (localApp) {
    candidates.push(path.join(localApp, 'Programs', 'DSH Desktop Beta', 'resources', 'app', 'node_modules'));
    candidates.push(path.join(localApp, 'Programs', 'DSH Desktop', 'resources', 'app', 'node_modules'));
  }
  candidates.push('D:/localsoft/DSHDesktop/DSH Desktop Beta/resources/app/node_modules');

  // 3. 当前仓库向上找（若 DSH 源码与站点同处一个工作区）
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    candidates.push(path.join(dir, 'node_modules'));
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }

  // 4. 已在 profile 的 node_modules 里（若 DSH 把 web-app 装进了 profile）
  if (typeof dshHome === 'function') {
    try {
      const h = dshHome();
      candidates.push(path.join(h, 'profiles', 'node_modules'));
      candidates.push(path.join(h, 'node_modules'));
    } catch { /* 忽略 */ }
  }

  for (const base of candidates) {
    const p = path.join(base, '@deepseek-ai', 'dsh-web-app', 'presets', 'standard.patch.yml');
    if (fsx.existsSync(p)) {
      const src = fsx.readFileSync(p, 'utf8');
      const at = src.indexOf('- insert:');
      if (at >= 0) return { block: src.slice(at).replace(/\s+$/, '\n'), from: p };
    }
  }
  return null;
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

/** 建 node_modules 下的作用域目录链接，让 DSH 能 resolve 到 bundle。 */
function ensureLink() {
  const nm = path.join(home, 'profiles', profile, 'node_modules');
  const scope = path.join(nm, '@chinese-history');
  const link = path.join(scope, 'atlas');
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
  // 移除 node_modules 链接
  const link = path.join(home, 'profiles', profile, 'node_modules', '@chinese-history', 'atlas');
  try { if (fs.existsSync(link)) { fs.rmSync(link, { recursive: true, force: true }); removed = true; } } catch { /* 忽略 */ }

  if (removed) {
    ok('已移除连接器：profile bundles / dependencies / 旧条目 / node_modules 链接');
    info('重启 DSH 后生效');
  } else {
    ok('本来就没有安装，无需移除');
  }
  process.exit(0);
}

// ---------- 安装 ----------
// bundle 形态：写 bundle 自己的 patch + 登记 profile + 建链接。
// 不再往 profile 的 cordis.patch.yml 插条目——那样插件页看不到它。
const bundle = writeBundlePatch();
if (!bundle) fail('未找到 plugin-atlas 目录，无法按 bundle 形态安装');

console.log('');
info(`已写入 bundle patch：${path.relative(ROOT, bundle.patchPath)}`);

const pkgBackup = path.join(home, 'profiles', profile, 'package.json') + '.bak-before-atlas-' + stamp();
const pkgPath = path.join(home, 'profiles', profile, 'package.json');
if (fs.existsSync(pkgPath)) { fs.copyFileSync(pkgPath, pkgBackup); info(`已备份 profile package.json`); }

const reg = ensureProfileBundle();
if (!reg.ok) fail('登记 profile bundles 失败：' + reg.reason);
ok(`已登记 bundles：${BUNDLE_NAME}`);

const link = ensureLink();
if (!link.ok) console.log('⚠️  node_modules 链接创建失败：' + link.reason + '\n   可手动执行：mklink /J ' + path.join(home, 'profiles', profile, 'node_modules', '@chinese-history', 'atlas') + ' ' + path.join(ROOT, 'plugin-atlas'));
else ok('已创建 node_modules 链接');

// 复核
const st = profileBundleState();
const checks = [
  [st.present, `profile bundles 含 ${BUNDLE_NAME}`],
  [Boolean(st.dep), 'profile dependencies 已登记'],
  [fs.existsSync(path.join(home, 'profiles', profile, 'node_modules', '@chinese-history', 'atlas', 'cordis.patch.yml')), 'node_modules 链接可达'],
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
