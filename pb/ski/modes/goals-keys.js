/* Goals (pure, tiny): the stable key of a lift, shared by the runtime (modes/goals.js) and the generators (scripts/ski/lift_index.mjs,
 * goals_data.mjs). A lift is known by its OpenStreetMap id (unique inside a resort in every baked resort); hash5 = 5 base-36 characters. */
import { hash5 } from './challenges.js';

/** The key of a resort.json lift (null when it has no OSM id: such a lift is never counted in the cloud record). */
export const liftKey = (lift) => (lift && lift.osm !== undefined && lift.osm !== null && lift.osm !== '' ? hash5(`lift${lift.osm}`) : null);
