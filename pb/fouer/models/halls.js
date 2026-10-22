/* Schueberfouer Tycoon, W4b: the three halls (DESIGN 3.3 / 3.4).  MODELS = { scooter, geister, tent }; see W4b-NOTES.md. */
import { MODELS as SCOOTER } from './hall-scooter.js';
import { MODELS as GEISTER } from './hall-geister.js';
import { MODELS as TENT } from './hall-tent.js';

export const MODELS = Object.assign({}, SCOOTER, GEISTER, TENT);
export default MODELS;
