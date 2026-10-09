const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createBoard } = require('../../scripts/router-board/server.cjs');

const KEY = 'mock-router-key';
const MODELS = ['cx/gpt-6-luna', 'cx/gpt-6.1-sol'];
let nextPort = 25000;
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
const rawStatus = (url, headers) => new Promise((resolve, reject) => {
  const req = http.get(url, { headers }, res => { res.resume(); res.once('end', () => resolve(res.statusCode)); });
  req.once('error', reject);
});

async function fixture(t, handler) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'router-board-test-'));
  const received = [], launched = [], closed = [];
  const router = http.createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${KEY}`) { res.writeHead(401); return res.end(); }
    if (req.url === '/v1/models') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ data: MODELS.map(id => ({ id, owned_by: 'cx', capabilities: { tools: true } })) }));
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    received.push({ body, headers: req.headers, url: req.url });
    if (handler) return handler(req, res, body);
    res.setHeader('content-type', 'application/json');
    res.setHeader('set-cookie', 'upstream-secret=hidden');
    res.end(JSON.stringify(body));
  });
  await listen(router);
  const port = nextPort;
  nextPort += 30;
  const config = { apiKey: KEY, upstream: `http://127.0.0.1:${router.address().port}`, port, firstPort: port + 1,
    stateFile: path.join(dir, 'board.json'),
    launchPane: async (pane, url, key) => {
      const child = new EventEmitter();
      child.pid = 1234; child.exitCode = null;
      launched.push({ pane, url, key, child });
      return child;
    },
    closePane: async child => { closed.push(child); child.exitCode = 0; child.emit('exit', 0); },
  };
  let board = await createBoard(config).start();
  t.after(async () => { await board.stop(); await close(router); fs.rmSync(dir, { recursive: true, force: true }); });
  let state = await (await fetch(board.url + '/api/state', { headers: { Connection: 'close' } })).json();
  async function call(route, method = 'GET', body, extra = {}) {
    const response = await fetch(board.url + route, { method, headers: { Connection: 'close', Origin: board.url, 'x-board-token': state.csrfToken, 'content-type': 'application/json', ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (data.panes) state = data;
    return { status: response.status, data };
  }
  const add = (name = 'Code', model = MODELS[0]) => call('/api/windows', 'POST', { name, model, folder: dir });
  return { dir, config, received, launched, closed, call, add, get state() { return state; },
    async restart() { await board.stop(); board = await createBoard(config).start(); state = (await call('/api/state')).data; },
    stop: () => board.stop(), get board() { return board; } };
}

test('add distinct model ports, pin JSON model, forward auth, persist and reuse freed port', async t => {
  const f = await fixture(t);
  assert.equal((await f.add()).status, 200);
  await f.add('Review', MODELS[1]);
  const [a, b] = f.state.panes;
  assert.notEqual(a.port, b.port);
  await Promise.all([a, b].map(async pane => {
    const response = await fetch(pane.baseUrl + '/responses', { method: 'POST', headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json', cookie: 'client=secret', 'x-forwarded-for': '1.2.3.4' }, body: JSON.stringify({ model: 'wrong', input: 'hello' }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal((await response.json()).model, pane.model);
  }));
  assert.deepEqual(f.received.map(r => r.body.model).sort(), MODELS.slice().sort());
  assert.ok(f.received.every(r => !r.headers.cookie && !r.headers['x-forwarded-for']));
  const saved = fs.readFileSync(f.config.stateFile, 'utf8');
  assert.ok(!saved.includes(KEY));
  await f.restart();
  assert.deepEqual(f.state.panes.map(p => p.id), [a.id, b.id]);
  assert.equal((await f.call(`/api/windows/${a.id}`, 'DELETE')).status, 200);
  await f.add('New');
  assert.equal(f.state.panes[1].port, a.port);
});

test('edits route new model; refuse arbitrary model, shell-like model and nonexistent directory', async t => {
  const f = await fixture(t);
  await f.add();
  const pane = f.state.panes[0];
  assert.equal((await f.call(`/api/windows/${pane.id}`, 'PATCH', { model: MODELS[1] })).status, 200);
  const models = await fetch(pane.baseUrl + '/models', { headers: { authorization: `Bearer ${KEY}` } });
  assert.equal((await models.json()).data[0].id, MODELS[1]);
  for (const model of ['missing', 'cx/evil;command']) assert.equal((await f.call(`/api/windows/${pane.id}`, 'PATCH', { model })).status, 400);
  assert.equal((await f.call(`/api/windows/${pane.id}`, 'PATCH', { folder: path.join(f.dir, 'missing') })).status, 400);
});

test('only board origin and CSRF token can mutate; reject rebinding Host and protect gateways', async t => {
  const f = await fixture(t);
  const body = { name: 'Test', model: MODELS[0], folder: f.dir };
  assert.equal((await f.call('/api/windows', 'POST', body, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.call('/api/windows', 'POST', body, { 'x-board-token': 'bad' })).status, 403);
  assert.equal(await rawStatus(f.board.url + '/api/state', { Host: 'attacker.example' }), 403);
  await f.add();
  const pane = f.state.panes[0];
  assert.equal((await fetch(pane.baseUrl + '/models')).status, 401);
  assert.equal(await rawStatus(pane.baseUrl + '/models', { authorization: `Bearer ${KEY}`, Host: 'evil.example' }), 403);
  assert.equal((await fetch(pane.baseUrl.replace('/v1', '/api/settings'), { headers: { authorization: `Bearer ${KEY}` } })).status, 404);
  assert.equal((await fetch(pane.baseUrl + '/responses', { method: 'POST', headers: { authorization: `Bearer ${KEY}` }, body: '{}' })).status, 200);
  assert.ok(!JSON.stringify((await f.call('/api/state')).data).includes(KEY));
});

test('owned windows launch/close once and lock model edits/removal until closed', async t => {
  const f = await fixture(t);
  await f.add(); const pane = f.state.panes[0];
  const route = `/api/windows/${pane.id}`;
  const results = await Promise.all([f.call(route + '/open', 'POST', {}), f.call(route + '/open', 'POST', {})]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(f.launched.length, 1);
  assert.equal(f.launched[0].url, pane.baseUrl);
  assert.equal(f.launched[0].key, KEY);
  assert.equal((await f.call(route, 'PATCH', { model: MODELS[1] })).status, 409);
  assert.equal((await f.call(route, 'DELETE')).status, 409);
  assert.equal((await f.call(route + '/close', 'POST', {})).status, 200);
  assert.equal(f.closed.length, 1);
  assert.equal((await f.call(route, 'DELETE')).status, 200);
});

test('natural shell exit unlocks window and board shutdown does not close user terminals', async t => {
  const f = await fixture(t);
  await f.add(); const route = `/api/windows/${f.state.panes[0].id}`;
  await f.call(route + '/open', 'POST', {});
  f.launched[0].child.emit('exit', 0);
  assert.equal((await f.call('/api/state')).data.panes[0].running, false);
  await f.call(route + '/open', 'POST', {});
  await f.stop();
  assert.equal(f.closed.length, 0);
});

test('stream chunks immediately, block model change while active and cancel upstream on client disconnect', async t => {
  let upstreamClosed;
  const closed = new Promise(resolve => { upstreamClosed = resolve; });
  const f = await fixture(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"chunk":1}\n\n');
    res.once('close', upstreamClosed);
  });
  await f.add(); const pane = f.state.panes[0];
  const response = await fetch(pane.baseUrl + '/responses', { method: 'POST', headers: { authorization: `Bearer ${KEY}` }, body: JSON.stringify({ stream: true, model: 'wrong' }) });
  const reader = response.body.getReader();
  assert.match(Buffer.from((await reader.read()).value).toString(), /chunk/);
  assert.equal((await f.call(`/api/windows/${pane.id}`, 'PATCH', { model: MODELS[1] })).status, 409);
  assert.equal((await f.call(`/api/windows/${pane.id}`, 'DELETE')).status, 409);
  await reader.cancel();
  await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('upstream not cancelled')), 2000).unref())]);
  assert.equal((await f.call(`/api/windows/${pane.id}`, 'PATCH', { model: MODELS[1] })).status, 200);
});

