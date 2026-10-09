#!/usr/bin/env node
/* Browser launch is separate. Execute the real game and shared rewards in a
 * minimal DOM to verify currency, save merging and rewards deterministically. */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
class Element {
  constructor() { this.children = []; this.nodes = new Map(); this.handlers = new Map(); this.style = {}; this.dataset = {}; this.hidden = false; this.classes = new Set(); this.classList = { toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name) }; }
  append(...nodes) { this.children.push(...nodes); }
  prepend(...nodes) { this.children.unshift(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  querySelector(selector) { if (!this.nodes.has(selector)) this.nodes.set(selector, new Element()); return this.nodes.get(selector); }
  setAttribute() {}
  addEventListener(name, fn) { this.handlers.set(name, fn); }
  click() { this.handlers.get('click')?.(); }
  showModal() { this.open = true; }
  close() { this.open = false; }
  remove() { this.removed = true; }
  getBoundingClientRect() { return { left: 20, top: 20 }; }
}
let now = Date.UTC(2026, 9, 10, 12), messages = [], scores = [], timers = [];
const nodes = new Map(), events = new Map();
const document = { body: new Element(), createElement: () => new Element(),
  getElementById: id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); }, addEventListener: () => {} };
const parent = { postMessage: message => messages.push(JSON.parse(JSON.stringify(message))) };
const context = { document, parent, console, Intl, Date: class extends Date { static now() { return now; } },
  localStorage: { getItem: () => null }, setInterval() {}, setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; }, clearTimeout() {}, innerWidth: 390, innerHeight: 844,
  addEventListener: (name, fn) => events.set(name, fn), Arcade: { score: n => scores.push(n) },
  __pbStreak: { streak: 5 }, __pbHalloween: true };
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../pb/idle-extras.js', import.meta.url), 'utf8'), context);
const code = fs.readFileSync(new URL('../pb/bus-tycoon.js', import.meta.url), 'utf8');
vm.runInContext(code.replace('  buildShop(); theme();', '  window.test = {snapshot, applySave, production, settle, pushSave, rebirth, refresh, LINES, UPGRADES};\n  buildShop(); theme();'), context);
const game = context.test;
const json = value => JSON.parse(JSON.stringify(value));
const seed = patch => ({ v: 1, p: 0, tb: 0, rb: 0, st: 0, rbc: 0, gd: '', owned: {}, upgrades: [], drivers: 0, savedAt: now, ...patch });
const wave = document.getElementById('wave');
wave.click(); assert.equal(game.snapshot().tb, 1); assert.equal(scores.at(-1), 1);
for (let i = 0; i < 14; i++) wave.click();
const school = document.getElementById('lines').children[0];
school.querySelector('button').click(); assert.equal(game.production(), .5); assert.equal(game.snapshot().p, 0);
now += 2000; game.settle(); assert.equal(game.snapshot().tb, 16); assert.equal(game.snapshot().p, 1);
assert.ok(messages.some(m => m.__pbSave === 1 && m.data.tb === 15));
const beforeBad = json(game.snapshot());
assert.equal(game.applySave({ v: 1, tb: Infinity, owned: {} }), false);
assert.deepEqual(json(game.snapshot()), beforeBad);
assert.equal(game.applySave(seed({ tb: 100, p: 100, rb: 100, owned: { school: 1 }, savedAt: now - 86400000 })), true);
assert.equal(game.snapshot().tb, 7300); assert.equal(game.snapshot().rb, 7300);
assert.equal(game.applySave(seed({ tb: 50, p: 1000 })), false); assert.equal(game.snapshot().tb, 7300);
const box = document.getElementById('rewards-host').children[0];
box.querySelector('.idle-gift').click(); assert.equal(game.snapshot().tb, 7720);
box.querySelector('.idle-gift').click(); assert.equal(game.snapshot().tb, 7720);
const cloud = seed({ tb: 2e12, rb: 1e12, p: 60000, owned: { school: 10 }, upgrades: ['lanes'], drivers: 2 });
const cloudBefore = json(cloud);
assert.equal(game.applySave(cloud), true); assert.deepEqual(cloud, cloudBefore);
assert.equal(game.production(), 20);
document.getElementById('upgrades').children[2].querySelector('button').click();
assert.equal(game.production(), 40); assert.equal(game.snapshot().p, 10000);
document.getElementById('drivers').click(); assert.equal(game.snapshot().drivers, 3); assert.equal(game.snapshot().p, 7500);
box.querySelector('.idle-rebirth').click();
const dialog = document.body.children[0]; assert.equal(dialog.open, true);
dialog.querySelector('.idle-confirm').click();
assert.equal(dialog.open, false); assert.equal(game.snapshot().tb, 2e12); assert.equal(game.snapshot().rb, 0);
assert.equal(game.snapshot().st, 1); assert.equal(game.snapshot().rbc, 1); assert.equal(game.production(), 0);
assert.equal(game.snapshot().drivers, 0); assert.equal(game.snapshot().upgrades.length, 0);
assert.equal(game.applySave(seed({ tb: 3e12, owned: { hyperloop: 1 } })), false);
assert.equal(game.snapshot().tb, 3e12); assert.equal(game.snapshot().rbc, 1); assert.equal(game.production(), 0);
assert.equal(game.applySave(seed({ tb: 2e12, rbc: 2, rb: 0, st: 2, owned: { school: 1 }, savedAt: now + 10000 })), true);
assert.equal(game.snapshot().tb, 3e12); assert.equal(game.production(), .6);
const pumpkinTimer = timers.find(timer => timer.delay >= 45000 && timer.delay <= 90000);
assert.ok(pumpkinTimer); pumpkinTimer.fn();
const pumpkin = document.body.children.find(node => node.className === 'idle-pumpkin');
assert.ok(pumpkin); const pumpkinTotal = game.snapshot().tb; pumpkin.click();
assert.equal(game.snapshot().tb - pumpkinTotal, 18);
assert.equal(pumpkin.removed, true);
assert.deepEqual(messages.find(message => message.__pbEvent), { __pbEvent: { event: 'halloween-2026', count: 1 } });
console.log('PASS Bus Tycoon: tap, passive income, save messages, cloud adoption, validation, no input mutation, offline cap, daily gift, dialog, upgrades, drivers, rebirth, stale-round protection and Halloween pumpkin');

