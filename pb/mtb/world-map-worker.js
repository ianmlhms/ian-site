/* Builds the world rasters (world-map.js) off the main thread: the page posts the decoded data, gets cover / canopy / field back (the buffers are moved, not copied).
 * Same function as the main thread would run, so the result is identical. */
/* The ?v= on the imports below is generated (scripts/game_importmap.py: import maps do not reach workers); never edit it by hand. */
import { buildWorldMap } from './world-map.js?v=1bb7e60af2';

self.onmessage = (event) => {
  try {
    const map = buildWorldMap(event.data);
    self.postMessage({ ok: true, map }, [map.cover.buffer, map.canopy.buffer, map.field.buffer]);
  } catch (error) {
    self.postMessage({ ok: false, error: String(error && error.message || error) });
  }
};
