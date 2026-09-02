# Rocinante’s Weather

A small, static weather page for two saved locations. No backend: the browser talks to public APIs. Live at **[weather.rocinantes.cc](https://weather.rocinantes.cc)**.

Copyright © 2026 Neil Fluhr.

## Features

- Two location slots (home / away). Tap the place name to change ZIP; geocode runs on Save only.
- **Use my location** on the ZIP sheet (HTTPS + permission). Applies to the *active* slot only—not on every page load.
- Hero: temperature speedometer (−10°F to 110°F, 60° at the top), today’s high/low, precip chance, wind from-direction and gusts. The big current temperature uses the same color as the dial tick at that value (violet → blue → yellow → orange → red).
- Today vs Extended Forecast. Hourly temps with Now centered, four hours of past, rest of today plus four more days, sticky day labels, and precip chance under each hour. Extended 6-day **highs** (and the tapped-day high) use the dial color scale; lows stay muted.
- Conditions (rain, humidity, dew, visibility, pressure, UV, AQI) and Almanac (records, 1991–2020 normals, sun/moon). Almanac record and normal highs **and** lows also follow the dial color scale.
- Light / dark theme. Works as a static site on Cloudflare Pages.

## Data sources

The browser calls these APIs directly. The page footer credits them with the links their licences require.

| Source | Used for | Licence / terms |
| --- | --- | --- |
| [Open-Meteo](https://open-meteo.com/) | Current conditions, hourly temps and precip chance, UV, AQI, daily high/low | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Free API is **non-commercial** (no ads, no paywall). Visible “Weather data by Open-Meteo.com” credit plus licence link. Display is adapted (units, rounding, labels). |
| [National Weather Service](https://www.weather.gov/) | Forecast discussion, 6-day outlook, alerts; grid only if Open-Meteo is missing temp or wind | U.S. government works, not subject to copyright. Not an official NWS product. |
| [RCC-ACIS](https://www.rcc-acis.org/) | Almanac normals/records (baked `almanac.json` for the built-in defaults; nearest station for custom ZIPs) | Credit on the Almanac panel and in the footer. |
| [Zippopotam.us](https://www.zippopotam.us/) | ZIP → city, lat, lon | [ODbL](https://opendatacommons.org/licenses/odbl/1.0/); data adapted from [GeoNames](https://www.geonames.org/). |
| [BigDataCloud](https://www.bigdatacloud.com/) | Reverse geocode for **Use my location** | Client-side only, current GPS from the device (their fair-use rule). |

Sun and moon times are computed in the browser from lat/lon.

This site is a **free public** page. Do not add ads, a fee, or a paywall while still calling Open-Meteo’s free endpoint. A sold/commercial build would need their paid API (or an NWS-only weather path).

## Recent changes (2026-09-01)

- Hero current temperature, Extended Forecast highs, and Almanac highs/lows use `tempColor()` so they match the dial.
- Footer credits for Open-Meteo (CC BY 4.0), NWS, RCC-ACIS, Zippopotam/GeoNames, and BigDataCloud. Almanac “courtesy RCC-ACIS” is a link. The “Updated” line is timestamp-only.
- Cache-bust query on CSS/JS: `?v=20260901d`.

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