test('preserve router failure and invalid JSON does not leave a busy window', async t => {
  const f = await fixture(t, (req, res) => { res.writeHead(429, { 'retry-after': '60' }); res.end('{"error":"quota"}'); });
  await f.add(); const pane = f.state.panes[0];
  const result = await fetch(pane.baseUrl + '/responses', { method: 'POST', headers: { authorization: `Bearer ${KEY}` }, body: '{}' });
  assert.equal(result.status, 429); assert.equal(result.headers.get('retry-after'), '60');
  await result.text();
  const invalid = await fetch(pane.baseUrl + '/responses', { method: 'POST', headers: { authorization: `Bearer ${KEY}` }, body: 'not json' });
  assert.equal(invalid.status, 400); await invalid.text();
  assert.equal((await f.call(`/api/windows/${pane.id}`, 'DELETE')).status, 200);
});

test('maximum 12 saved windows, simultaneous adds allocate unique ports', async t => {
  const f = await fixture(t);
  await Promise.all(Array.from({ length: 12 }, (_, i) => f.add('Pane ' + i)));
  const state = (await f.call('/api/state')).data;
  assert.equal(state.panes.length, 12);
  assert.equal(new Set(state.panes.map(p => p.port)).size, 12);
  assert.equal((await f.add('Overflow')).status, 409);
});

test('occupied port rolls back add without saving a partial configuration', async t => {
  const f = await fixture(t);
  const blocker = http.createServer();
  await new Promise(resolve => blocker.listen(f.config.firstPort, '127.0.0.1', resolve));
  t.after(() => close(blocker));
  assert.equal((await f.add()).status, 409);
  assert.equal((await f.call('/api/state')).data.panes.length, 0);
  assert.ok(!fs.existsSync(f.config.stateFile));
});

test('corrupt persisted data fails without overwriting it; startup conflict releases earlier listeners', async t => {
  const f = await fixture(t);
  await f.add(); await f.add('Second');
  const original = fs.readFileSync(f.config.stateFile, 'utf8');
  await f.stop();
  const blocker = http.createServer();
  await new Promise(resolve => blocker.listen(f.config.firstPort + 1, '127.0.0.1', resolve));
  t.after(() => close(blocker));
  await assert.rejects(createBoard(f.config).start(), { code: 'EADDRINUSE' });
  const probe = http.createServer();
  await new Promise(resolve => probe.listen(f.config.firstPort, '127.0.0.1', resolve));
  await close(probe);
  fs.writeFileSync(f.config.stateFile, 'bad json');
  await assert.rejects(createBoard(f.config).start(), /board.json/);
  assert.equal(fs.readFileSync(f.config.stateFile, 'utf8'), 'bad json');
  const wrongType = JSON.parse(original);
  wrongType.panes[0].model = 123;
  fs.writeFileSync(f.config.stateFile, JSON.stringify(wrongType));
  await assert.rejects(createBoard(f.config).start(), /board.json/);
  fs.writeFileSync(f.config.stateFile, original);
});
