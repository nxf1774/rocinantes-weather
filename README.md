# Rocinante’s Weather

A small, static weather page for two saved locations. No backend: the browser talks to public APIs. Live at **[weather.rocinantes.cc](https://weather.rocinantes.cc)**.

Copyright © 2026 Neil Fluhr.

## Features

- Two location slots (home / away). Tap the place name to change ZIP; geocode runs on Save only.
- **Use my location** on the ZIP sheet (HTTPS + permission). Applies to the *active* slot only—not on every page load.
- Hero: temperature speedometer (−10°F to 110°F, 60° at the top), today’s high/low, precip chance, wind from-direction and gusts.
- Today vs Extended Forecast. Hourly temps with Now centered, four hours of past, rest of today plus four more days, sticky day labels.
- Conditions (rain, humidity, dew, visibility, pressure, UV, AQI) and Almanac (records, 1991–2020 normals, sun/moon).
- Light / dark theme. Works as a static site on Cloudflare Pages.

## Data sources

| Source | Used for |
| --- | --- |
| [Open-Meteo](https://open-meteo.com/) | Current conditions, hourly temps, precip probability, UV, daily high/low |
| [National Weather Service](https://www.weather.gov/) | Forecast discussion, 6-day outlook, alerts; grid only if Open-Meteo is missing temp or wind |
| [RCC-ACIS](https://www.rcc-acis.org/) | Almanac normals/records (baked `almanac.json` for the built-in defaults; nearest station for custom ZIPs) |
| [Zippopotam.us](https://www.zippopotam.us/) | ZIP → city, lat, lon |
| [BigDataCloud](https://www.bigdatacloud.com/) | Reverse geocode for **Use my location** |

Sun and moon times are computed in the browser from lat/lon.

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

Output directory is `public/` (`wrangler.toml`). After deploy, wait a few minutes if the custom domain still shows an old cache-busted `?v=` on CSS/JS.

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
