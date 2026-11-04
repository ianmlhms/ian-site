/* Campus Geesseknäppchen (Merl / Hollerich, Boulevard Pierre Dupong): the schools of the Athénée, the Lycée Aline Mayrisch, the École
 * de Commerce et de Gestion and their neighbours, rebuilt by hand on the real footprints.  The landmark registry (landmarks.js) takes
 * the builders of this list: one model per ZONE of the campus (a zone is one mesh, so a far zone costs no draw call). */
import { CAMPUS } from './campus-data.js';
import { buildZone } from './campus-buildings.js';
import { buildGrounds } from './campus-grounds.js';
import { buildProps } from './campus-props.js';

/** The zones of the campus, from north to south: what is in them is decided in scripts/luxdrive/campus_spec.py. */
export const CAMPUS_ZONES = ['N', 'C', 'S', 'W', 'E'].filter((zone) => CAMPUS.buildings.some((b) => b.zone === zone));

export const CAMPUS_BUILDERS = [
  ...CAMPUS_ZONES.map((zone) => ({ id: `campus-${zone}`, build: ({ ground }) => buildZone(CAMPUS, zone, ground) })),
  { id: 'campus-ground', build: ({ ground }) => buildGrounds(CAMPUS, ground) },     // squares, car parks, pitches, lines: drawn with a polygon offset
  { id: 'campus-props', build: ({ ground }) => buildProps(CAMPUS, ground) },        // bus shelters, bike racks, the wall and hedge
];
