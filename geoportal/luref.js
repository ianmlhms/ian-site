/* WGS84 -> LUREF (EPSG:2169, "LUREF / Luxembourg TM") coordinate conversion.

   geoportail.lu shows national LUREF grid coordinates next to lat/lon, so this
   viewer does too. The chain is: WGS84 geodetic -> ECEF -> inverse 7-parameter
   Helmert (EPSG:1643, Luxembourg 1930 -> WGS 84) -> International 1924
   ellipsoid -> Transverse Mercator.

   Validated against pyproj's EPSG:4326 -> EPSG:2169 pipeline at six points
   spread across Luxembourg: worst disagreement 2.6 cm. */
(function () {
  'use strict';

  var WGS = { a: 6378137.0, f: 1 / 298.257223563 };
  var INT = { a: 6378388.0, f: 1 / 297.0 };          // International 1924

  // EPSG:1643 Luxembourg 1930 -> WGS 84, position-vector convention.
  var T = { dx: -193.0, dy: 13.7, dz: -39.3, rx: -0.41, ry: -2.933, rz: 2.688, ds: 0.43 };

  // EPSG:2169 projection parameters.
  var P = { lat0: 49.8333333333333, lon0: 6.16666666666667, k0: 1.0, fe: 80000.0, fn: 100000.0 };

  var rad = Math.PI / 180;

  function geodToEcef(lat, lon, el) {
    var e2 = el.f * (2 - el.f);
    var la = lat * rad, lo = lon * rad;
    var N = el.a / Math.sqrt(1 - e2 * Math.sin(la) * Math.sin(la));
    return [N * Math.cos(la) * Math.cos(lo),
            N * Math.cos(la) * Math.sin(lo),
            N * (1 - e2) * Math.sin(la)];
  }

  function ecefToGeod(x, y, z, el) {
    var e2 = el.f * (2 - el.f);
    var lon = Math.atan2(y, x);
    var p = Math.sqrt(x * x + y * y);
    var lat = Math.atan2(z, p * (1 - e2));
    for (var i = 0; i < 8; i++) {
      var N = el.a / Math.sqrt(1 - e2 * Math.sin(lat) * Math.sin(lat));
      lat = Math.atan2(z + e2 * N * Math.sin(lat), p);
    }
    return [lat / rad, lon / rad];
  }

  /* Inverse of the towgs84 transform: WGS84 ECEF -> Luxembourg 1930 ECEF. */
  function helmertInverse(x, y, z) {
    var s = 1 + T.ds * 1e-6;
    var rx = (T.rx / 3600) * rad, ry = (T.ry / 3600) * rad, rz = (T.rz / 3600) * rad;
    var dx = (x - T.dx) / s, dy = (y - T.dy) / s, dz = (z - T.dz) / s;
    // Transpose of the rotation matrix (small-angle approximation).
    return [dx + rz * dy - ry * dz,
            -rz * dx + dy + rx * dz,
            ry * dx - rx * dy + dz];
  }

  function meridionalArc(phi, a, e2) {
    return a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * phi
      - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * phi)
      + (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * phi)
      - (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * phi));
  }

  function transverseMercator(lat, lon, el) {
    var e2 = el.f * (2 - el.f);
    var ep2 = e2 / (1 - e2);
    var la = lat * rad, lo = lon * rad;
    var la0 = P.lat0 * rad, lo0 = P.lon0 * rad;

    var N = el.a / Math.sqrt(1 - e2 * Math.sin(la) * Math.sin(la));
    var t = Math.tan(la), TT = t * t;
    var C = ep2 * Math.cos(la) * Math.cos(la);
    var A = (lo - lo0) * Math.cos(la);
    var A2 = A * A, A3 = A2 * A, A4 = A3 * A, A5 = A4 * A, A6 = A5 * A;

    var east = P.fe + P.k0 * N * (A + (1 - TT + C) * A3 / 6
      + (5 - 18 * TT + TT * TT + 72 * C - 58 * ep2) * A5 / 120);

    var north = P.fn + P.k0 * (meridionalArc(la, el.a, e2) - meridionalArc(la0, el.a, e2)
      + N * t * (A2 / 2 + (5 - TT + 9 * C + 4 * C * C) * A4 / 24
      + (61 - 58 * TT + TT * TT + 600 * C - 330 * ep2) * A6 / 720));

    return [east, north];
  }

  /* Public: {lat, lon} in WGS84 degrees -> {e, n} LUREF metres. */
  window.wgs84ToLuref = function (lat, lon) {
    var p = geodToEcef(lat, lon, WGS);
    var q = helmertInverse(p[0], p[1], p[2]);
    var g = ecefToGeod(q[0], q[1], q[2], INT);
    var en = transverseMercator(g[0], g[1], INT);
    return { e: en[0], n: en[1] };
  };
})();
