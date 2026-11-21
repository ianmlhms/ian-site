/* Ski Alpen online race: every network and race number in one place (pure module).
 * Transport = the Kart Lëtzebuerg pattern (pb/kart-letzebuerg/net.js): WebRTC data channels (reliable "ev" + unreliable "st"), the SDP
 * hand-shake over one Supabase Realtime channel per lobby code, TURN from the `turn` edge function, and a capped Realtime relay for a
 * pair of players that cannot reach each other directly. Topology: a full mesh (every player links to every other), because skiers
 * never touch each other: nobody simulates anybody else, and every message about a player comes over that player's own link. */
export const NET = Object.freeze({
  ICE_SERVERS: Object.freeze([Object.freeze({ urls: 'stun:stun.l.google.com:19302' })]),
  TURN_PATH: '/functions/v1/turn?for=kart',   // the game tier of the edge function (guests allowed, per-IP limit, 2 h TTL)
  CONNECT_TIMEOUT: 10000,       // ms a WebRTC link may take before it counts as failed
  ICE_GATHER_MS: 2500,          // non-trickle hand-shake: wait at most this long for the ICE candidates
  LINK_GRACE: 8000,             // ms a link may stay 'disconnected' (often heals by itself) before it counts as lost
  RTC_TRIES: 2,                 // WebRTC attempts per pair before the relay
  RETRY_MS: 1200,               // ms between two attempts
  SEND_HZ: 12,                  // skier states per second while racing (every link)
  IDLE_HZ: 2,                   // ... while standing at the start or in the finish area
  PING_EVERY: 1000,             // ms: RTT + clock offset per link (the lowest-RTT sample of the last OFFSET_KEEP wins)
  OFFSET_KEEP: 8,
  INTERP_DELAY: 140,            // ms remote skiers are shown in the past (snapshot interpolation)
  EXTRAP_MAX: 300,              // ms a remote skier is carried on with its velocity when packets are late
  RELAY_INTERP_DELAY: 560,
  RELAY_EXTRAP_MAX: 800,
  SILENT: 4500,                 // ms without any packet from a player: shown as away ("?"), never blocks the others
  SILENT_RELAY: 6500,
  GONE: 20000,                  // ms a player may be without any open link before he counts as gone (DNF in the run, "fort" in the table)
  STALL_FRAME: 700,             // ms between two ticks of THIS device that count as a local stall (silence timers move forward)
  /* the relay: one two-member Realtime channel per relayed pair (nobody else pays for its traffic), states batched, a budget */
  RELAY_HZ: 3,                  // messages per second and direction while racing
  RELAY_BATCH: 2,               // states per message (6 states/s)
  RELAY_MATCH_MSGS: 4000,       // budget per pair and direction for one match; from 60 % / 85 % on the rate drops (RELAY_SLOW)
  RELAY_SLOW: Object.freeze([[0.6, 1.5], [0.85, 1]]),
  RELAY_HELLO_MS: 1000,         // until the other side answers on the pair channel
  MAX_PLAYERS: 8,
  /* R7-D free ride: a session lasts as long as friends ski (not one match): a bigger relay budget at a lower rate (4 states / s) */
  FREE_RELAY: Object.freeze({ budget: 14000, hzMax: 2 }),
});

export const RACE = Object.freeze({
  LOAD_TIMEOUT: 30000,          // ms the coordinator waits for slow devices; then the countdown starts without them (they start late)
  MEET_TIMEOUT: 50000,          // ... and for a player it has not met yet (two WebRTC attempts + the relay take ~25 s on a bad network)
  GO_LEAD: 4200,                // ms between the "go" message and the start (the last 3 s are the 3-2-1)
  FINISH_GRACE: 45000,          // ms after the first finish before the run is closed for the rest (DNF) ...
  FINISH_GRACE_SHARE: 0.6,      // ... or this share of the winner's time, whichever is longer
  HARD_CAP: 12 * 60000,         // ms after the start: the run ends whatever happens
  RESULTS_MS: 9000,             // ms the results of a run stay up before the next run is prepared
  LATE_START: 3000,             // ms of countdown for a player who arrives after the start (his time is his own)
  POINTS: Object.freeze([10, 8, 6, 5, 4, 3, 2, 1]),
  MAX_MS: 30 * 60000,           // a reported time above this is nonsense
});

/* pistes that make a good race when the lobby says "random" (or a colour): neither a 300 m link nor a 6 km valley run */
export const RACE_PISTES = Object.freeze({ minLength: 900, maxLength: 3600, minDrop: 200 });
