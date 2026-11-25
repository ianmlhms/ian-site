import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHit, cleanPath, refHost, isBot, parseUserAgent, luxDay, luxHour, addDays, allowedOrigins, screenClass } from '../src/parse.js';

const ok = { sid: 'abcdef123456', path: '/trails/foo.html', ref: 'https://www.google.com/search?q=secret', w: 820, h: 1180, dpr: 2, lang: 'lb-LU', tz: 'Europe/Luxembourg', kind: 'view', f: 1 };
const body = (o) => JSON.stringify({ ...ok, ...o });

test('a good hit is parsed and unknown fields are dropped', () => {
  const hit = parseHit(body({ evil: 'x', ip: '1.2.3.4' }));
  assert.equal(hit.path, '/trails/foo.html');
  assert.equal(hit.ref, 'google.com');
  assert.equal(hit.first, true);
  assert.equal(hit.lang, 'lb-lu');
  assert.equal('evil' in hit, false);
  assert.equal('ip' in hit, false);
});
test('bad input is refused', () => {
  for (const text of ['', 'nope', '[]', 'null', body({ sid: 'short' }), body({ sid: 'has space in it!!' }), body({ path: 'no-slash' }),
    body({ path: '//evil.com' }), body({ kind: 'bogus' }), body({ kind: 'event' }), body({ kind: 'event', name: '<script>' }), 'x'.repeat(2000)]) {
    assert.equal(parseHit(text), null, text.slice(0, 40));
  }
});
test('pings carry nothing but the session', () => {
  assert.deepEqual(parseHit(JSON.stringify({ sid: 'abcdef123456', kind: 'ping', path: '/x', ref: 'a' })), { kind: 'ping', sid: 'abcdef123456' });
});
test('events need a clean name', () => {
  assert.equal(parseHit(body({ kind: 'event', name: 'game-start' })).name, 'game-start');
});
test('paths lose queries and hashes, except the arcade game id', () => {
  assert.equal(cleanPath('/a/b.html?token=abc#x'), '/a/b.html');
  assert.equal(cleanPath('/index.html'), '/');
  assert.equal(cleanPath('/pixelbreak.html?g=snake&utm=1'), '/pixelbreak.html?g=snake');
  assert.equal(cleanPath('/pixelbreak.html?g=<bad>'), '/pixelbreak.html');
  assert.equal(cleanPath('/other.html?g=snake'), '/other.html');
  assert.equal(cleanPath(`/${'a'.repeat(300)}`).length, 160);
  assert.equal(cleanPath(42), null);
});
test('referrers become hosts, own site and junk become empty', () => {
  assert.equal(refHost('https://www.bing.com/search?q=x'), 'bing.com');
  assert.equal(refHost('https://ian.lu/'), '');
  assert.equal(refHost('javascript:alert(1)'), '');
  assert.equal(refHost(''), '');
});
test('bots are told apart', () => {
  assert.equal(isBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'), true);
  assert.equal(isBot('HeadlessChrome/120'), true);
  assert.equal(isBot(''), true);
  assert.equal(isBot('Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1'), false);
});
test('user agents parse to browser, system and device', () => {
  const ipad = parseUserAgent('Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1');
  assert.deepEqual(ipad, { browser: 'Safari', bver: '18', os: 'iPadOS', osver: '18.6', device: 'tablet' });
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15';
  assert.equal(parseUserAgent(mac, 0).os, 'macOS');
  assert.equal(parseUserAgent(mac, 5).os, 'iPadOS');
  const android = parseUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36');
  assert.deepEqual([android.browser, android.bver, android.os, android.device], ['Chrome', '130', 'Android', 'phone']);
  assert.equal(parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0.1').browser, 'Edge');
  assert.equal(parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/130.0 Mobile/15E148 Safari/605.1.15').browser, 'Firefox');
});
test('Luxembourg day and hour follow the local clock, summer and winter', () => {
  assert.equal(luxDay(Date.parse('2026-11-24T23:30:00Z')), '2026-11-25');   // 00:30 CET
  assert.equal(luxHour(Date.parse('2026-11-24T23:30:00Z')), 0);
  assert.equal(luxDay(Date.parse('2026-07-01T22:30:00Z')), '2026-07-02');   // 00:30 CEST
  assert.equal(luxHour(Date.parse('2026-07-01T21:59:00Z')), 23);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});
test('origins: the site, plus test origins only when the variable names them', () => {
  assert.equal(allowedOrigins({ ALLOWED_ORIGINS: 'https://ian.lu,https://www.ian.lu' }).has('http://localhost:8123'), false);
  assert.equal(allowedOrigins({ ALLOWED_ORIGINS: 'https://ian.lu', TEST_ORIGINS: 'http://localhost:8123' }).has('http://localhost:8123'), true);
});
test('screen classes', () => { assert.deepEqual([0, 390, 820, 1920].map(screenClass), ['?', 'phone', 'tablet / small laptop', 'desktop']); });
