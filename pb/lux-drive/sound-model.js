/* The numbers behind the sound of Lux Drive: the gearbox of the engine note, the tyre squeal, the rain level.
 * Pure (no WebAudio), so the harness can check them in Node and sound.js only has to turn them into a signal. */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export const ENGINE = Object.freeze({
  idleRpm: 850,
  redlineRpm: 6200,
  upshiftRpm: 5100,          // the automatic changes up here ...
  downshiftRpm: 2300,        // ... and down here
  // rpm per m/s of road speed in each gear (a small petrol hatchback: 1st tops out near 45 km/h, 5th cruises 130 at 3400 rpm)
  rpmPerMps: Object.freeze([0, 400, 232, 160, 118, 94]),
  shiftDipS: 0.16,           // s: the revs fall and the throttle lifts during a change
  clutchRpm: 1700,           // rpm: pulling away from a standstill slips the clutch up to here
  firingsPerRev: 2,          // a four-cylinder four-stroke fires twice per revolution
});

/**
 * An automatic gearbox that only exists for the ears: from the road speed and the throttle it gives gear and rpm.
 * @returns {{ update(dt:number, speedMps:number, throttle:number): { gear:number, rpm:number, load:number, shifting:boolean } }}
 */
export function createGearbox() {
  let gear = 1, rpm = ENGINE.idleRpm, dip = 0;
  return {
    update(dt, speedMps, throttle) {
      const v = Math.abs(speedMps);
      const ratio = ENGINE.rpmPerMps;
      let wheelRpm = v * ratio[gear];
      if (dip <= 0) {
        if (wheelRpm > ENGINE.upshiftRpm && gear < ratio.length - 1) { gear += 1; dip = ENGINE.shiftDipS; }
        else if (wheelRpm < ENGINE.downshiftRpm && gear > 1) { gear -= 1; dip = ENGINE.shiftDipS * 0.6; }
        wheelRpm = v * ratio[gear];
      } else dip -= dt;
      // the engine never turns slower than idle; at a standstill with the pedal down the clutch slips
      const slip = ENGINE.idleRpm + (ENGINE.clutchRpm - ENGINE.idleRpm) * clamp(throttle, 0, 1) * (1 - smooth(0, 4, v));
      const target = clamp(Math.max(wheelRpm, slip), ENGINE.idleRpm, ENGINE.redlineRpm) * (dip > 0 ? 0.82 : 1);
      rpm += (target - rpm) * Math.min(1, dt * 11);               // the engine has inertia: the note glides
      const load = clamp(throttle, 0, 1) * (dip > 0 ? 0.25 : 1);
      return { gear, rpm, load, shifting: dip > 0 };
    },
  };
}

/** The frequency of the firing pulses of the engine (Hz). */
export const firingHz = (rpm) => (rpm / 60) * ENGINE.firingsPerRev;

/** The tyre squeal: 0..1 from the share of the sideways speed the tyres cannot hold, only while the car really moves. */
export function squealLevel(slip, speedMps, grounded = true) {
  if (!grounded) return 0;
  return clamp((slip - 0.06) / 0.34, 0, 1) * smooth(2.5, 7, Math.abs(speedMps));
}

/** The thud of a collision: 0..1 from the speed into the wall (m/s). Under 1.5 m/s a touch makes no sound. */
export const thudLevel = (intoMps) => (intoMps <= 1.5 ? 0 : 0.15 + 0.85 * clamp((intoMps - 1.5) / 11, 0, 1));

/** The rolling noise of the tyres and the wind: grows with speed, brighter and louder on gravel and grass. */
export function rollLevel(speedMps, surface) {
  const rough = surface === 'gravel' || surface === 'dirt' ? 1.6 : surface === 'grass' ? 1.3 : surface === 'cobble' ? 1.4 : 1;
  return clamp(Math.abs(speedMps) / 38, 0, 1) * rough;
}
