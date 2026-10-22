/* Schueberfouer Tycoon, W4b: the four coaster / water rides (DESIGN 3.3).  MODELS = { maus, looping, alpina, splash }; see W4b-NOTES.md. */
import { MODELS as MAUS } from './coaster-maus.js';
import { MODELS as LOOPING } from './coaster-looping.js';
import { MODELS as ALPINA } from './coaster-alpina.js';
import { MODELS as SPLASH } from './coaster-splash.js';

export const MODELS = Object.assign({}, MAUS, LOOPING, ALPINA, SPLASH);
export default MODELS;
