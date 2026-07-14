# SkyLens live aircraft backend

SkyLens uses one public Supabase Edge Function to give the website, iPhone app,
and Garmin app the same compact aircraft schema. No secret or database migration
is required.

## Deploy

```sh
supabase login
supabase functions deploy skylens --no-verify-jwt --project-ref lvksqmgfwkfbblfsozfk
```

The function queries ADSB.lol first and automatically falls back to
airplanes.live. Both expose compatible readsb-style point feeds. SkyLens shows
the source attribution in its clients.

## Nearby-aircraft contract

```text
GET https://lvksqmgfwkfbblfsozfk.supabase.co/functions/v1/skylens
    ?lat=49.6494&lon=6.2571&radius=30&limit=150
```

Response:

```json
{
  "now": "2026-07-13T21:00:00.000Z",
  "source": "adsb.lol",
  "center": { "lat": 49.6494, "lon": 6.2571 },
  "radiusNm": 30,
  "count": 1,
  "aircraft": [
    {
      "hex": "4D0111",
      "flight": "CLX123",
      "registration": "LX-VCB",
      "type": "B748",
      "description": "BOEING 747-8F",
      "lat": 49.66,
      "lon": 6.25,
      "altitudeFt": 4200,
      "onGround": false,
      "groundSpeedKt": 210,
      "trackDeg": 241,
      "verticalRateFpm": -900,
      "squawk": "1000",
      "category": "A5",
      "seenSeconds": 0.4,
      "distanceNm": 0.75,
      "bearingDeg": 337.5,
      "emergency": false,
      "military": false,
      "special": false,
      "interesting": false,
      "cargo": true
    }
  ]
}
```

`radius` is clamped to 1–250 nautical miles and `limit` to 1–250 aircraft.
Emergency, military, special-aircraft, low-rotorcraft, and routine Cargolux/747
classification follows the PlaneSpotter rules.

## Selected-flight route

```text
GET .../skylens?action=route&callsign=CLX123&lat=49.66&lon=6.25
```

Returns `{callsign,route,origin,destination}`. Route data is best-effort and can
legitimately be null.

## Selected-aircraft photo

```text
GET .../skylens?action=photo&hex=4D0111&registration=LX-VCB
```

Returns either `{photo:{thumbnailUrl,width,height,link,photographer,provider}}`
or `{photo:null}`. The lookup is lazy and only runs when a user opens an
aircraft. It queries the free Planespotters.net Photo API by ICAO hex first and
registration second, keeps metadata cacheable for one hour, and never proxies
or stores image files. Clients must use the original thumbnail URL unchanged,
link the image to `photo.link`, and display `© photographer · Planespotters.net`.
This follows the provider's public Photo API terms, including the maximum
24-hour API-response retention rule.

## Data license and reliability

ADSB.lol publishes its API and data under ODbL 1.0 and notes that production
users should make contact because access requirements may change. SkyLens is a
personal project, identifies itself with a User-Agent, uses a short CDN cache,
limits queries, and has a second feed. If the service's key policy changes,
update only the Edge Function; all clients keep the stable schema.
