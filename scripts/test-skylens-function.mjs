import assert from "node:assert/strict";

let handler;
let primaryFails = false;

globalThis.Deno = {
  serve(callback) {
    handler = callback;
  },
};

const aircraft = [
  {
    hex: "4d0111", flight: "CLX123 ", r: "LX-VCB", t: "B748",
    lat: 49.66, lon: 6.25, alt_baro: 4200, gs: 210, track: 241,
    baro_rate: -900, squawk: "1000", category: "A5", dbFlags: 0,
  },
  {
    hex: "3f4abc", flight: "GAF123", r: "54+01", t: "A400",
    lat: 49.7, lon: 6.3, alt_baro: 8000, gs: 260, track: 20,
    squawk: "7700", dbFlags: 1,
  },
];

globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.includes("api.planespotters.net/pub/photos")) {
    return Response.json({
      photos: [{
        thumbnail_large: {
          src: "https://cdn.planespotters.net/example_280.jpg",
          size: { width: 420, height: 280 },
        },
        link: "https://www.planespotters.net/photo/123/example",
        photographer: "Test Photographer",
      }],
    });
  }
  if (url.includes("/api/0/routeset")) {
    return Response.json([{ _airport_codes_iata: "LUX-JFK" }]);
  }
  if (url.startsWith("https://api.adsb.lol") && primaryFails) {
    return new Response("down", { status: 503 });
  }
  return Response.json({ ac: aircraft });
};

await import("../supabase/functions/skylens/index.ts");
assert.equal(typeof handler, "function");

const nearby = await handler(new Request(
  "https://example.test/skylens?lat=49.6494&lon=6.2571&radius=30",
));
assert.equal(nearby.status, 200);
const body = await nearby.json();
assert.equal(body.source, "adsb.lol");
assert.equal(body.count, 2);
assert.equal(body.aircraft[0].hex, "3F4ABC");
assert.equal(body.aircraft[0].military, true);
assert.equal(body.aircraft[0].emergency, true);
const cargolux = body.aircraft.find((item) => item.hex === "4D0111");
assert.equal(cargolux.cargo, true);
assert.equal(cargolux.special, false);
assert.equal(typeof cargolux.distanceNm, "number");

primaryFails = true;
const fallback = await handler(new Request(
  "https://example.test/skylens?lat=49.6494&lon=6.2571&limit=1",
));
assert.equal((await fallback.json()).source, "airplanes.live");

const route = await handler(new Request(
  "https://example.test/skylens?action=route&callsign=CLX123&lat=49.66&lon=6.25",
));
assert.deepEqual(await route.json(), {
  callsign: "CLX123", route: "LUX-JFK", origin: "LUX", destination: "JFK",
});

const photo = await handler(new Request(
  "https://example.test/skylens?action=photo&hex=4D0111&registration=LX-VCB",
));
assert.equal(photo.status, 200);
assert.deepEqual(await photo.json(), {
  photo: {
    thumbnailUrl: "https://cdn.planespotters.net/example_280.jpg",
    width: 420,
    height: 280,
    link: "https://www.planespotters.net/photo/123/example",
    photographer: "Test Photographer",
    provider: "Planespotters.net",
  },
});
assert.match(photo.headers.get("cache-control"), /max-age=3600/);

const invalidPhoto = await handler(new Request(
  "https://example.test/skylens?action=photo&hex=not-a-hex",
));
assert.equal(invalidPhoto.status, 400);

console.log("SkyLens Edge Function contract tests passed.");
