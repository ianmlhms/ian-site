// Real-date Fouer calendar (DESIGN.md section 6). Pure and deterministic from the instant passed in;
// every calendar decision is made in Europe/Luxembourg time through Intl, so DST needs no special cases.

export const TIME_ZONE = "Europe/Luxembourg";
export const FAIR_DAYS = 20;
export const CLAIM_DAYS_AFTER_CLOSE = 7;
export const EVE = { month: 8, day: 23 };
// Overrides win over the rule if the city ever deviates: { 2031: { open: "2031-08-22", close: "2031-09-10" } }.
export const FOUER_DATES = Object.freeze({});

const DAY_MS = 86400000;
const FOUERSONNDEG_FIRST = 8;       // the Sunday that falls in D+8 .. D+14
const FOUERSONNDEG_LAST = 14;
const CEREMONY_START = { hour: 17, minute: 0 };
const CEREMONY_SECONDS = 180;
const PARADE_HOURS = [11, 15];
const PARADE_SECONDS = 180;
const PARADE_BONUS_SECONDS = 3600;
const LAST_DAY_PROMO_HOUR = 20;
const FIREWORKS_HOUR = 22;
const FIREWORKS_SECONDS = 240;
const FIREWORKS_SYNC_SECONDS = 90;
const WEDNESDAY = 3;
const SUNDAY = 0;
// Weekday offsets (Sat..Tue) back to the Friday before 23 August.
const FRIDAY_BEFORE = { 6: -1, 0: -2, 1: -3, 2: -4 };

export const FOUER_RULES = Object.freeze({
  periodGuests: 1.1,
  // Both event days are never a loss: extra counters (cap) cancel the lower prices where stalls are full, more guests and
  // rides cancel them where stalls are not (family day nets +12 %, last day exactly neutral).
  familyDay: { guests: 1.4, price: 0.8, cap: 1.25 },
  lastDay: { guests: 1.25, price: 0.5, uses: 1.6, cap: 2 },
  paradeBonus: 1.3,
  paradeZones: Object.freeze(["M1", "M2"]),           // the pitches facing the main alley
  awayRateBonus: 0.1,
  awayCapBonusHours: 2,
});

const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE, year: "numeric", month: "numeric", day: "numeric",
  hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23",
});

export const toDayNumber = (year, month, day) => Math.round(Date.UTC(year, month - 1, day) / DAY_MS);

export function fromDayNumber(dayNumber) {
  const date = new Date(dayNumber * DAY_MS);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), weekday: date.getUTCDay(), dayNumber };
}

export const isoDate = ({ year, month, day }) =>
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/** Wall-clock parts of an instant in Luxembourg. Throws on a non-finite instant. */
export function luxParts(ms) {
  if (!Number.isFinite(ms)) throw new RangeError(`luxParts needs a finite timestamp, got ${ms}`);
  const parts = Object.fromEntries(formatter.formatToParts(ms).map(part => [part.type, part.value]));
  const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
  const dayNumber = toDayNumber(year, month, day);
  return { year, month, day, hour: Number(parts.hour) % 24, minute: Number(parts.minute), second: Number(parts.second),
    dayNumber, weekday: fromDayNumber(dayNumber).weekday };
}

