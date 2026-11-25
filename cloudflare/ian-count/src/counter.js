// The Durable Object: ONE instance ("main", location hint weur) holds all counter data. It does no background work and holds no
// connection, so it can sleep between calls (free plan: duration and request limits are account-wide, shared with ianlu-inbox).
import { DurableObject } from 'cloudflare:workers';
import { SCHEMA } from './schema.js';
import { Store } from './store.js';
import { luxDay } from './parse.js';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export class IanCount extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.store = new Store(ctx.storage.sql, { rawDays: Number(env.RAW_DAYS) || 180, cap: Number(env.DAILY_WRITE_CAP) || 40_000 });
    this.alarmChecked = false;
    ctx.blockConcurrencyWhile(async () => { this.store.init(SCHEMA); });
  }

  async arm() {
    if (this.alarmChecked) return;
    this.alarmChecked = true;
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + DAY_MS);
  }

  /** One page view / event / ping, already validated and enriched by the Worker. Answers 'ok' or 'capped'. */
  async hit(row) {
    await this.arm();
    return this.store.record(row);
  }

  async bot(ts) {
    await this.arm();
    return this.store.recordBot(luxDay(ts));
  }

  async stats(from, to, only) {
    await this.arm();
    return this.store.stats(from, to, luxDay(Date.now()), only);
  }

  /** Daily: roll finished days up, drop raw rows older than RAW_DAYS and finished test rows. */
  async alarm() {
    const today = luxDay(Date.now());
    this.store.rollupPending(today);
    const more = this.store.purge(today);
    await this.ctx.storage.setAlarm(Date.now() + (more ? HOUR_MS : DAY_MS));
  }
}
