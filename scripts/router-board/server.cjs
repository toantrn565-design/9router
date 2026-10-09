"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");

const MAX_WINDOWS = 12;
const MAX_BODY = 16 * 1024 * 1024;
const MODEL_ID = /^[A-Za-z0-9._/@:\[\]-]{1,200}$/;
const HOP_HEADERS = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
const API_PATHS = new Set(["/v1/responses", "/v1/responses/compact", "/v1/chat/completions"]);

function problem(status, message) {
  return Object.assign(new Error(message), { status });
}

function json(res, status, value) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

async function readJson(req, limit = MAX_BODY) {
  if (req.headers["content-encoding"] && req.headers["content-encoding"] !== "identity") {
    throw problem(415, "Chi ho tro JSON khong nen.");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw problem(413, "Noi dung qua lon.");
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw problem(400, "JSON khong hop le.");
  }
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function filteredHeaders(headers) {
  const blocked = new Set(HOP_HEADERS);
  for (const name of String(headers.connection || "").split(",")) blocked.add(name.trim().toLowerCase());
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !blocked.has(name) && !["set-cookie", "cookie", "authorization"].includes(name)));
}

async function launchWindowsPane(pane, baseUrl, apiKey) {
  if (process.platform !== "win32") throw problem(400, "Mo cua so Codex can Windows. Cong API van dung duoc.");
  const script = path.resolve(__dirname, "../windows/Start-CodexPane.ps1");
  const cliModel = pane.model.replace(/^(cx|codex)\//, "");
  const shell = path.join(process.env.SystemRoot || "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
  const child = spawn(shell, ["-NoLogo", "-NoProfile", "-NoExit", "-ExecutionPolicy", "Bypass", "-File", script,
    "-Model", cliModel, "-BaseUrl", baseUrl, "-Folder", pane.folder], {
    cwd: pane.folder, detached: true, windowsHide: false, stdio: "ignore",
    env: { ...process.env, JAVIS_ROUTER_API_KEY: apiKey },
  });
  await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  child.unref();
  return child;
}

async function closeWindowsPane(child) {
  if (child.exitCode !== null || child.signalCode) return;
  // Only the shell started by this board and its children are targeted.
  await promisify(execFile)("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
}

function createBoard(options = {}) {
  const apiKey = options.apiKey ?? process.env.JAVIS_ROUTER_API_KEY;
  if (!apiKey || /[\r\n]/.test(apiKey)) throw problem(400, "Can JAVIS_ROUTER_API_KEY hop le.");
  const upstream = new URL(options.upstream || process.env.JAVIS_ROUTER_URL || "http://127.0.0.1:20128");
  if (upstream.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(upstream.hostname)
      || upstream.username || upstream.password || upstream.pathname !== "/" || upstream.search || upstream.hash) {
    throw problem(400, "Router phai la HTTP tren localhost, khong kem duong dan.");
  }
  const port = Number(options.port ?? process.env.JAVIS_BOARD_PORT ?? 20129);
  const firstPort = Number(options.firstPort ?? process.env.JAVIS_FIRST_WINDOW_PORT ?? 20130);
  if (![port, firstPort].every(p => Number.isInteger(p) && p >= 1024 && p <= 65535)
      || firstPort + MAX_WINDOWS - 1 > 65535
      || (port >= firstPort && port < firstPort + MAX_WINDOWS)
      || [port, ...Array.from({ length: MAX_WINDOWS }, (_, i) => firstPort + i)].includes(Number(upstream.port || 80))) {
    throw problem(400, "Cong board/router/cua so phai khac nhau va nam trong khoang hop le.");
  }
  const origin = `http://127.0.0.1:${port}`;
  const stateFile = options.stateFile || path.join(process.env.LOCALAPPDATA || os.homedir(), "Javis9Router", "board.json");
  const launchPane = options.launchPane || launchWindowsPane;
  const closePane = options.closePane || closeWindowsPane;
  const csrfToken = crypto.randomBytes(32).toString("hex");
  const gateways = new Map();
  const children = new Map();
  let panes = [];
  let catalog = [];
  let catalogAt = 0;
  let queue = Promise.resolve();
  let stopping = false;

  function load() {
    if (!fs.existsSync(stateFile)) return;
    try {
      const saved = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      if (saved.version !== 1 || !Array.isArray(saved.panes) || saved.panes.length > MAX_WINDOWS) throw new Error();
      const ids = new Set(), ports = new Set();
      panes = saved.panes.map(p => {
        if (!p || !/^[a-f0-9-]{36}$/.test(p.id) || ids.has(p.id) || ports.has(p.port)
            || !Number.isInteger(p.port) || p.port < firstPort || p.port >= firstPort + MAX_WINDOWS
            || typeof p.model !== "string" || !MODEL_ID.test(p.model) || typeof p.name !== "string" || !p.name.trim() || p.name.length > 80
            || typeof p.folder !== "string" || !path.isAbsolute(p.folder)) throw new Error();
        ids.add(p.id); ports.add(p.port);
        return { id: p.id, name: p.name, model: p.model, folder: p.folder, port: p.port };
      });
    } catch {
      throw problem(400, "board.json hong hoac cong da doi. Sao luu file va sua cau hinh truoc khi mo lai.");
    }
  }

  function save(next) {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o700 });
    const temp = `${stateFile}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify({ version: 1, panes: next }, null, 2), { mode: 0o600 });
      fs.renameSync(temp, stateFile);
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
    panes = next;
  }

  async function models(force = false) {
    if (!force && Date.now() - catalogAt < 60000) return catalog;
    let response;
    try {
      response = await fetch(new URL("/v1/models", upstream), {
        headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15000), redirect: "error",
      });
    } catch { throw problem(502, "Khong doc duoc model. Kiem tra router dang chay."); }
    if (!response.ok) throw problem(502, `Router tra HTTP ${response.status}. Kiem tra API key va tai khoan.`);
    let body;
    try { body = await response.json(); } catch { throw problem(502, "Danh sach model tu router khong hop le."); }
    if (!Array.isArray(body.data)) throw problem(502, "Danh sach model tu router khong hop le.");
    catalog = [...new Map(body.data.filter(m => typeof m?.id === "string" && MODEL_ID.test(m.id)
      && m.capabilities?.tools !== false).map(m => [m.id, { id: m.id, provider: m.owned_by || "router" }])).values()];
    catalogAt = Date.now();
    return catalog;
  }

  function view() {
    return { csrfToken, upstream: upstream.origin, maxWindows: MAX_WINDOWS, platform: process.platform,
      panes: panes.map(p => ({ ...p, running: children.has(p.id), activeRequests: gateways.get(p.id)?.active || 0,
        baseUrl: `http://127.0.0.1:${p.port}/v1` })) };
  }

  function paneById(id) {
    const pane = panes.find(p => p.id === id);
    if (!pane) throw problem(404, "Khong tim thay cua so.");
    return pane;
  }

  function assertIdle(pane) {
    if (children.has(pane.id) || gateways.get(pane.id)?.active) {
      throw problem(409, "Dong cua so va doi yeu cau hoan tat truoc khi sua/xoa.");
    }
  }

  async function validated(input, previous) {
    const name = String(input.name ?? previous?.name ?? "").trim();
    const model = input.model ?? previous?.model;
    const folder = input.folder ?? previous?.folder ?? os.homedir();
    if (!name || name.length > 80) throw problem(400, "Ten cua so can 1–80 ky tu.");
    if (typeof model !== "string" || !MODEL_ID.test(model) || !(await models()).some(m => m.id === model)) {
      throw problem(400, "Chon model trong danh sach router dang cung cap.");
    }
    if (typeof folder !== "string" || !path.isAbsolute(folder)) throw problem(400, "Thu muc can la duong dan day du.");
    try { if (!fs.statSync(folder).isDirectory()) throw new Error(); }
    catch { throw problem(400, "Thu muc lam viec khong ton tai."); }
    return { name, model, folder };
  }

  function listen(server, listenPort) {
    server.requestTimeout = 0;
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(listenPort, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
    });
  }

  async function stopServer(server) {
    server.closeAllConnections();
    if (!server.listening) return;
    await new Promise(resolve => server.close(resolve));
  }

  async function addGateway(pane) {
    const record = { active: 0, pending: new Set(), server: null };
    record.server = http.createServer(async (req, res) => {
      let outbound;
      try {
        if (req.headers.host !== `127.0.0.1:${pane.port}`) throw problem(403, "Host khong duoc phep.");
        if (!safeEqual(req.headers.authorization, `Bearer ${apiKey}`)) throw problem(401, "API key khong hop le.");
        const url = new URL(req.url, `http://127.0.0.1:${pane.port}`);
        if (req.method === "GET" && url.pathname === "/v1/models") {
          const current = paneById(pane.id);
          return json(res, 200, { object: "list", data: [{ id: current.model, object: "model", owned_by: "router-board" }] });
        }
        if (req.method !== "POST" || !API_PATHS.has(url.pathname)) throw problem(404, "Endpoint khong duoc phep.");
        // Lock edits while reading the request as well as while streaming the response.
        record.active++;
        req._boardActive = true;
        const current = paneById(pane.id);
        const body = await readJson(req);
        body.model = current.model;
        if (res.destroyed || stopping) return;
        const bytes = Buffer.from(JSON.stringify(body));
        const headers = filteredHeaders(req.headers);
        for (const name of Object.keys(headers)) {
          if (name === "host" || name.startsWith("x-forwarded-") || name.startsWith("x-9r-") || name === "x-real-ip" || name === "content-length") delete headers[name];
        }
        Object.assign(headers, { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "content-length": bytes.length });
        await new Promise(resolve => {
          outbound = http.request(new URL(url.pathname + url.search, upstream), { method: "POST", headers }, upstreamRes => {
            clearTimeout(headerTimer);
            res.writeHead(upstreamRes.statusCode, filteredHeaders(upstreamRes.headers));
            upstreamRes.on("error", () => { res.destroy(); resolve(); });
            upstreamRes.once("end", resolve);
            upstreamRes.pipe(res);
          });
          record.pending.add(outbound);
          const headerTimer = setTimeout(() => outbound.destroy(new Error("timeout")), 300000);
          headerTimer.unref();
          const cancel = () => { if (!res.writableEnded) outbound.destroy(); };
          res.once("close", cancel);
          outbound.once("error", () => {
            if (!res.headersSent) json(res, 502, { error: "Router khong san sang." });
            else res.destroy();
            resolve();
          });
          outbound.once("close", () => { clearTimeout(headerTimer); record.pending.delete(outbound); res.removeListener("close", cancel); resolve(); });
          outbound.end(bytes);
        });
      } catch (error) {
        if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : "Khong xu ly duoc yeu cau." });
        else res.destroy();
      } finally {
        // Authentication failures never acquire this counter.
        if (req.method === "POST" && outbound) record.pending.delete(outbound);
        if (req._boardActive) record.active--;
      }
    });
    await listen(record.server, pane.port);
    gateways.set(pane.id, record);
  }

  const assets = { "/": ["index.html", "text/html"], "/app.js": ["app.js", "text/javascript"], "/style.css": ["style.css", "text/css"] };
  const server = http.createServer(async (req, res) => {
    try {
      if (stopping) throw problem(503, "Board dang dong.");
      if (req.headers.host !== `127.0.0.1:${port}`) throw problem(403, "Host khong duoc phep.");
      const url = new URL(req.url, origin);
      res.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      res.setHeader("x-content-type-options", "nosniff");
      res.setHeader("referrer-policy", "no-referrer");
      if (req.method === "GET" && assets[url.pathname]) {
        const [file, type] = assets[url.pathname];
        res.writeHead(200, { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store" });
        return res.end(fs.readFileSync(path.join(__dirname, "public", file)));
      }
      if (req.method === "GET" && url.pathname === "/api/state") return json(res, 200, view());
      if (req.method === "GET" && url.pathname === "/api/models") return json(res, 200, { models: await models(url.searchParams.has("refresh")) });
      if (!["POST", "PATCH", "DELETE"].includes(req.method)) throw problem(404, "Khong tim thay.");
      if (req.headers.origin !== origin || !safeEqual(req.headers["x-board-token"], csrfToken)) throw problem(403, "Yeu cau khong den tu board.");
      const input = req.method === "DELETE" ? {} : await readJson(req, 8192);
      const perform = async () => {
        if (stopping) throw problem(503, "Board dang dong.");
        if (req.method === "POST" && url.pathname === "/api/windows") {
          if (panes.length >= MAX_WINDOWS) throw problem(409, "Toi da 12 cua so.");
          const selectedPort = Array.from({ length: MAX_WINDOWS }, (_, i) => firstPort + i).find(p => !panes.some(w => w.port === p));
          const pane = { id: crypto.randomUUID(), ...(await validated(input)), port: selectedPort };
          await addGateway(pane);
          try { save([...panes, pane]); }
          catch (error) { await stopServer(gateways.get(pane.id).server); gateways.delete(pane.id); throw error; }
        } else {
          const match = /^\/api\/windows\/([a-f0-9-]{36})(?:\/(open|close))?$/.exec(url.pathname);
          if (!match) throw problem(404, "Khong tim thay.");
          const pane = paneById(match[1]);
          if (req.method === "PATCH" && !match[2]) {
            assertIdle(pane);
            const updated = { ...pane, ...(await validated(input, pane)) };
            assertIdle(pane);
            save(panes.map(p => p.id === pane.id ? updated : p));
          } else if (req.method === "DELETE" && !match[2]) {
            assertIdle(pane);
            save(panes.filter(p => p.id !== pane.id));
            await stopServer(gateways.get(pane.id).server);
            gateways.delete(pane.id);
          } else if (req.method === "POST" && match[2] === "open") {
            if (children.has(pane.id)) throw problem(409, "Cua so da mo.");
            await validated(pane);
            const child = await launchPane(pane, `http://127.0.0.1:${pane.port}/v1`, apiKey);
            children.set(pane.id, child);
            const exited = () => { if (children.get(pane.id) === child) children.delete(pane.id); };
            child.once("exit", exited);
            child.once("error", exited);
          } else if (req.method === "POST" && match[2] === "close") {
            const child = children.get(pane.id);
            if (!child) throw problem(409, "Cua so chua mo.");
            await closePane(child);
            if (children.get(pane.id) === child) children.delete(pane.id);
          } else throw problem(404, "Khong tim thay.");
        }
        return view();
      };
      const pending = queue.then(perform);
      queue = pending.catch(() => {});
      return json(res, 200, await pending);
    } catch (error) {
      const status = error.status || (error.code === "EADDRINUSE" ? 409 : 500);
      json(res, status, { error: error.status ? error.message : error.code === "EADDRINUSE" ? "Cong da bi ung dung khac su dung." : "Thao tac that bai. Kiem tra quyen luu file va Codex da cai." });
    }
  });

  return {
    url: origin,
    async start() {
      load();
      try {
        for (const pane of panes) await addGateway(pane);
        await listen(server, port);
      } catch (error) { await this.stop(); throw error; }
      return this;
    },
    async stop() {
      stopping = true;
      await queue;
      for (const gateway of gateways.values()) for (const request of gateway.pending) request.destroy();
      await Promise.all([stopServer(server), ...[...gateways.values()].map(g => stopServer(g.server))]);
      gateways.clear();
      // Existing user terminals remain open; reconnect by reopening them after restarting the board.
    },
  };
}

module.exports = { createBoard, MAX_WINDOWS };

if (require.main === module) {
  let board;
  try { board = createBoard(); } catch (error) { console.error(error.message); process.exitCode = 1; }
  if (board) board.start().then(() => {
    console.log(`Router Board: ${board.url}`);
    if (process.platform === "win32") execFile("rundll32.exe", ["url.dll,FileProtocolHandler", board.url], () => {});
    const stop = () => board.stop().then(() => process.exit(0));
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  }).catch(error => { console.error(error.code === "EADDRINUSE" ? "Cong board/cua so da duoc su dung." : error.status ? error.message : "Khong mo duoc Router Board."); process.exitCode = 1; });
}
