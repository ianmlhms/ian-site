import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { resetState } from '../src/worker.js';
import { clearVerdicts } from '../src/auth.js';

const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const calls = [];
let capped = false;
const env = {
  ALLOWED_ORIGINS: 'https://ian.lu,https://www.ian.lu', SUPABASE_URL: 'https://sb.example', SUPABASE_ANON_KEY: 'anon',
  COUNT: {
    idFromName: (name) => name,
    get: () => ({
      hit: async (row) => { calls.push(['hit', row]); return capped ? 'capped' : 'ok'; },
      bot: async () => { calls.push(['bot']); },
      stats: async (from, to, only) => { calls.push(['stats', from, to, only]); return { days: [], live: { count: 0 } }; },
    }),
  },
};
const sent = [];
beforeEach(() => { calls.length = 0; sent.length = 0; capped = false; resetState(); clearVerdicts(); globalThis.fetch = realFetch; });
const realFetch = globalThis.fetch;

function req(method, path, { body = '', origin = 'https://ian.lu', ua = IPAD, headers = {}, cf = { country: 'LU', region: 'Luxembourg', city: 'Luxembourg', asOrganization: 'POST Luxembourg' } } = {}) {
  const h = new Map(Object.entries({ ...(origin ? { origin } : {}), 'user-agent': ua, 'cf-connecting-ip': '195.46.224.37', ...headers }).map(([k, v]) => [k.toLowerCase(), v]));
  return { method, url: `https://ian-count.example${path}`, headers: { get: (k) => h.get(k.toLowerCase()) ?? null }, text: async () => body, cf };
}
async function call(request) {
  const pending = [];
  const response = await worker.fetch(request, env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  return response;
}
const hitBody = (o = {}) => JSON.stringify({ sid: 'abcdef123456', path: '/', ref: '', w: 820, h: 1180, dpr: 2, lang: 'lb', tz: 'Europe/Luxembourg', kind: 'view', tp: 5, ...o });

test('a good hit is answered 204 with CORS and handed to the object with clean facts only', async () => {
  const response = await call(req('POST', '/hit', { body: hitBody() }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://ian.lu');
  assert.equal(calls.length, 1);
  const row = calls[0][1];
  assert.deepEqual([row.country, row.region, row.provider, row.os, row.device, row.browser], ['LU', 'Luxembourg', 'POST Luxembourg', 'iPadOS', 'tablet', 'Safari']);
  const text = JSON.stringify(row);
  for (const secret of ['195.46.224', 'AppleWebKit', 'Mobile/15E148']) assert.equal(text.includes(secret), false, secret);
  assert.equal('city' in row, false);
});
test('wrong or missing origins, wrong bodies and wrong routes do nothing but answer', async () => {
  for (const request of [req('POST', '/hit', { body: hitBody(), origin: 'https://evil.example' }), req('POST', '/hit', { body: hitBody(), origin: '' }),
    req('POST', '/hit', { body: 'garbage' }), req('POST', '/hit', { body: hitBody({ sid: 'x' }) })]) {
    assert.equal((await call(request)).status, 204);
  }
  assert.equal(calls.length, 0);
  assert.equal((await call(req('GET', '/nothing'))).status, 404);
  assert.equal((await call(req('GET', '/hit'))).status, 404);
});
test('localhost counts only when the test variable allows it', async () => {
  await call(req('POST', '/hit', { body: hitBody(), origin: 'http://localhost:8123' }));
  assert.equal(calls.length, 0);
  env.TEST_ORIGINS = 'http://localhost:8123';
  await call(req('POST', '/hit', { body: hitBody(), origin: 'http://localhost:8123' }));
  delete env.TEST_ORIGINS;
  assert.equal(calls.length, 1);
});
test('bots are counted per day and never as visits', async () => {
  await call(req('POST', '/hit', { body: hitBody(), ua: 'Mozilla/5.0 (compatible; Googlebot/2.1)' }));
  assert.deepEqual(calls.map((c) => c[0]), ['bot']);
});
test('one session cannot flood the object', async () => {
  for (let i = 0; i < 60; i += 1) await call(req('POST', '/hit', { body: hitBody({ kind: 'ping' }) }));
  assert.ok(calls.length <= 24, String(calls.length));
});
test('when the object says capped, the Worker stops calling it for a while', async () => {
  capped = true;
  await call(req('POST', '/hit', { body: hitBody() }));
  await call(req('POST', '/hit', { body: hitBody({ sid: 'another-sid-1' }) }));
  assert.equal(calls.length, 1);
});
test('the first view looks the company up with the masked address; the address itself is never stored', async () => {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ name: 'MANPOWER-LU', country: 'LU', type: 'ASSIGNED PA', remarks: [{ description: ['Manpower'] }] }), { status: 200 });
  };
  await call(req('POST', '/hit', { body: hitBody({ f: 1 }) }));
  assert.equal(urls.length, 1);
  assert.match(urls[0], /195\.46\.224\.32$/);
  assert.deepEqual([calls[0][1].org, calls[0][1].orgKind], ['Manpower', 'company']);
  assert.equal(JSON.stringify(calls[0][1]).includes('195.46.224'), false);
  await call(req('POST', '/hit', { body: hitBody({ f: 1, path: '/x', kind: 'ping' }) }));
  assert.equal(urls.length, 1, 'pings never look anything up');
});
test('a register that is down does not lose the visit', async () => {
  globalThis.fetch = async () => { throw new Error('down'); };
  await call(req('POST', '/hit', { body: hitBody({ f: 1 }) }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].org, undefined);
});
test('/stats: no token, a wrong token and a non-admin are all 401; the admin gets the numbers', async () => {
  assert.equal((await call(req('GET', '/stats'))).status, 401);
  globalThis.fetch = async (url, init) => {
    sent.push([String(url), init.headers.authorization]);
    return new Response(init.headers.authorization === 'Bearer ADMINTOKEN-aaaaaaaaaaaaaaaa' ? 'true' : 'false', { status: 200 });
  };
  const withToken = (token) => req('GET', '/stats?from=2026-11-01&to=2026-11-25', { headers: { authorization: `Bearer ${token}` } });
  assert.equal((await call(withToken('USERTOKEN-bbbbbbbbbbbbbbbbbb'))).status, 401);
  assert.equal(calls.length, 0, 'the object is not touched for strangers');
  const ok = await call(withToken('ADMINTOKEN-aaaaaaaaaaaaaaaa'));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { days: [], live: { count: 0 } });
  await call(withToken('ADMINTOKEN-aaaaaaaaaaaaaaaa'));
  assert.equal(sent.filter(([, auth]) => auth.includes('ADMIN')).length, 1, 'the verdict is cached');
  assert.match(sent[0][0], /\/rest\/v1\/rpc\/is_admin$/);
  assert.equal((await call(req('GET', '/stats?from=bad&to=2026-11-25', { headers: { authorization: 'Bearer ADMINTOKEN-aaaaaaaaaaaaaaaa' } }))).status, 400);
});
test('/stats answers CORS preflight for the admin page only', async () => {
  const ok = await call(req('OPTIONS', '/stats'));
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://ian.lu');
  assert.match(ok.headers.get('access-control-allow-headers'), /authorization/);
  assert.equal((await call(req('OPTIONS', '/stats', { origin: 'https://evil.example' }))).headers.get('access-control-allow-origin'), null);
});
