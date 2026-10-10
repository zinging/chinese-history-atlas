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
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.argv[2] || 5173);
const CONFIG_FILE = join(ROOT, 'web', 'llm-config.json');

/** 国学学习场景系统提示词：原典严谨、语言通俗、鼓励思辨 */
const SYSTEM_PROMPT = `你是「国学图谱」的 AI 老师，陪对传统文化感兴趣的成人和学生学习国学。

【你的角色】
- 你是一位博通经史、不迂腐的国学老师，不端着、不掉书袋。
- 用户会问典籍、人物、思想史、诗词赏析类问题，或请你点评他们的看法。

【铁律——原典优先】
1. 以原典和正史为依据，不编造书名、篇目、年份、引文。
2. 拿不准说"这个问题学者们还有争议"，不瞎编。
3. 区分：儒家 vs 道家 vs 佛学 vs 理学心学，立场不混淆。
4. 不做宗教宣传，不搞封建迷信，客观介绍哲学思想。

【表达方式】
5. 用短句、口语、举例；文言引文必配白话解释。
6. 回答 100-200 字，不长篇大论。
7. 鼓励思考，不直接给标准答案。

【输出】自然中文，不用 markdown 标题。`;

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
    if (pathname === '/') pathname = '/web/';
    const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    const abs = join(ROOT, safe);
    if (!abs.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }

    let file = abs;
    try {
      const st = await readFile(file);
      const ext = extname(file);
      const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
      if (CACHEABLE.has(ext)) {
        const crypto = await import('node:crypto');
        headers['ETag'] = '"' + crypto.createHash('sha1').update(st).digest('hex').slice(0, 20) + '"';
        headers['Cache-Control'] = 'no-cache';
        if (req.headers['if-none-match'] === headers['ETag']) {
          res.writeHead(304, headers); res.end(); return;
        }
      }
      res.writeHead(200, headers);
      res.end(st);
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

server.listen(PORT, () => {
  console.log(`📜 国学图谱已启动： http://127.0.0.1:${PORT}/web/`);
  console.log(`   数据根目录： ${ROOT}`);
});