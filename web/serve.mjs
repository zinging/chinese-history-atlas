#!/usr/bin/env node
/**
 * 中国历史图谱 · 本地静态服务器
 * 用法：node web/serve.mjs [端口]  默认 5173
 * 从项目根服务：/web -> web/，/data -> data/。浏览器打开 http://127.0.0.1:5173/web/
 *
 * 附加 API：
 *  GET  /api/llm-config      读取本地 LLM 配置（不存在返回空对象）
 *  POST /api/llm-config      保存 LLM 配置到本地文件 web/llm-config.json
 *  POST /api/llm/chat        代理调用 OpenAI 兼容接口，附带儿童历史学习系统提示词
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.argv[2] || 5173);
const CONFIG_FILE = join(ROOT, 'web', 'llm-config.json');

/** 儿童历史学习场景系统提示词：史实严谨、语言通俗、鼓励思考、不剧透标准答案 */
const SYSTEM_PROMPT = `你是「历史大冒险」小助手，专门陪 6-12 岁小朋友学中国历史（唐/宋/元/明/清等）。

【你的角色】
- 你是一位耐心、亲切、爱讲故事的历史老师，用小朋友听得懂的话回答。
- 小朋友会问你历史问题、向你复述他们学到的内容、或请你点评他们的想法。

【铁律——史实优先】
1. 只讲有史料依据的内容，不编造人名、地名、年份、事件细节。
2. 拿不准的事要说"历史上没有确切记载"或"学者们有不同说法"，绝不瞎编。
3. 传说、演义（如《三国演义》《水浒传》）要明确区分："正史里……，但传说/小说里……"。
4. 涉及现代领土、民族、宗教的内容，表述要客观中立、尊重现实，不渲染对立。

【表达方式】
5. 用短句、口语、举例，避免文言和生僻词；专有名词第一次出现时用括号解释。
6. 回答控制在 80-150 字（点评可以更短），不要长篇大论。
7. 多用"你觉得呢？""为什么会这样呢？"引导小朋友自己思考。

【互动规则】
8. 小朋友的作业/观点没有标准答案，先肯定他思考的部分，再温和补充史实，不说"你错了"。
9. 如果小朋友答非所问或跑题，轻轻拉回："我们刚才聊的是……，你觉得呢？"
10. 小朋友问与历史无关的事（如"帮我写作业""你是谁"），礼貌说明你的范围。

【输出】
- 自然的中文对话，不用 markdown 标题，最多用一两个 emoji 增加亲切感。`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

const CACHEABLE = new Set(['.jpg', '.jpeg', '.png', '.svg', '.json', '.js', '.mjs', '.css']);
// 带版本号（?v= / ?_v=）的静态资源内容不可变，可长期强缓存
const VERSIONED = /\?v=|\?_v=/;
/* 开发期保护：改了磁盘文件但忘了改 ?v= 时，浏览器会一直用旧缓存（因为上面给了 immutable）。
   对带版本号的请求，回 200 并 no-store 强制重新取一次；代价只是本地开发时多几次请求。
   发布到 GitHub Pages 时本服务不参与，不受影响。 */
const DEV_NO_STORE = process.env.DSH_DEV !== '0';
// 文本类资源压缩后体积降幅大（JSON/JS/CSS 实测 60-75%）
const COMPRESSIBLE = new Set(['.json', '.js', '.mjs', '.css', '.html', '.svg']);

/** ETag 缓存：按 mtime+size 判定文件是否变化，避免每个请求都把整份文件读进内存算哈希
 *  （画像单文件约 300KB-2MB，旧版每请求全量读取+哈希是纯浪费） */
const etagCache = new Map(); // abs -> { mtimeMs, size, etag }
async function etagFor(abs, st) {
  const hit = etagCache.get(abs);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.etag;
  const crypto = await import('node:crypto');
  const buf = await readFile(abs);
  const etag = '"' + crypto.createHash('sha1').update(buf).digest('hex').slice(0, 20) + '"';
  etagCache.set(abs, { mtimeMs: st.mtimeMs, size: st.size, etag });
  return etag;
}

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