// A deterministic, continuously online planner: choose the purchase minimizing
// waiting time + payback time. This is a balance benchmark, not an optimality claim.
let plan = seed({ owned: Object.fromEntries(game.LINES.map(line => [line.id, line.id === 'school' ? 1 : 0])), tb: 15, rb: 15 }), seconds = 15;
const tierTimes = new Map([['school', seconds]]);
for (let buys = 0; buys < 5000 && plan.tb < 1e12; buys++) {
  const income = game.production(plan);
  const choices = [];
  for (const line of game.LINES) {
    const count = plan.owned[line.id] || 0;
    if (count >= 1000) continue;
    const price = line.cost * 1.15 ** count;
    const next = { ...plan, owned: { ...plan.owned, [line.id]: count + 1 } };
    const delta = game.production(next) - income;
    const wait = Math.max(0, price - plan.p) / income;
    choices.push({ next, price, wait, value: wait + price / delta, id: line.id });
  }
  for (const up of game.UPGRADES) {
    if (plan.upgrades.includes(up.id)) continue;
    const next = { ...plan, upgrades: [...plan.upgrades, up.id] };
    const wait = Math.max(0, up.cost - plan.p) / income;
    choices.push({ next, price: up.cost, wait, value: wait + up.cost / income });
  }
  choices.sort((a, b) => a.value - b.value);
  const best = choices[0], earned = best.wait * income;
  if (plan.tb + earned >= 1e12) { seconds += (1e12 - plan.tb) / income; plan.tb = 1e12; break; }
  seconds += best.wait;
  plan = { ...best.next, p: plan.p + earned - best.price, tb: plan.tb + earned };
  if (best.id && !tierTimes.has(best.id)) tierTimes.set(best.id, seconds);
}
console.log('Balance benchmark (continuous online, no gifts, no more taps):');
for (const [id, time] of tierTimes) console.log(`  ${id}: ${(time / 3600).toFixed(2)} h`);
console.log(`  first star: ${(seconds / 3600).toFixed(2)} h`);
assert.ok(plan.tb >= 1e12, 'benchmark reaches rebirth');

assert.ok(seconds >= 24 * 3600 && seconds <= 7 * 86400, 'first rebirth benchmark spans days');
