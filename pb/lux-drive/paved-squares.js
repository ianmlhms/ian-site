/* The paved squares of the city centre (city12, QA3 section 3): in the class raster they are `urban` cells with little built on them (a square is
 * the open space between the houses), so the near-cover rule of world-map.js gave them the meadow - the Place de la Gare was tarmac with lawn
 * blobs.  These polygons are paved stone, whatever the class says (world-map.js writes them into the R channel of the GPU cover; the ground
 * shader paints them with the stone of the squares; the roads are painted over them as everywhere).
 * Traced from OpenStreetMap (ODbL, (c) OpenStreetMap contributors: the area Parvis de la Gare, the platforms and the street edges of the Place de
 * la Gare), world frame (x east, z south, m). */
export const PAVED_SQUARES = Object.freeze([
  {
    name: 'Place de la Gare',      // from the front of the station to the houses across the square (Société Générale, the Post), the bus station island and the north end
                                   // where the Avenue de la Liberté comes in included
    pts: [[5255, 9940], [5318, 9934], [5362, 9944], [5352, 9982], [5322, 9990], [5322, 10003], [5311, 10036], [5290, 10094], [5300, 10104], [5270, 10190], [5252, 10236], [5244, 10160], [5250, 10106], [5262, 10082], [5274, 10018], [5262, 9984]],
  },
  {
    name: 'Parvis de la Gare',     // the forecourt along the station and north of it (the OSM area)
    pts: [[5393.5, 9944.6], [5387.2, 9962.2], [5383.3, 9973.1], [5378.2, 9987.6], [5371, 9985], [5365.4, 10001], [5344, 9996], [5338.1, 10019.8], [5324, 10031.2],
      [5321, 10054.8], [5303.8, 10103.6], [5290.6, 10094.4], [5311.4, 10035.8], [5318.4, 10016.9], [5322.6, 9994.7], [5341.1, 9989.9], [5352.3, 9982.3], [5357.1, 9983.9],
      [5368.4, 9953.1], [5363.1, 9951.4], [5366.9, 9940.4], [5387.4, 9944.6]],
  },
]);