const readBody = (req) => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 1e6) reject(new Error('body too large')); });
  req.on('end', () => resolve(body));
  req.on('error', reject);
});

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const pathname = decodeURIComponent(url.pathname);

    // ---- API：LLM 配置读写 ----
    if (pathname === '/api/llm-config') {
      if (req.method === 'GET') {
        try {
          const cfg = JSON.parse(await readFile(CONFIG_FILE, 'utf8'));
          json(res, 200, { ok: true, config: cfg });
        } catch {
          json(res, 200, { ok: true, config: {} });
        }
        return;
      }
      if (req.method === 'POST') {
        try {
          const cfg = JSON.parse(await readBody(req));
          // 只允许白名单字段，避免写入任意内容
          const clean = {};
          for (const k of ['baseUrl', 'apiKey', 'model', 'temperature']) {
            if (typeof cfg[k] === 'string' && cfg[k].trim()) clean[k] = cfg[k].trim();
          }
          if (typeof cfg.temperature === 'number') clean.temperature = Math.max(0, Math.min(2, cfg.temperature));
          await mkdir(dirname(CONFIG_FILE), { recursive: true });
          await writeFile(CONFIG_FILE, JSON.stringify(clean, null, 2));
          json(res, 200, { ok: true, saved: true });
        } catch (e) {
          json(res, 400, { ok: false, error: '配置格式不正确' });
        }
        return;
      }
      json(res, 405, { ok: false, error: 'method not allowed' });
      return;
    }

    // ---- API：LLM 模型列表代理（从配置接口拉取，避免浏览器 CORS）----
    if (pathname === '/api/llm/models') {
      if (req.method !== 'GET') { json(res, 405, { ok: false, error: 'method not allowed' }); return; }
      let cfg;
      try {
        cfg = JSON.parse(await readFile(CONFIG_FILE, 'utf8'));
      } catch {
        json(res, 400, { ok: false, error: '请先保存 LLM 配置' });
        return;
      }
      if (!cfg.baseUrl || !cfg.apiKey) {
        json(res, 400, { ok: false, error: '缺少 baseUrl / apiKey' });
        return;
      }
      // 由 baseUrl 推导 models 端点：去掉尾部 /chat/completions，再拼 /models
      const trimmed = cfg.baseUrl.replace(/\/chat\/completions\/?$/, '').replace(/\/+$/, '');
      const candidates = [trimmed + '/models', trimmed.replace(/\/v1$/, '') + '/models'];
      let lastErr = '';
      for (const url of candidates) {
        try {
          const r = await fetch(url, {
            headers: { 'Authorization': 'Bearer ' + cfg.apiKey },
            signal: AbortSignal.timeout(8000),
          });
          if (!r.ok) { lastErr = `HTTP ${r.status}`; continue; }
          const d = await r.json();
          const models = Array.isArray(d?.data) ? d.data.map((m) => m.id || m).filter(Boolean) : [];
          if (models.length) { json(res, 200, { ok: true, models }); return; }
          lastErr = '模型列表为空';
        } catch (e) {
          lastErr = e.message;
        }
      }
      json(res, 502, { ok: false, error: '拉取模型失败：' + lastErr });
      return;
    }

    // ---- API：LLM 对话代理 ----
    if (pathname === '/api/llm/chat') {
      if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'method not allowed' }); return; }
      let cfg, payload;
      try {
        cfg = JSON.parse(await readFile(CONFIG_FILE, 'utf8'));
        payload = JSON.parse(await readBody(req));
      } catch {
        json(res, 400, { ok: false, error: '请在右上角配置 LLM 后再试' });
        return;
      }
      if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
        json(res, 400, { ok: false, error: '缺少 baseUrl / apiKey / model，请先配置' });
        return;
      }
      const userMsg = typeof payload.message === 'string' ? payload.message : '';
      const extra = Array.isArray(payload.messages) ? payload.messages.filter((m) => m && typeof m.role === 'string' && typeof m.content === 'string') : [];
      if (!userMsg && !extra.length) { json(res, 400, { ok: false, error: '消息为空' }); return; }
      const temp = typeof cfg.temperature === 'number' ? cfg.temperature : 0.7;
      try {
        const r = await fetch(cfg.baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
          body: JSON.stringify({
            model: cfg.model, temperature: temp,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              ...extra,
              { role: 'user', content: userMsg },
            ],
          }),
        });
        const data = await r.json();
        if (!r.ok) {
          json(res, 502, { ok: false, error: `LLM 接口错误 ${r.status}: ${data?.error?.message || '未知错误'}` });
          return;
        }
        const text = data?.choices?.[0]?.message?.content ?? '';
        json(res, 200, { ok: true, reply: text });
      } catch (e) {
        json(res, 502, { ok: false, error: '请求 LLM 失败：' + e.message });
      }
      return;
    }

    // ---- 静态文件 ----
    // 本站标记：MCP 的探活靠它区分「端口是本项目服务」与「被其它程序占用」。
    // 统一在静态响应前设置，覆盖首页、目录补斜杠后的 index.html 等所有分支；
    // 只是响应头，不改变任何页面内容、渲染或前端交互。
    res.setHeader('X-DSH-Atlas', '1');

    // 根路径优先返回仓库根的 index.html（跳转页）；本地没有该文件时才回退到 /web/。
    // 这样本地与 GitHub Pages 行为一致——线上没有把 / 改写成 /web/ 的逻辑，
    // 若本地强制改写，根目录的跳转页就永远测不到。
    if (pathname === '/') {
      let hasRootIndex = false;
      try {
        const st = await stat(join(ROOT, 'index.html'));
        hasRootIndex = st.isFile();
      } catch { /* 没有该文件 */ }
      if (!hasRootIndex) pathname = '/web/';
    }
    const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    const abs = join(ROOT, safe);
    if (!abs.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }

    // 目录访问自动补斜杠：/web -> 301 /web/。
    // 否则浏览器把 /web 当成文件，页面里 style.css / app.js 等相对路径会错挂到根目录，整页失去样式。
    if (!extname(pathname)) {
      try {
        const st = await stat(abs);
        if (st.isDirectory() && !pathname.endsWith('/')) {
          res.writeHead(301, { Location: pathname + '/' + (url.search || '') });
          res.end();
          return;
        }
      } catch { /* 非目录，继续走文件读取 */ }
    }

    let file = abs;
    try {
      const ext = extname(file);
      const versioned = VERSIONED.test(url.search || '');
      const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
      // 带版本号的资源内容不可变 → 强缓存；其余走 no-cache + ETag 协商（改文件名即可绕过）
      headers['Cache-Control'] = versioned ? 'public, max-age=31536000, immutable' : 'no-cache';
      if (versioned && DEV_NO_STORE) {
        // 本地开发兜底：见 DEV_NO_STORE 注释，防止「改了文件忘了改版本号」导致看不到效果
        headers['Cache-Control'] = 'no-store';
      }
      if (CACHEABLE.has(ext)) {
        const st = await stat(file);
        headers['ETag'] = await etagFor(file, st);
        headers['Last-Modified'] = st.mtime.toUTCString();
        if (req.headers['if-none-match'] === headers['ETag']) {
          res.writeHead(304, headers); res.end(); return;
        }
      }
      let body = await readFile(file);
      // gzip：只对文本类且客户端支持时压缩
      const accepts = String(req.headers['accept-encoding'] || '');
      if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(accepts) && body.length > 1024) {
        body = await gzipAsync(body);
        headers['Content-Encoding'] = 'gzip';
        headers.Vary = 'Accept-Encoding';
      }
      headers['Content-Length'] = body.length;
      res.writeHead(200, headers);
      res.end(body);
    } catch (e) {
      if (e.code === 'EISDIR' || (e.code === 'ENOENT' && !extname(file))) {
        try {
          const html = await readFile(join(file, 'index.html'));
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
          return;
        } catch { /* fallthrough */ }
      }
      res.writeHead(404);
      res.end('404 Not Found');
    }
  } catch {
    res.writeHead(500);
    res.end('Server Error');
  }
});

// 端口被占用时明确报错退出：MCP 的 session_start 依赖这条信息判断「是本站占了端口」还是「别的程序占了」
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用。换端口：node web/serve.mjs 8080`);
    process.exit(2);
  }
  console.error('服务启动失败：' + (e && e.message || e));
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`🏮 中国历史图谱已启动： http://127.0.0.1:${PORT}/web/`);
  console.log(`   数据根目录： ${ROOT}`);
});