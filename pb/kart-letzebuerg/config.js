/* Kart Lëtzebuerg — tuning constants, items, drivers, quality and the time-of-day presets. */
(function () {
  'use strict';
  const KL = window.KL;
  KL.CFG = Object.freeze({
    LAPS: 3,
    MAX_KARTS: 8,
    STEP: 1 / 60,                 // fixed simulation step
    MAX_SPEED: 29,                // m/s on tarmac (about 105 km/h)
    BOOST_SPEED: 39,
    OFFROAD_SPEED: 13,
    SIDEWALK_SPEED: 21,
    ACCEL: 21,
    BRAKE: 42,
    DRAG: 5.5,
    TURN_RATE: 1.9,               // rad/s at full lock
    GRIP: 8.5,                    // rate (1/s) at which sideways velocity is turned into forward velocity
    DRIFT_GRIP: 2.4,
    DRIFT_MIN_SPEED: 11,
    DRIFT_LEVELS: [0.75, 1.55, 2.5],        // charge seconds for blue / orange / purple
    DRIFT_BOOST: [0.55, 1.0, 1.6],          // boost seconds released
    KART_RADIUS: 1.25,
    GRAVITY: 32,
    COUNTDOWN: 3.2,
    ITEM_BOX_RESPAWN: 4,
    ROULETTE: 1.1,
    RESPAWN_DELAY: 1.4,
    SPIN_TIME: 1.15,
  });

  /* Online play (phase 2). Peer-to-peer WebRTC; Supabase Realtime only carries the lobby and the SDP hand-shake. */
  KL.NET = Object.freeze({
    ICE_SERVERS: [{ urls: 'stun:stun.l.google.com:19302' }],       // public STUN only, no TURN
    CONNECT_TIMEOUT: 10000,       // ms a WebRTC link may take before it counts as failed
    ICE_GATHER_MS: 2500,          // wait this long at most for ICE candidates (non-trickle hand-shake = 1 offer + 1 answer per pair)
    SEND_HZ: 20,                  // kart states, both directions
    INTERP_DELAY: 100,            // ms the remote karts are shown in the past (snapshot interpolation)
    EXTRAP_MAX: 150,              // ms a remote kart is extrapolated when snapshots are late
    PING_EVERY: 1000,
    AWAY_SILENCE: 1500,           // ms without packets from a player: their kart is driven by a bot until they are back
    HOST_SILENCE: 2500,           // ms without snapshots from the host: the deputy takes over
    LEAVE_GRACE: 6000,            // ms a client waits for the deputy before ending the race
    LOAD_TIMEOUT: 30000,          // ms the host waits for slow devices to load the track
    FINISH_GRACE: 45,             // s after the first human finish until the race is closed for the rest
    MAX_PLAYERS: 8,
    CODE_ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
    CODE_LEN: 4,
    /* Fallback for a peer that cannot connect through WebRTC: relay via the Supabase Realtime channel.
     * One switch: set RELAY_FALLBACK to false and such a peer is simply refused with a message. */
    RELAY_FALLBACK: true,
    RELAY_HZ: 5,                  // kart states over the relay, at most
    RELAY_MAX_MSGS: 900,          // hard cap of relayed messages per peer and race (~3 minutes at 5 Hz); after that the peer is dropped
    DIR_CHANNEL: 'kl-dir',        // public lobbies for "Quick match"
  });

  /* Items: generic designs, no Nintendo look-alikes. */
  KL.ITEMS = Object.freeze({
    oil:    { id: 'oil',    icon: '🛢️', color: '#2a2a3a' },
    orb:    { id: 'orb',    icon: '🔵', color: '#43c6ff' },
    rocket: { id: 'rocket', icon: '🚀', color: '#ff5a3c' },
    shield: { id: 'shield', icon: '🛡️', color: '#6ee7b7' },
    boost:  { id: 'boost',  icon: '⚡', color: '#ffd23f' },
    boost3: { id: 'boost3', icon: '⚡', color: '#ffb000', count: 3 },
    comet:  { id: 'comet',  icon: '☄️', color: '#c77dff' },
  });
  /* Position-weighted odds (rows: place 1..8). Order: oil orb rocket shield boost boost3 comet */
  KL.ITEM_ORDER = ['oil', 'orb', 'rocket', 'shield', 'boost', 'boost3', 'comet'];
  KL.ITEM_ODDS = [
    [30, 32, 0, 22, 16, 0, 0],
    [24, 28, 14, 16, 18, 0, 0],
    [18, 22, 20, 14, 18, 8, 0],
    [12, 16, 24, 12, 20, 12, 0],
    [8, 10, 26, 10, 22, 16, 4],
    [4, 6, 26, 8, 24, 20, 8],
    [2, 4, 24, 6, 26, 24, 12],
    [0, 2, 22, 6, 26, 28, 16],
  ];

  /* Drivers (cosmetic): kart colour, helmet colour, head style. Luxembourg folklore names, no borrowed characters. */
  KL.DRIVERS = [
    { id: 'renert',   name: 'Renert',    body: '#ff7a1a', trim: '#ffffff', head: 'fox' },
    { id: 'melusina', name: 'Mélusine',  body: '#1fc7a0', trim: '#fff2b0', head: 'round' },
    { id: 'leiw',     name: 'Léiw',      body: '#f2c230', trim: '#7a3b00', head: 'cat' },
    { id: 'kleeschen',name: 'Kleeschen', body: '#d6243a', trim: '#ffffff', head: 'round' },
    { id: 'gromper',  name: 'Gromper',   body: '#b98a4a', trim: '#4a2e12', head: 'round' },
    { id: 'bouneschlupp', name: 'Bouneschlupp', body: '#58b947', trim: '#0f3d12', head: 'horn' },
    { id: 'jang',     name: 'Jang',      body: '#3a86ff', trim: '#ffffff', head: 'cat' },
    { id: 'fraenz',   name: 'Fränz',     body: '#b84dff', trim: '#ffe9ff', head: 'fox' },
  ];

  /* Cups (Grand Prix): four races each. A cup plays the tracks of its list that exist in this build. */
  KL.CUPS = [
    { id: 'letzebuerg', name: 'cup_letzebuerg', tracks: ['villehaute', 'kirchberg', 'grund', 'belval'] },
    { id: 'fantasy', name: 'cup_fantasy', tracks: ['zockerland', 'aisbierg', 'vulkan', 'geeschterschlass'] },
  ];

  KL.DIFFICULTY = {
    easy:   { speed: 0.90, mistakes: 0.9, drift: 0.2, items: 0.4, rubber: 0.05, cut: 0.1 },
    normal: { speed: 0.96, mistakes: 0.5, drift: 0.65, items: 0.75, rubber: 0.05, cut: 0.35 },
    hard:   { speed: 1.01, mistakes: 0.2, drift: 1.0, items: 1.0, rubber: 0.04, cut: 0.7 },
  };

  /* Time of day / weather presets. sky: [zenith, horizon]; fog colour follows the horizon. */
  KL.WEATHER = {
    day:    { sky: ['#4a9be8', '#cfe8f7'], fog: '#cfe8f7', fogNear: 120, fogFar: 520, hemi: ['#ffffff', '#a9a9ad', 0.95], sun: ['#fff1d0', 1.35, [-0.45, 0.8, 0.35]], night: 0, wet: 0, rain: 0, exposure: 1 },
    sunset: { sky: ['#5b4a9a', '#ff9a5a'], fog: '#f2a275', fogNear: 90, fogFar: 460, hemi: ['#ffc9a0', '#6d4a58', 0.8], sun: ['#ff9248', 1.25, [0.8, 0.28, 0.5]], night: 0.25, wet: 0, rain: 0, exposure: 1 },
    night:  { sky: ['#050a22', '#1b2a5c'], fog: '#111a3a', fogNear: 60, fogFar: 330, hemi: ['#5a6fb4', '#1b1f2e', 0.55], sun: ['#7f9bff', 0.45, [-0.3, 0.9, -0.4]], night: 1, wet: 0, rain: 0, exposure: 1 },
    rain:   { sky: ['#6d7885', '#a7b1ba'], fog: '#99a3ad', fogNear: 50, fogFar: 300, hemi: ['#d0d8e0', '#6f7478', 0.85], sun: ['#dbe4ee', 0.5, [-0.3, 0.9, 0.2]], night: 0.15, wet: 1, rain: 1, exposure: 1 },
    snow:   { sky: ['#8fa9cc', '#dce8f5'], fog: '#d6e3f2', fogNear: 45, fogFar: 270, hemi: ['#e8f0fb', '#8f9bb3', 0.92], sun: ['#eef3ff', 0.55, [-0.3, 0.9, 0.2]], night: 0.1, wet: 0.15, rain: 0, snow: 1, exposure: 1 },
    fog:    { sky: ['#8d8fa6', '#b9b4c9'], fog: '#b3adc2', fogNear: 25, fogFar: 200, hemi: ['#d6d0e6', '#5c5668', 0.8], sun: ['#e6dff5', 0.5, [-0.3, 0.9, 0.2]], night: 0.1, wet: 0.3, rain: 0, exposure: 1 },
  };

  KL.QUALITY = {
    low:    { dpr: 1, shadows: false, trees: 0.4, particles: 0.4, far: 380, buildings: 0.7 },
    medium: { dpr: 1.5, shadows: false, trees: 0.75, particles: 0.7, far: 520, buildings: 1 },
    high:   { dpr: 2, shadows: true, trees: 1, particles: 1, far: 700, buildings: 1 },
  };
})();
