# Rocinante’s Weather

A small, static weather page for two saved locations. No backend: the browser talks to public APIs. Live at **[weather.rocinantes.cc](https://weather.rocinantes.cc)**.

Copyright © 2026 Neil Fluhr.

## Features

- Two location slots (home / away). Tap the place name to change ZIP; geocode runs on Save only.
- **Use my location** on the ZIP sheet (HTTPS + permission). Applies to the *active* slot only—not on every page load.
- Hero: temperature speedometer (−10°F to 110°F, 60° at the top), today’s high/low, precip chance, wind from-direction and gusts. The big current temperature uses the same color as the dial tick at that value (violet → blue → yellow → orange → red).
- Current, Hourly, and Daily forecast tabs. Current is the default on first load (a saved `today` or `?forecast=today` still opens Current; a saved or queried `extended` still opens Daily). Current is the near-term NWS narrative. Hourly is the temperature strip on its own (Now centered, four hours of past, rest of today plus four more days, sticky day labels, and precip chance under each hour). Daily is the 6-day outlook; **highs** (and the tapped-day high) use the dial color scale; lows stay muted. The three panels share one height, sized to the taller of Current and Hourly (and the day strip), so the sections below do not jump when the tab changes. Selecting a day on Daily grows that panel only modestly and the rest of the write-up scrolls inside the box; the day strip stays visible. Current and Hourly stay at the short height.
- Conditions (rain, humidity, dew, visibility, pressure, UV, AQI), Almanac (records, 1991–2020 normals, sun/moon), and Radar. Almanac record and normal highs **and** lows also follow the dial color scale.
- Radar is the first segment on the Radar / Conditions / Almanac switch. Conditions stays the open panel on first load. The Windy embed (radar overlay, zoom 9, mph, °F) is created only when that panel is open, and recenters from the active house’s lat/lon when you switch Home/Away or save a ZIP.
- Light / dark theme. Works as a static site on Cloudflare Pages.

## Data sources

The browser calls these APIs directly. The page footer credits them with the links their licences require.

| Source | Used for | Licence / terms |
| --- | --- | --- |
| [Open-Meteo](https://open-meteo.com/) | Current conditions, hourly temps and precip chance, UV, AQI, daily high/low | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Free API is **non-commercial** (no ads, no paywall). Visible “Weather data by Open-Meteo.com” credit plus licence link. Display is adapted (units, rounding, labels). |
| [National Weather Service](https://www.weather.gov/) | Forecast discussion, 6-day outlook, alerts; grid only if Open-Meteo is missing temp or wind | U.S. government works, not subject to copyright. Not an official NWS product. |
| [RCC-ACIS](https://www.rcc-acis.org/) | Almanac normals/records (nearest climate station; optional bake in `almanac.json`) | Credit on the Almanac panel and in the footer. |
| [Zippopotam.us](https://www.zippopotam.us/) | ZIP → city, lat, lon | [ODbL](https://opendatacommons.org/licenses/odbl/1.0/); data adapted from [GeoNames](https://www.geonames.org/). |
| [BigDataCloud](https://www.bigdatacloud.com/) | Reverse geocode for **Use my location** | Client-side only, current GPS from the device (their fair-use rule). |
| [Windy.com](https://www.windy.com/) | Radar map embed for the active house | Free embed, no API key. Windy’s logo stays inside the map; the page also links to Windy. |

Sun and moon times are computed in the browser from lat/lon.

This site is a **free public** page. Do not add ads, a fee, or a paywall while still calling Open-Meteo’s free endpoint. A sold/commercial build would need their paid API (or an NWS-only weather path).

## Recent changes (2026-09-01)

- Hero current temperature, Daily forecast highs, and Almanac highs/lows use `tempColor()` so they match the dial.
- Footer credits for Open-Meteo (CC BY 4.0), NWS, RCC-ACIS, Zippopotam/GeoNames, and BigDataCloud. Almanac “courtesy RCC-ACIS” is a link. The “Updated” line is timestamp-only.
- Radar map stays 400px tall and full width of the phone column. Windy centers its logo once the iframe is wider than 375px, so on the desktop column (~394px) the embed’s layout box is held at 375px and scaled up to fill the frame. That keeps the logo in the upper left on desktop and on a phone. The house line and Windy credit under the map stay centered.
- Cache-bust query on CSS/JS: `?v=20260927a`.
- Almanac: if `almanac.json` has no day for the current ZIP (the bake is empty on GitHub), fall through to on-demand RCC-ACIS instead of showing unavailable.

## Run locally

```bash
cd public
python3 -m http.server 8765 --bind 127.0.0.1
```

Open http://127.0.0.1:8765 — enough for layout. **Geolocation requires a secure context** (HTTPS, or `localhost`).

HTTPS with a local certificate (see `certs/README.md`):

```bash
python3 serve-https.py --port 8765
```

Then https://127.0.0.1:8765

## Deploy

Cloudflare Pages project: `rocinantes-weather`. From this directory:

```bash
npm install
npx wrangler pages deploy public --project-name rocinantes-weather --commit-dirty=true
```

Output directory is `public/` (`wrangler.toml`). After deploy, wait a few minutes if the custom domain still shows an old cache-busted `?v=` on CSS/JS. Deploy **from this repo folder**, not from `~/public`.

## Project layout

```
public/          # the site
  index.html
  app.js
  styles.css
  almanac.json   # baked normals/records for built-in defaults
  _headers       # Cache-Control
serve-https.py   # local HTTPS
wrangler.toml
```

## Privacy

Location is requested only when you tap **Use my location**. Coordinates stay in the browser (`localStorage` for the active house) and in requests to the weather APIs above. There is no app server and no analytics in this repo.
