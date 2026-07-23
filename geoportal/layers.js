/* Layer catalogue for the geoportal viewer.

   Everything except the OSM fallback comes from geoportail.lu's public open-data
   WMTS (https://wmts1.geoportail.lu/opendata/wmts/), the same service behind the
   official site. Tile matrix sets differ per layer — GLOBAL_WEBMERCATOR for the
   older basemap/roadmap layers, GLOBAL_WEBMERCATOR_4_V3 for the rest — so each
   entry carries its own. */
(function () {
  'use strict';

  var WMTS = 'https://wmts1.geoportail.lu/opendata/wmts';
  var ATTR = '&copy; <a href="https://geoportail.lu" rel="noopener">geoportail.lu</a> / ACT';
  var OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

  function gp(layer, ext, tms, maxZoom) {
    return {
      url: WMTS + '/' + layer + '/' + (tms || 'GLOBAL_WEBMERCATOR_4_V3') + '/{z}/{x}/{y}.' + (ext || 'png'),
      attribution: ATTR,
      maxZoom: maxZoom || 19
    };
  }

  /* Basemaps — exactly one active at a time. */
  window.GEO_BASEMAPS = [
    { id: 'topo', key: 'bmTopo', src: gp('topomap', 'png', 'GLOBAL_WEBMERCATOR', 19) },
    { id: 'basemap', key: 'bmRoad', src: gp('basemap', 'png', 'GLOBAL_WEBMERCATOR', 19) },
    { id: 'topo50', key: 'bmTopo50', src: gp('topo_50k', 'png') },
    { id: 'ortho', key: 'bmOrtho', src: gp('ortho_latest', 'jpeg') },
    { id: 'hybrid', key: 'bmHybrid', src: gp('hybrid', 'jpeg') },
    { id: 'ortho1967', key: 'bmOrtho1967', src: gp('ortho_1967', 'jpeg') },
    { id: 'lidar', key: 'bmLidar', src: gp('lidar_2019_mnt_public', 'png') },
    {
      id: 'osm', key: 'bmOsm', src: {
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: OSM_ATTR, maxZoom: 19
      }
    }
  ];

  /* Raster overlays — any combination, drawn above the basemap. */
  window.GEO_OVERLAYS = [
    { id: 'cadastre', key: 'ovCadastre', src: gp('cadastre', 'png') },
    { id: 'parcels', key: 'ovParcels', src: gp('parcels_labels', 'png') },
    { id: 'buildings', key: 'ovBuildings', src: gp('buildings', 'png') },
    { id: 'addresses', key: 'ovAddresses', src: gp('addresses', 'png') },
    { id: 'toponymes', key: 'ovToponymes', src: gp('toponymes', 'png') },
    { id: 'communes', key: 'ovCommunes', src: gp('communes_labels', 'png') }
  ];
})();