function parseIsoDay(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text ?? "");
  return match ? toDayNumber(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

/** Opening and closing day of the edition of `year`: the override table first, otherwise the published rule. */
export function fouerDates(year, overrides = FOUER_DATES) {
  if (!Number.isInteger(year) || year < 1900 || year > 2400) throw new RangeError(`Unsupported year ${year}`);
  const override = overrides[year];
  const overrideOpen = parseIsoDay(override?.open), overrideClose = parseIsoDay(override?.close);
  let openDay, closeDay, source = "rule";
  if (overrideOpen !== null && overrideClose !== null && overrideClose >= overrideOpen) {
    openDay = overrideOpen; closeDay = overrideClose; source = "override";
  } else {
    const eveDay = toDayNumber(year, EVE.month, EVE.day);
    const weekday = fromDayNumber(eveDay).weekday;
    openDay = eveDay + (FRIDAY_BEFORE[weekday] ?? 0);
    closeDay = openDay + FAIR_DAYS - 1;
  }
  return { year, openDay, closeDay, open: fromDayNumber(openDay), close: fromDayNumber(closeDay), source };
}

const secondsOfDay = parts => parts.hour * 3600 + parts.minute * 60 + parts.second;
const within = (seconds, start, length) => seconds >= start && seconds < start + length;

/** Next opening on or after the Luxembourg day `dayNumber`. */
function nextOpening(dayNumber, year, overrides) {
  const thisYear = fouerDates(year, overrides);
  const edition = dayNumber <= thisYear.openDay ? thisYear : fouerDates(year + 1, overrides);
  return { year: edition.year, openDay: edition.openDay, open: edition.open, days: edition.openDay - dayNumber };
}

/** Everything the game needs to know about a real instant. */
export function eventsAt(nowMs, { overrides = FOUER_DATES } = {}) {
  const now = luxParts(nowMs);
  const fair = fouerDates(now.year, overrides);
  const dayIndex = now.dayNumber - fair.openDay;
  const active = dayIndex >= 0 && now.dayNumber <= fair.closeDay;
  const seconds = secondsOfDay(now);
  const lastDay = now.dayNumber === fair.closeDay;
  const familyDay = active && now.weekday === WEDNESDAY;
  const fouersonndeg = active && now.weekday === SUNDAY && dayIndex >= FOUERSONNDEG_FIRST && dayIndex <= FOUERSONNDEG_LAST;
  const parade = { day: fouersonndeg, live: false, bonus: false };
  if (fouersonndeg) {
    for (const hour of PARADE_HOURS) {
      const start = hour * 3600;
      if (within(seconds, start, PARADE_SECONDS)) parade.live = true;
      if (within(seconds, start, PARADE_BONUS_SECONDS)) parade.bonus = true;
    }
  }
  const ceremonyStart = CEREMONY_START.hour * 3600 + CEREMONY_START.minute * 60;
  const fireworksStart = FIREWORKS_HOUR * 3600;
  const afterClose = now.dayNumber > fair.closeDay && now.dayNumber <= fair.closeDay + CLAIM_DAYS_AFTER_CLOSE;
  const lastDayPromo = lastDay && now.hour < LAST_DAY_PROMO_HOUR;
  return {
    now,
    today: isoDate(now),
    year: now.year,
    fair: { ...fair, dayIndex, active, before: now.dayNumber < fair.openDay, after: now.dayNumber > fair.closeDay },
    next: nextOpening(now.dayNumber, now.year, overrides),
    ceremony: { day: active && dayIndex === 0, live: active && dayIndex === 0 && within(seconds, ceremonyStart, CEREMONY_SECONDS),
      replay: active && (dayIndex > 0 || (dayIndex === 0 && seconds >= ceremonyStart + CEREMONY_SECONDS)) },
    familyDay,
    fouersonndeg,
    parade,
    lastDay: { day: lastDay, promo: lastDayPromo },
    fireworks: { day: lastDay, live: lastDay && within(seconds, fireworksStart, FIREWORKS_SECONDS),
      sync: lastDay && within(seconds, fireworksStart, FIREWORKS_SYNC_SECONDS),
      claimable: (lastDay && seconds >= fireworksStart) || afterClose },
    stamp: { today: active ? dayIndex : -1, canStamp: active, claimOpen: now.dayNumber >= fair.openDay && now.dayNumber <= fair.closeDay + CLAIM_DAYS_AFTER_CLOSE },
  };
}

/** Income multipliers for a moment, in the shape sim.economy() takes as `ctx`. Weather and time of day are not inputs. */
export function economyContext(events) {
  let guests = 1, price = 1, uses = 1, cap = 1;
  const zones = {};
  if (events.fair.active) guests *= FOUER_RULES.periodGuests;
  if (events.familyDay) {
    guests *= FOUER_RULES.familyDay.guests; price *= FOUER_RULES.familyDay.price; cap *= FOUER_RULES.familyDay.cap;
  }
  if (events.lastDay.promo) {
    guests *= FOUER_RULES.lastDay.guests; price *= FOUER_RULES.lastDay.price; uses *= FOUER_RULES.lastDay.uses;
    cap *= FOUER_RULES.lastDay.cap;
  }
  if (events.parade.bonus) for (const zone of FOUER_RULES.paradeZones) zones[zone] = FOUER_RULES.paradeBonus;
  return { guests, price, uses, cap, bonus: 1, zones };
}

/** Banner ids for the UI, in display order. */
export function bannersAt(events) {
  const banners = [];
  if (events.fair.active) banners.push("fouer");
  if (events.ceremony.live) banners.push("opening");
  if (events.familyDay) banners.push("familljendag");
  if (events.parade.live) banners.push("haemmelsmarsch");
  else if (events.fouersonndeg) banners.push("fouersonndeg");
  if (events.lastDay.promo) banners.push("lastday");
  if (events.fireworks.live) banners.push("fireworks");
  return banners;
}
