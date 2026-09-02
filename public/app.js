/* Copyright (c) 2026 Neil Fluhr. All rights reserved. */

const HOUSES = {
  home: {
    id: "home",
    short: "Home",
    name: "Home",
    zip: "10001",
    lat: 40.7506,
    lon: -73.9971,
  },
  beach: {
    id: "beach",
    short: "Away",
    name: "Away",
    zip: "94102",
    lat: 37.7793,
    lon: -122.4193,
  },
};

function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    /* Safari private mode can block storage */
  }
}

function savedLocations() {
  return readJsonStore("weather-locations");
}

function houseById(id) {
  const key = HOUSES[id] ? id : "home";
  const base = HOUSES[key];
  const over = savedLocations()[key] || {};
  return { ...base, ...over, id: base.id, short: base.short };
}

function currentHouse() {
  const query = new URLSearchParams(window.location.search).get("house");
  const id = HOUSES[query] ? query : storageGet("weather-house") || "home";
  return houseById(id);
}

function almanacSlotFor(house) {
  if (house.zip === HOUSES.home.zip) return "home";
  if (house.zip === HOUSES.beach.zip) return "beach";
  return null;
}

const ACIS_URL = "https://data.rcc-acis.org";
let almanacGen = 0;

function readJsonStore(key) {
  try {
    return JSON.parse(storageGet(key) || "{}") || {};
  } catch (error) {
    return {};
  }
}

function writeJsonStore(key, value) {
  storageSet(key, JSON.stringify(value));
}

function milesBetween(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 3959 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function sidCode(sids, type) {
  const match = (sids || []).find((id) => id.endsWith(` ${type}`));
  return match ? match.split(" ")[0] : "";
}

function rankClimateStations(stations, lat, lon) {
  const scored = [];
  for (const station of stations || []) {
    const sids = station.sids || [];
    const ghcn = sidCode(sids, "6");
    if (!ghcn) continue;
    const ll = station.ll || [];
    if (ll.length < 2) continue;
    const icao = sidCode(sids, "5");
    const faa = sidCode(sids, "3");
    const isUSW = sids.some((id) => id.includes("USW")) || ghcn.startsWith("USW");
    const isAirport = /airport|intl|international|regional|\bap\b/i.test(station.name || "");
    const dist = milesBetween(lat, lon, ll[1], ll[0]);
    let score = dist;
    if (icao) score -= 18;
    else if (isAirport) score -= 14;
    else if (isUSW) score -= 4;
    else score += 18;
    const short = /^[A-Z]{3,4}$/.test(faa) ? faa : icao.replace(/^K/, "") || station.name || ghcn;
    scored.push({
      sid: ghcn,
      name: station.name || short,
      short,
      dist,
      score,
    });
  }
  scored.sort((a, b) => a.score - b.score || a.dist - b.dist);
  const seen = new Set();
  return scored.filter((station) => {
    if (seen.has(station.sid)) return false;
    seen.add(station.sid);
    return true;
  });
}

async function acisPost(path, payload) {
  return fetchJson(`${ACIS_URL}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: 15000,
  });
}

async function resolveClimateStations(house) {
  const cache = readJsonStore("weather-almanac-stations");
  if (cache[house.zip]?.sid) return [cache[house.zip]];
  let ranked = [];
  for (const delta of [0.45, 1.1]) {
    const data = await acisPost("StnMeta", {
      bbox: [house.lon - delta, house.lat - delta, house.lon + delta, house.lat + delta],
      meta: ["name", "state", "ll", "sids"],
      elems: "maxt",
    });
    ranked = rankClimateStations(data.meta || [], house.lat, house.lon);
    if (ranked.some((station) => station.score < station.dist)) break;
  }
  return ranked.slice(0, 4);
}

function cacheClimateStation(zip, station) {
  const cache = readJsonStore("weather-almanac-stations");
  cache[zip] = { sid: station.sid, name: station.name, short: station.short };
  writeJsonStore("weather-almanac-stations", cache);
}

function parseAcisNum(value) {
  if (value == null || value === "M" || value === "T" || value === "") return null;
  return safeNum(value);
}

function yearFromDate(value) {
  const text = String(value || "");
  return /^\d{4}/.test(text) ? text.slice(0, 4) : "";
}

async function fetchStationDay(station, dayKey) {
  const cacheKey = `${station.sid}:${dayKey}`;
  const cache = readJsonStore("weather-almanac-days");
  if (cache[cacheKey]) return { ...cache[cacheKey], station: station.short, name: station.name };
  const [month, day] = dayKey.split("-");
  const date = `${datePartsInZone(new Date(), zoneForHouse()).year}-${month}-${day}`;
  const [normals, records] = await Promise.all([
    acisPost("StnData", {
      sid: station.sid,
      date,
      elems: [
        { name: "maxt", interval: "dly", duration: "dly", normal: "1" },
        { name: "mint", interval: "dly", duration: "dly", normal: "1" },
      ],
    }),
    acisPost("StnData", {
      sid: station.sid,
      sdate: `1871-${month}-${day}`,
      edate: date,
      elems: [
        { name: "maxt", interval: [1, 0, 0], smry: { reduce: "max", add: "date" }, smry_only: 1 },
        { name: "mint", interval: [1, 0, 0], smry: { reduce: "min", add: "date" }, smry_only: 1 },
      ],
    }),
  ]);
  const entry = {
    normalHigh: parseAcisNum(normals.data?.[0]?.[1]),
    normalLow: parseAcisNum(normals.data?.[0]?.[2]),
    recordHigh: parseAcisNum(records.smry?.[0]?.[0]),
    recordHighYear: yearFromDate(records.smry?.[0]?.[1]),
    recordLow: parseAcisNum(records.smry?.[1]?.[0]),
    recordLowYear: yearFromDate(records.smry?.[1]?.[1]),
    station: station.short,
    name: station.name,
    sid: station.sid,
  };
  if (entry.normalHigh == null && entry.recordHigh == null) return null;
  cache[cacheKey] = entry;
  writeJsonStore("weather-almanac-days", cache);
  return entry;
}

async function fetchRemoteAlmanac(house, dayKey) {
  const stations = await resolveClimateStations(house);
  for (const station of stations) {
    try {
      const entry = await fetchStationDay(station, dayKey);
      if (!entry) continue;
      cacheClimateStation(house.zip, station);
      return entry;
    } catch (error) {
      continue;
    }
  }
  return null;
}

const ICONS = {
  sunny: `<svg viewBox="0 0 78 64" fill="none">
    <circle cx="39" cy="32" r="13" stroke="#ff9f0a" stroke-width="2.4"/>
    <path d="M39 8v6.2M39 49.8V56M17.8 32H11.6M66.4 32h-6.2M23.2 16.2l4.4 4.4M50.4 43.4l4.4 4.4M54.8 16.2l-4.4 4.4M27.6 43.4l-4.4 4.4" stroke="#ff9f0a" stroke-width="2.4" stroke-linecap="round"/>
  </svg>`,
  mostlySunny: `<svg viewBox="0 0 78 64" fill="none">
    <circle cx="30" cy="24" r="9" stroke="#ff9f0a" stroke-width="2.2"/>
    <path d="M30 8.5v4.4M16.2 16.2l3.1 3.1M13.2 28h4.4M46.8 16.2l-3.1 3.1" stroke="#ff9f0a" stroke-width="2.1" stroke-linecap="round"/>
    <path d="M24 42.5c0-7 5.6-11.5 12.4-11.5 5.4 0 9.4 2.8 11.2 7.1 1-.4 2.2-.6 3.5-.6 5.5 0 9.9 3.8 9.9 9.2S56.6 56 51.1 56H27.8C21.6 56 18 51.7 18 46.4c0-4.7 3.2-8.7 6-9.9" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>
  </svg>`,
  cloudy: `<svg viewBox="0 0 78 64" fill="none">
    <path d="M22 38.5c0-7.4 6-12.2 13.2-12.2 5.8 0 10 3 11.9 7.6 1.1-.4 2.4-.7 3.8-.7 5.9 0 10.6 4.1 10.6 9.8S56.8 53 50.9 53H26.1C19.6 53 16 48.4 16 42.8c0-5 3.4-9.2 6-10.4" stroke="currentColor" stroke-width="2.3" stroke-linejoin="round"/>
    <path d="M28 28c.8-6.6 6.2-11 12.8-11 5.6 0 9.8 3.2 11.4 7.8" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" opacity="0.72"/>
  </svg>`,
  rain: `<svg viewBox="0 0 78 64" fill="none">
    <path d="M22 32.5c0-7.4 6-12.2 13.2-12.2 5.8 0 10 3 11.9 7.6 1.1-.4 2.4-.7 3.8-.7 5.9 0 10.6 4.1 10.6 9.8S56.8 47 50.9 47H26.1C19.6 47 16 42.4 16 36.8c0-5 3.4-9.2 6-10.4" stroke="currentColor" stroke-width="2.3" stroke-linejoin="round"/>
    <path d="M28 50.5 25 57M39 50.5 36 57M50 50.5 47 57" stroke="#4da3ff" stroke-width="2.2" stroke-linecap="round"/>
  </svg>`,
  storm: `<svg viewBox="0 0 78 64" fill="none">
    <path d="M22 30.5c0-7.4 6-12.2 13.2-12.2 5.8 0 10 3 11.9 7.6 1.1-.4 2.4-.7 3.8-.7 5.9 0 10.6 4.1 10.6 9.8S56.8 45 50.9 45H26.1C19.6 45 16 40.4 16 34.8c0-5 3.4-9.2 6-10.4" stroke="currentColor" stroke-width="2.3" stroke-linejoin="round"/>
    <path d="M36 42 30 52h8l-4 10 12-14h-8l4-6h-6Z" fill="#ffd60a"/>
  </svg>`,
  fog: `<svg viewBox="0 0 78 64" fill="none">
    <path d="M22 28.5c0-7.4 6-12.2 13.2-12.2 5.8 0 10 3 11.9 7.6 1.1-.4 2.4-.7 3.8-.7 5.9 0 10.6 4.1 10.6 9.8" stroke="currentColor" stroke-width="2.3" stroke-linejoin="round"/>
    <path d="M16 40h46M20 47h38M24 54h30" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.72"/>
  </svg>`,
  snow: `<svg viewBox="0 0 78 64" fill="none">
    <path d="M22 30.5c0-7.4 6-12.2 13.2-12.2 5.8 0 10 3 11.9 7.6 1.1-.4 2.4-.7 3.8-.7 5.9 0 10.6 4.1 10.6 9.8S56.8 45 50.9 45H26.1C19.6 45 16 40.4 16 34.8c0-5 3.4-9.2 6-10.4" stroke="currentColor" stroke-width="2.3" stroke-linejoin="round"/>
    <path d="M28 51.5v8M24.4 53.6l7.2 3.8M24.4 57.4l7.2-3.8M48 51.5v8M44.4 53.6l7.2 3.8M44.4 57.4l7.2-3.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`,
  night: `<svg viewBox="0 0 78 64" fill="none">
    <path d="M42 14.5a13 13 0 1 0 8.8 22.6A13.6 13.6 0 0 1 42 14.5Z" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>
  </svg>`,
};

function weatherFromCode(code, isDay) {
  if (code === 0) return { label: isDay ? "Sunny" : "Clear", icon: isDay ? ICONS.sunny : ICONS.night };
  if (code === 1) return { label: isDay ? "Mostly Sunny" : "Mostly Clear", icon: isDay ? ICONS.mostlySunny : ICONS.night };
  if (code === 2) return { label: "Partly Cloudy", icon: isDay ? ICONS.mostlySunny : ICONS.cloudy };
  if (code === 3) return { label: "Mostly Cloudy", icon: ICONS.cloudy };
  if (code === 45 || code === 48) return { label: "Foggy", icon: ICONS.fog };
  if ([51, 53, 55, 56, 57].includes(code)) return { label: "Drizzle", icon: ICONS.rain };
  if ([61, 80].includes(code)) return { label: "Light Rain", icon: ICONS.rain };
  if ([63, 81].includes(code)) return { label: "Rain", icon: ICONS.rain };
  if ([65, 82].includes(code)) return { label: "Heavy Rain", icon: ICONS.rain };
  if ([66, 67].includes(code)) return { label: "Freezing Rain", icon: ICONS.rain };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { label: "Snow", icon: ICONS.snow };
  if ([95, 96, 99].includes(code)) return { label: "Thunderstorms", icon: ICONS.storm };
  return { label: "Mostly Cloudy", icon: ICONS.cloudy };
}

function compass(degrees) {
  if (degrees == null || Number.isNaN(degrees)) return "—";
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(degrees / 22.5) % 16];
}

function hpaToInHg(hpa) {
  return hpa * 0.0295299830714;
}



function uvInfo(index) {
  const n = Math.round(index ?? 0);
  if (n <= 2) return { n, risk: `${n}-Low Risk`, level: "Low" };
  if (n <= 5) return { n, risk: `${n}-Moderate Risk`, level: "Moderate" };
  if (n <= 7) return { n, risk: `${n}-High Risk`, level: "High" };
  if (n <= 10) return { n, risk: `${n}-Very High Risk`, level: "Very High" };
  return { n, risk: `${n}-Extreme Risk`, level: "Extreme" };
}

function aqiInfo(aqi) {
  if (aqi == null || Number.isNaN(aqi)) return { label: "—", level: "US AQI" };
  const n = Math.round(aqi);
  if (n <= 50) return { label: `${n} · Good`, level: "Good" };
  if (n <= 100) return { label: `${n} · Moderate`, level: "Moderate" };
  if (n <= 150) return { label: `${n} · Unhealthy*`, level: "Sensitive groups" };
  if (n <= 200) return { label: `${n} · Unhealthy`, level: "Unhealthy" };
  if (n <= 300) return { label: `${n} · Very Unhealthy`, level: "Very Unhealthy" };
  return { label: `${n} · Hazardous`, level: "Hazardous" };
}

function formatInches(value) {
  if (value == null || Number.isNaN(value)) return "—";
  if (value < 0.005) return "0.00 in";
  return `${value.toFixed(2)} in`;
}

function windIcon(degrees) {
  const deg = Number(degrees);
  const hasDir = degrees != null && !Number.isNaN(deg);
  const rotate = hasDir ? (((deg + 180) % 360) + 360) % 360 : 0;
  const arrow = hasDir
    ? `<g transform="rotate(${rotate} 18 18)">
        <path d="M18 7.2 22.4 16.8 18 14.8 13.6 16.8Z" fill="#4da3ff"/>
        <path d="M18 14.6v10.2" stroke="#4da3ff" stroke-width="2" stroke-linecap="round"/>
      </g>`
    : "";
  return `<svg viewBox="0 0 36 36">
    <circle cx="18" cy="18" r="11" fill="none" stroke="currentColor" stroke-width="1.6"/>
    <path d="M18 8v2.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    ${arrow}
  </svg>`;
}

function pressureIcon(trend) {
  const falling = trend === "Falling";
  const rising = trend === "Rising";
  const rotation = falling ? "" : rising ? ` transform="rotate(180 18 18)"` : ` transform="rotate(90 18 18)"`;
  return `<svg viewBox="0 0 36 36">
    <circle cx="18" cy="18" r="11" fill="none" stroke="currentColor" stroke-width="1.6"/>
    <path d="M18 12.4v11.2M13.6 19.2 18 23.6l4.4-4.4"${rotation} fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function currentHourIndex(times) {
  const now = Date.now();
  let best = 0;
  let bestDiff = Infinity;
  times.forEach((stamp, i) => {
    const diff = Math.abs(new Date(stamp).getTime() - now);
    if (diff < bestDiff) {
      best = i;
      bestDiff = diff;
    }
  });
  return best;
}

function sumPast24Hours(times, values) {
  const now = Date.now();
  const windowMs = 24 * 60 * 60 * 1000;
  return times.reduce((sum, stamp, index) => {
    const age = now - new Date(stamp).getTime();
    if (age >= 0 && age <= windowMs) return sum + (values[index] || 0);
    return sum;
  }, 0);
}

function pressureTrend(times, values, currentHpa) {
  const idx = currentHourIndex(times);
  const earlier = values[Math.max(0, idx - 3)];
  if (earlier == null || currentHpa == null) return "Steady";
  const delta = currentHpa - earlier;
  if (delta <= -0.6) return "Falling";
  if (delta >= 0.6) return "Rising";
  return "Steady";
}

async function fetchJson(url, options = {}) {
  const { timeoutMs = 15000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      ...fetchOptions,
      headers: fetchOptions.headers,
    });
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function safeNum(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cToF(celsius) {
  return celsius * (9 / 5) + 32;
}

function metersToMiles(meters) {
  return meters / 1609.344;
}

async function loadOpenMeteo() {
  const params = new URLSearchParams({
    latitude: String(currentHouse().lat),
    longitude: String(currentHouse().lon),
    current: [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "precipitation",
      "weather_code",
      "cloud_cover",
      "pressure_msl",
      "wind_speed_10m",
      "wind_direction_10m",
      "wind_gusts_10m",
      "dew_point_2m",
      "visibility",
      "is_day",
    ].join(","),
    hourly: "temperature_2m,precipitation,precipitation_probability,pressure_msl,uv_index,weather_code,is_day",
    daily: "precipitation_sum,uv_index_max,temperature_2m_max,temperature_2m_min",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: zoneForHouse(),
    past_days: "1",
    forecast_days: "5",
  });

  return fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`);
}

async function loadAirQuality() {
  const params = new URLSearchParams({
    latitude: String(currentHouse().lat),
    longitude: String(currentHouse().lon),
    current: "us_aqi",
    timezone: zoneForHouse(),
  });
  return fetchJson(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`);
}

async function loadNwsAlerts() {
  const house = currentHouse();
  return fetchJson(`https://api.weather.gov/alerts/active?point=${house.lat},${house.lon}`, {
    headers: { Accept: "application/geo+json" },
  });
}

function alertRank(event) {
  const name = String(event || "").toLowerCase();
  if (name.includes("warning") || name.includes("emergency")) return 2;
  if (name.includes("watch")) return 1;
  return 0;
}

function formatAlertUntil(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    timeZone: zoneForHouse(),
    hour: "numeric",
    minute: "2-digit",
  });
}

function pickAlert(payload) {
  const override = new URLSearchParams(window.location.search).get("alert");
  if (override === "watch" || override === "warning") {
    return {
      level: override,
      title: override === "warning" ? "Severe Thunderstorm Warning" : "Severe Thunderstorm Watch",
      meta: override === "warning" ? "Until 8:15 PM · Example County" : "Until 10:00 PM · Example County",
    };
  }

  const features = payload?.features || [];
  const now = Date.now();
  const scored = features
    .map((feature) => feature.properties || {})
    .filter((props) => {
      if (props.status && props.status !== "Actual") return false;
      const end = props.ends || props.expires;
      if (end && new Date(end).getTime() < now) return false;
      return alertRank(props.event) > 0;
    })
    .sort((a, b) => alertRank(b.event) - alertRank(a.event));

  const top = scored[0];
  if (!top) return null;
  const extra = scored.length > 1 ? ` · +${scored.length - 1} more` : "";
  const area = String(top.areaDesc || "")
    .split(";")[0]
    .trim();
  const until = formatAlertUntil(top.ends || top.expires);
  return {
    level: alertRank(top.event) === 2 ? "warning" : "watch",
    title: top.event || "Weather alert",
    meta: [until ? `Until ${until}` : "", area].filter(Boolean).join(" · ") + extra,
  };
}

function renderAlerts(payload) {
  const alert = pickAlert(payload);
  const banner = document.getElementById("alert-banner");
  if (!alert) {
    delete document.documentElement.dataset.alert;
    if (banner) banner.hidden = true;
    return;
  }
  document.documentElement.dataset.alert = alert.level;
  setText("alert-title", alert.title);
  setText("alert-meta", alert.meta);
  if (banner) banner.hidden = false;
}

async function loadNwsForecast() {
  const house = currentHouse();
  const headers = { Accept: "application/geo+json" };
  const point = await fetchJson(`https://api.weather.gov/points/${house.lat},${house.lon}`, { headers });
  const forecastUrl = point.properties?.forecast;
  const gridUrl = point.properties?.forecastGridData;
  if (!forecastUrl) throw new Error("No NWS forecast URL");
  const forecast = await fetchJson(forecastUrl, { headers });
  return { forecast, gridUrl, grid: null };
}

function needsNwsGrid(meteo) {
  const current = meteo?.current;
  if (!current) return true;
  return (
    safeNum(current.temperature_2m) == null ||
    safeNum(current.wind_speed_10m) == null ||
    safeNum(current.wind_direction_10m) == null
  );
}

async function loadNwsGrid(gridUrl) {
  if (!gridUrl) return null;
  return fetchJson(gridUrl, { headers: { Accept: "application/geo+json" } }).catch(() => null);
}

function nwsSeriesValue(series, when = Date.now()) {
  const values = series?.values;
  if (!Array.isArray(values) || !values.length) return null;
  let latest = null;
  for (const item of values) {
    const [start, duration] = String(item.validTime || "").split("/");
    const startMs = new Date(start).getTime();
    if (Number.isNaN(startMs)) continue;
    let spanMs = 3600000;
    const match = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(duration || "");
    if (match) spanMs = Number(match[1] || 0) * 3600000 + Number(match[2] || 0) * 60000;
    const endMs = startMs + Math.max(spanMs, 1);
    if (when >= startMs && when < endMs) return item.value;
    if (when >= startMs) latest = item.value;
  }
  return latest;
}

function kmhToMph(kmh) {
  return kmh * 0.621371;
}

function pickNearTerm(periods = []) {
  const daytime = periods.find(
    (period) => period.isDaytime && /^(today|this morning|this afternoon)$/i.test(period.name || "")
  );
  if (daytime) return { period: daytime, kind: "today" };
  const tonight =
    periods.find((period) => /tonight/i.test(period.name || "")) ||
    periods.find((period) => period.isDaytime === false);
  if (tonight) return { period: tonight, kind: "tonight" };
  const first = periods[0];
  return { period: first, kind: first?.isDaytime ? "today" : "tonight" };
}

const DAY_ICONS = {
  sunny: `<svg viewBox="0 0 36 32" fill="none"><circle cx="18" cy="16" r="6" stroke="#ff9500" stroke-width="1.6"/><path d="M18 5v3M18 24v3M7 16h3M26 16h3M10 8.5l2 2M24 21.5l2 2M26 8.5l-2 2M12 21.5l-2 2" stroke="#ff9500" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  partly: `<svg viewBox="0 0 36 32" fill="none"><circle cx="13" cy="12" r="4.4" stroke="#ff9500" stroke-width="1.5"/><path d="M13 5v2M6.5 12h2M19.5 12h2" stroke="#ff9500" stroke-width="1.4" stroke-linecap="round"/><path d="M10 18c0-3.4 2.8-5.6 6.2-5.6 2.7 0 4.7 1.4 5.6 3.5 2.8.2 4.9 2 4.9 4.6S24.6 26 21.8 26H12.2C9.2 26 7.4 24 7.4 21.6c0-2.3 1.6-4.2 2.6-4.7" stroke="currentColor" stroke-width="1.5"/></svg>`,
  cloudy: `<svg viewBox="0 0 36 32" fill="none"><path d="M9 16c0-4 3-6.5 7-6.5 3 0 5.2 1.6 6.2 4 3.2.2 5.6 2.3 5.6 5.2S25.4 24 22.2 24H11.4C8 24 6 21.6 6 18.8c0-2.6 1.8-4.8 3-5.4" stroke="currentColor" stroke-width="1.6"/></svg>`,
  rain: `<svg viewBox="0 0 36 32" fill="none"><path d="M9 14c0-4 3-6.5 7-6.5 3 0 5.2 1.6 6.2 4 3.2.2 5.6 2.3 5.6 5.2S25.4 22 22.2 22H11.4C8 22 6 19.6 6 16.8c0-2.6 1.8-4.8 3-5.4" stroke="currentColor" stroke-width="1.6"/><path d="M12 24.5 10.5 28M18 24.5 16.5 28M24 24.5 22.5 28" stroke="#4da3ff" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  storm: `<svg viewBox="0 0 36 32" fill="none"><path d="M9 15c0-4 3-6.5 7-6.5 3 0 5.2 1.6 6.2 4 3.2.2 5.6 2.3 5.6 5.2S25.4 23 22.2 23H11.4C8 23 6 20.6 6 17.8c0-2.6 1.8-4.8 3-5.4" stroke="currentColor" stroke-width="1.6"/><path d="M16 21.5 13 27h4l-2 5 6-7h-4l2-3.5h-3Z" fill="#ffd60a"/></svg>`,
  snow: `<svg viewBox="0 0 36 32" fill="none"><path d="M9 14c0-4 3-6.5 7-6.5 3 0 5.2 1.6 6.2 4 3.2.2 5.6 2.3 5.6 5.2S25.4 22 22.2 22H11.4C8 22 6 19.6 6 16.8c0-2.6 1.8-4.8 3-5.4" stroke="currentColor" stroke-width="1.6"/><path d="M13 24.2v4M11.2 25.2l3.6 1.9M11.2 27.1l3.6-1.9M23 24.2v4M21.2 25.2l3.6 1.9M21.2 27.1l3.6-1.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  drop: `<svg viewBox="0 0 10 14" fill="none" aria-hidden="true"><path d="M5 1.2C5 1.2 1.4 6.2 1.4 8.6a3.6 3.6 0 0 0 7.2 0C8.6 6.2 5 1.2 5 1.2Z" fill="currentColor"/></svg>`,
};

function dailyIcon(text) {
  const value = (text || "").toLowerCase();
  if (/thunder|t-storm|storm/.test(value)) return DAY_ICONS.storm;
  if (/snow|sleet|flurries/.test(value)) return DAY_ICONS.snow;
  if (/rain|shower|drizzle/.test(value)) return DAY_ICONS.rain;
  if (/fog/.test(value)) return DAY_ICONS.cloudy;
  if (/partly|mostly sunny|mostly clear/.test(value)) return DAY_ICONS.partly;
  if (/cloud|overcast/.test(value)) return DAY_ICONS.cloudy;
  return DAY_ICONS.sunny;
}

function weekdayKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\s+night$/, "")
    .trim();
}

function shortWeekday(name) {
  const map = {
    sunday: "Sun",
    monday: "Mon",
    tuesday: "Tue",
    wednesday: "Wed",
    thursday: "Thu",
    friday: "Fri",
    saturday: "Sat",
  };
  return map[weekdayKey(name)] || name.slice(0, 3);
}

function fullWeekday(name) {
  const map = {
    sunday: "Sunday",
    monday: "Monday",
    tuesday: "Tuesday",
    wednesday: "Wednesday",
    thursday: "Thursday",
    friday: "Friday",
    saturday: "Saturday",
  };
  return map[weekdayKey(name)] || name;
}

function formatMdDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zoneForHouse(),
    month: "numeric",
    day: "2-digit",
  }).formatToParts(date);
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return month && day ? `${month}/${day}` : "";
}

function periodPop(period) {
  return safeNum(period?.probabilityOfPrecipitation?.value);
}

function maxPop(a, b) {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

function upcomingDaysFrom(periods = []) {
  const days = [];
  for (const period of periods) {
    const name = period.name || "";
    if (period.isDaytime) {
      if (/^(today|this afternoon)$/i.test(name)) continue;
      days.push({
        id: `${shortWeekday(name).toLowerCase()}-${days.length}`,
        name: shortWeekday(name),
        fullName: fullWeekday(name),
        date: formatMdDate(period.startTime),
        high: period.temperature,
        low: null,
        pop: periodPop(period),
        summary: period.shortForecast || "",
        detail: period.detailedForecast || "",
        icon: dailyIcon(period.shortForecast),
        nightName: "",
        nightShort: "",
        nightDetail: "",
      });
    } else if (!/tonight|this evening/i.test(name)) {
      const last = days[days.length - 1];
      if (last) {
        if (last.low == null) last.low = period.temperature;
        last.pop = maxPop(last.pop, periodPop(period));
        last.nightName = name;
        last.nightShort = period.shortForecast || "";
        last.nightDetail = period.detailedForecast || "";
      }
    }
  }
  return days.slice(0, 6);
}

function escapeAttr(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

let upcomingDays = [];
let selectedDayId = null;

function renderWeek() {
  const strip = document.getElementById("day-strip");
  if (!strip) return;

  if (!upcomingDays.length) {
    strip.innerHTML = "";
    selectedDayId = null;
    hideDayDetail();
    return;
  }

  if (selectedDayId && !upcomingDays.some((day) => day.id === selectedDayId)) {
    selectedDayId = null;
    hideDayDetail();
  }

  strip.innerHTML = upcomingDays
    .map((day) => {
      const pop = day.pop;
      const dry = pop == null || pop < 30 ? " dry" : "";
      const popLabel = pop == null ? "–" : `${Math.round(pop)}%`;
      return `<button class="day-card${day.id === selectedDayId ? " is-selected" : ""}" type="button" data-id="${day.id}" aria-pressed="${day.id === selectedDayId ? "true" : "false"}" title="${escapeAttr(day.summary)}">
        <div class="name">${day.name}</div>
        <div class="date">${day.date || ""}</div>
        <div class="wx-icon">${day.icon}</div>
        <div class="hi"${day.high == null ? "" : ` style="color:${tempColor(day.high)}"`}>${day.high ?? "–"}°</div>
        <div class="lo">${day.low != null ? `${day.low}°` : "–"}</div>
        <div class="pop${dry}">${DAY_ICONS.drop}${popLabel}</div>
      </button>`;
    })
    .join("");

  if (selectedDayId) showDayDetail(selectedDayId, { toggleOff: false });
}

function hideDayDetail() {
  const panel = document.getElementById("day-detail");
  if (panel) panel.hidden = true;
}

function showDayDetail(id, { toggleOff = true } = {}) {
  const panel = document.getElementById("day-detail");
  const nightBlock = document.getElementById("detail-night-block");
  if (!panel) return;
  if (toggleOff && selectedDayId === id) {
    selectedDayId = null;
    hideDayDetail();
    document.querySelectorAll(".day-card").forEach((card) => {
      card.classList.remove("is-selected");
      card.setAttribute("aria-pressed", "false");
    });
    return;
  }
  const day = upcomingDays.find((item) => item.id === id);
  if (!day) {
    selectedDayId = null;
    hideDayDetail();
    return;
  }
  selectedDayId = id;
  document.querySelectorAll(".day-card").forEach((card) => {
    const on = card.dataset.id === id;
    card.classList.toggle("is-selected", on);
    card.setAttribute("aria-pressed", on ? "true" : "false");
  });
  setText("detail-name", day.fullName);
  setText("detail-short", day.summary);
  setText("detail-hi", day.high == null ? "--" : String(day.high));
  const detailHi = document.querySelector("#day-detail .forecast-temp");
  if (detailHi) detailHi.style.color = day.high == null ? "" : tempColor(day.high);
  setText("detail-day", day.detail);
  const hasNight = Boolean(day.nightName || day.nightDetail);
  nightBlock.hidden = !hasNight;
  if (hasNight) {
    setText("detail-night-name", day.nightName);
    setText("detail-night-short", day.nightShort);
    setText("detail-night", day.nightDetail);
  }
  panel.hidden = false;
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function setHtml(id, value) {
  const node = document.getElementById(id);
  if (node) node.innerHTML = value;
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.hidden = false;
  toast.textContent = message;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.hidden = true;
  }, 2400);
}

function currentFromNws(grid, forecast) {
  const props = grid?.properties || {};
  const tempC = nwsSeriesValue(props.temperature);
  const apparentC = nwsSeriesValue(props.apparentTemperature);
  const dewC = nwsSeriesValue(props.dewpoint);
  const humidity = nwsSeriesValue(props.relativeHumidity);
  const visibilityM = nwsSeriesValue(props.visibility);
  const pressurePa = nwsSeriesValue(props.pressure) ?? nwsSeriesValue(props.seaLevelPressure);
  const near = pickNearTerm(forecast?.properties?.periods || []);
  const period = near.period;
  return {
    temperature_2m: tempC == null ? safeNum(period?.temperature) : cToF(tempC),
    apparent_temperature: apparentC == null ? null : cToF(apparentC),
    dew_point_2m: dewC == null ? null : cToF(dewC),
    relative_humidity_2m: humidity,
    visibility: visibilityM,
    pressure_msl: pressurePa == null ? null : pressurePa / 100,
    weather_code: period && /thunder|storm/i.test(period.shortForecast || "") ? 95 : 3,
    is_day: period ? (period.isDaytime ? 1 : 0) : 1,
    time: new Date().toISOString(),
    wind_speed_10m: null,
    wind_gusts_10m: null,
    wind_direction_10m: null,
  };
}

function mergeCurrent(meteo, grid, forecast) {
  const nws = currentFromNws(grid, forecast);
  const om = meteo?.current;
  if (!om) return nws;
  const merged = { ...nws };
  for (const key of [
    "temperature_2m",
    "apparent_temperature",
    "dew_point_2m",
    "relative_humidity_2m",
    "visibility",
    "pressure_msl",
    "wind_speed_10m",
    "wind_gusts_10m",
    "wind_direction_10m",
  ]) {
    const value = safeNum(om[key]);
    if (value != null) merged[key] = value;
  }
  if (om.weather_code != null) merged.weather_code = om.weather_code;
  if (om.is_day != null) merged.is_day = om.is_day;
  if (om.time) merged.time = om.time;
  return merged;
}

function polarPoint(cx, cy, r, deg) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function tempAngle(t) {
  const clamped = Math.max(-10, Math.min(110, t));
  if (clamped <= 60) return -125 + ((clamped + 10) / 70) * 125;
  return ((clamped - 60) / 50) * 125;
}

function precipAngle(pct) {
  return -125 + 250 * Math.max(0, Math.min(1, pct));
}

function hexToRgb(hex) {
  const n = hex.replace("#", "");
  return [n.slice(0, 2), n.slice(2, 4), n.slice(4, 6)].map((part) => parseInt(part, 16));
}

function lerpColor(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const m = (i) => Math.round(ca[i] + (cb[i] - ca[i]) * t);
  return `rgb(${m(0)}, ${m(1)}, ${m(2)})`;
}

function tempColor(t) {
  const stops = [
    [-10, "#7c3aed"],
    [15, "#0a84ff"],
    [50, "#ffd60a"],
    [70, "#ff9f0a"],
    [90, "#ff3b30"],
    [110, "#7f1d1d"],
  ];
  const x = Math.max(-10, Math.min(110, t));
  for (let i = 1; i < stops.length; i += 1) {
    if (x <= stops[i][0]) {
      const span = stops[i][0] - stops[i - 1][0];
      return lerpColor(stops[i - 1][1], stops[i][1], (x - stops[i - 1][0]) / span);
    }
  }
  return stops[stops.length - 1][1];
}

function setTempColor(id, value) {
  const node = document.getElementById(id);
  if (!node) return;
  const n = safeNum(value);
  node.style.color = n == null ? "" : tempColor(n);
}

function arcPath(cx, cy, r, a0, a1) {
  const [x0, y0] = polarPoint(cx, cy, r, a0);
  const [x1, y1] = polarPoint(cx, cy, r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const sweep = a1 >= a0 ? 1 : 0;
  return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}

function hashMarks(cx, cy, r0, r1, start, end, count, color, width) {
  let out = "";
  for (let i = 0; i <= count; i += 1) {
    const d = start + ((end - start) * i) / count;
    const major = i % 5 === 0;
    const [x1, y1] = polarPoint(cx, cy, r0, d);
    const [x2, y2] = polarPoint(cx, cy, major ? r1 + 3 : r1, d);
    out += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="${major ? width + 0.6 : width}" stroke-linecap="round"/>`;
  }
  return out;
}

function litHashes(cx, cy, r0, r1, start, here, step, color) {
  let out = "";
  const span = here - start;
  const n = Math.max(0, Math.round(Math.abs(span) / step));
  for (let i = 0; i <= n; i += 1) {
    const d = start + (span * i) / Math.max(1, n);
    const [x1, y1] = polarPoint(cx, cy, r0, d);
    const [x2, y2] = polarPoint(cx, cy, r1 + 1, d);
    out += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/>`;
  }
  return out;
}

function hoverMark(cx, cy, r, deg, color) {
  const [x, y] = polarPoint(cx, cy, r, deg);
  const [tx, ty] = polarPoint(cx, cy, r + 11, deg);
  const [ax, ay] = polarPoint(cx, cy, r - 2, deg - 7);
  const [bx, by] = polarPoint(cx, cy, r - 2, deg + 7);
  return `<polygon points="${tx.toFixed(1)},${ty.toFixed(1)} ${ax.toFixed(1)},${ay.toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)}" fill="${color}"/>
    <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.1" fill="${color}" stroke="var(--bg)" stroke-width="1.2"/>`;
}

function tempHashes(cx, cy, r0, r1, tMin, tMax, step) {
  let out = "";
  for (let t = tMin; t <= tMax + 0.01; t += step) {
    const d = tempAngle(t);
    const major = Math.round(t) % 10 === 0;
    const [x1, y1] = polarPoint(cx, cy, r0, d);
    const [x2, y2] = polarPoint(cx, cy, major ? r1 + 4 : r1, d);
    out += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${tempColor(t)}" stroke-width="${major ? 2.6 : 1.9}" stroke-linecap="round"/>`;
  }
  return out;
}

function shortCondition(label) {
  const words = String(label || "").split(/\s+/).filter(Boolean);
  if (/^(mostly|partly|light|heavy|freezing)$/i.test(words[0]) && words[1]) return words[1];
  return words[0] || "—";
}

function todayHighLow(meteo, forecast) {
  const max = safeNum(meteo?.daily?.temperature_2m_max?.[0]);
  const min = safeNum(meteo?.daily?.temperature_2m_min?.[0]);
  if (max != null && min != null) return { high: max, low: min };
  const periods = forecast?.properties?.periods || [];
  const day = periods.find((period) => period.isDaytime);
  const night = periods.find((period) => period.isDaytime === false);
  return { high: safeNum(day?.temperature), low: safeNum(night?.temperature) };
}

function paintHeroGauges({ temp, precipPct, windDeg, windSpeed, windGust }) {
  const tempEl = document.getElementById("temp-gauge");
  const precipEl = document.getElementById("precip-g");
  const windEl = document.getElementById("wind-g");
  if (!tempEl || !precipEl || !windEl) return;
  const gray = "color-mix(in srgb, var(--text) 28%, transparent)";
  const t0 = -125;
  const t1 = 125;
  const aNow = temp == null ? null : tempAngle(temp);
  const nowColor = temp == null ? "#ff9f0a" : tempColor(temp);
  const [fadeX0, fadeY0] = polarPoint(110, 108, 70, tempAngle(-10));
  const [fadeX1, fadeY1] = polarPoint(110, 108, 70, aNow == null ? tempAngle(-10) : aNow);
  const arc =
    aNow == null
      ? ""
      : `<path d="${arcPath(110, 108, 70, tempAngle(-10), aNow)}" fill="none" stroke="url(#temp-arc-fade)" stroke-width="5" stroke-linecap="round"/>`;
  tempEl.innerHTML = `
    <svg viewBox="0 12 220 150" aria-hidden="true">
      <defs>
        <linearGradient id="temp-arc-fade" gradientUnits="userSpaceOnUse"
          x1="${fadeX0.toFixed(1)}" y1="${fadeY0.toFixed(1)}"
          x2="${fadeX1.toFixed(1)}" y2="${fadeY1.toFixed(1)}">
          <stop offset="0%" stop-color="${tempColor(-10)}" stop-opacity="0"/>
          <stop offset="55%" stop-color="${tempColor(temp == null ? 30 : (-10 + temp) / 2)}" stop-opacity="0.45"/>
          <stop offset="100%" stop-color="${nowColor}" stop-opacity="1"/>
        </linearGradient>
      </defs>
      ${tempHashes(110, 108, 76, 92, -10, 110, 3)}
      ${arc}
    </svg>`;
  const pNow = precipPct == null ? t0 : precipAngle(precipPct);
  const precipLabel = precipPct == null ? "—" : `${Math.round(precipPct * 100)}%`;
  precipEl.innerHTML = `
    <svg viewBox="0 8 120 92" aria-hidden="true">
      ${hashMarks(60, 58, 34, 44, t0, t1, 20, gray, 1.5)}
      ${precipPct == null ? "" : litHashes(60, 58, 34, 44, t0, pNow, 8, "#0a84ff")}
      ${precipPct == null ? "" : hoverMark(60, 58, 44, pNow, "#0a84ff")}
      <text x="60" y="64" text-anchor="middle" fill="currentColor" font-size="16" font-weight="650" font-family="system-ui">${precipLabel}</text>
    </svg>
    <div class="lab">Precip</div>`;
  const dir = windDeg == null ? 0 : windDeg;
  const dirLabel = compass(windDeg);
  const speedLabel = windSpeed == null ? "—" : String(Math.round(windSpeed));
  const gustLabel =
    windGust != null && windGust > 0 ? String(Math.round(windGust)) : "--";
  windEl.innerHTML = `
    <svg viewBox="4 8 112 88" aria-hidden="true">
      <circle cx="60" cy="52" r="30" fill="none" stroke="${gray}" stroke-width="1.5"/>
      ${hashMarks(60, 52, 24, 30, 0, 360, 24, gray, 1.3)}
      <path d="M60 50 L66 26 L60 32 L54 26 Z" fill="#0a84ff" transform="rotate(${dir} 60 52)"/>
      <text x="60" y="16" text-anchor="middle" fill="color-mix(in srgb, var(--text) 50%, transparent)" font-size="8" font-weight="700" font-family="system-ui">N</text>
    </svg>
    <div class="lab">Winds</div>
    <div class="val">${dirLabel} ${speedLabel} | ${gustLabel}</div>`;
}

function renderCurrent(meteo, air, grid, forecast) {
  const current = mergeCurrent(meteo, grid, forecast);
  const hourly = meteo?.hourly;
  const periodLabel = pickNearTerm(forecast?.properties?.periods || []).period?.shortForecast;
  const wx =
    safeNum(meteo?.current?.weather_code) != null
      ? weatherFromCode(current.weather_code, current.is_day === 1)
      : { label: periodLabel || "Mostly Cloudy", icon: dailyIcon(periodLabel) };
  const hour = hourly?.time ? currentHourIndex(hourly.time) : 0;
  const uv = hourly?.uv_index ? uvInfo(hourly.uv_index[hour]) : { risk: "—", level: "—" };
  const precip = hourly?.precipitation ? sumPast24Hours(hourly.time, hourly.precipitation) : null;
  const trend =
    hourly?.pressure_msl && current.pressure_msl != null
      ? pressureTrend(hourly.time, hourly.pressure_msl, current.pressure_msl)
      : "—";
  let windSpeed = current.wind_speed_10m;
  let gust = current.wind_gusts_10m;
  let windDir = current.wind_direction_10m;
  const nwsDir = nwsSeriesValue(grid?.properties?.windDirection);
  const nwsSpeed = nwsSeriesValue(grid?.properties?.windSpeed);
  const nwsGust = nwsSeriesValue(grid?.properties?.windGust);
  if (nwsDir != null) windDir = nwsDir;
  if (nwsSpeed != null) windSpeed = kmhToMph(nwsSpeed);
  if (nwsGust != null) gust = kmhToMph(nwsGust);
  const visRaw = safeNum(current.visibility);
  const visibilityMiles = visRaw == null ? null : Math.min(10, metersToMiles(visRaw));
  const aqi = aqiInfo(air?.current?.us_aqi);
  const temp = safeNum(current.temperature_2m);
  const feels = safeNum(current.apparent_temperature);
  const humidity = safeNum(current.relative_humidity_2m);
  const dew = safeNum(current.dew_point_2m);
  const pressure = safeNum(current.pressure_msl);

  const hero = document.getElementById("hero-icon");
  if (hero) hero.innerHTML = wx.icon;
  observedTemp = temp;
  paintAlmanacCapsule();
  const range = todayHighLow(meteo, forecast);
  const precipChance = hourly?.precipitation_probability
    ? safeNum(hourly.precipitation_probability[hour])
    : null;
  paintHeroGauges({
    temp,
    precipPct: precipChance == null ? null : precipChance / 100,
    windDeg: windDir == null || Number.isNaN(Number(windDir)) ? null : Number(windDir),
    windSpeed,
    windGust: gust,
  });
  setText("temp", temp == null ? "--" : String(Math.round(temp)));
  const tempNum = document.querySelector(".temp-core .t");
  if (tempNum) tempNum.style.color = temp == null ? "" : tempColor(temp);
  setText("gauge-hi", range.high == null ? "--°" : `${Math.round(range.high)}°`);
  setText("gauge-lo", range.low == null ? "--°" : `${Math.round(range.low)}°`);
  setText("feels", feels == null ? "Feels like --°" : `Feels like ${Math.round(feels)}°`);
  setText("condition", shortCondition(wx.label));
  setText("precip", precip == null ? "—" : formatInches(precip));
  setText("humidity", humidity == null ? "—" : `${Math.round(humidity)}%`);
  setText("dew", dew == null ? "—" : `${Math.round(dew)}°`);
  setText(
    "visibility",
    visibilityMiles == null ? "—" : `${visibilityMiles >= 10 ? 10 : visibilityMiles.toFixed(1)} mi`
  );
  setText("pressure-trend", trend);
  setText("pressure", pressure == null ? "—" : `${hpaToInHg(pressure).toFixed(2)}"`);
  const pressureGlyph = document.getElementById("pressure-icon");
  if (pressureGlyph) pressureGlyph.innerHTML = pressureIcon(trend);
  setText("uv", uv.risk);
  setText("uv-level", uv.level);
  setText("aqi", aqi.label);
  setText("aqi-level", aqi.level);

  const stamp = current.time ? new Date(current.time) : new Date();
  setText(
    "updated",
    `Updated ${stamp.toLocaleString("en-US", {
      timeZone: zoneForHouse(),
      hour: "numeric",
      minute: "2-digit",
    })}`
  );

  return {
    summary: `${wx.label}, ${temp == null ? "--" : Math.round(temp)}°F in ${currentHouse().name} ${currentHouse().zip}`,
  };
}

function parseOmLocal(stamp, utcOffsetSeconds) {
  const match = String(stamp || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) {
    const date = new Date(stamp);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const asUtc = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5])
  );
  return new Date(asUtc - Number(utcOffsetSeconds || 0) * 1000);
}

function hourInZone(date, timeZone) {
  const raw = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hourCycle: "h23",
  })
    .formatToParts(date)
    .find((part) => part.type === "hour")?.value;
  return Number(raw);
}

function hourTickLabel(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hour12: true,
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value;
  const period = parts.find((part) => part.type === "dayPeriod")?.value || "";
  if (hour === "12" && /am/i.test(period)) return "12 AM";
  if (hour === "12" && /pm/i.test(period)) return "12 PM";
  return hour;
}

function civilHourUtc(parts, hour) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, hour);
}

function hourlyDayLabel(parts, today) {
  if (parts.year === today.year && parts.month === today.month && parts.day === today.day) {
    return "TODAY";
  }
  const weekday = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][
    new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()
  ];
  return `${weekday} ${parts.day}`;
}

function hourlyDaySpans(points) {
  const days = [];
  points.forEach((point) => {
    if (point.dayLabel) days.push({ label: point.dayLabel, hours: 1 });
    else if (days.length) days[days.length - 1].hours += 1;
  });
  return days;
}

function hourlyPoints(meteo) {
  const times = meteo?.hourly?.time;
  const temps = meteo?.hourly?.temperature_2m;
  const pops = meteo?.hourly?.precipitation_probability;
  if (!Array.isArray(times) || !Array.isArray(temps)) return [];
  const zone = zoneForHouse();
  const offset = Number(meteo.utc_offset_seconds || 0);
  const now = new Date();
  const today = datePartsInZone(now, zone);
  const nowHour = hourInZone(now, zone);
  const startUtc = civilHourUtc(today, nowHour - 4);
  const endUtc = civilHourUtc(
    {
      year: today.year,
      month: today.month,
      day: today.day + 5,
    },
    0
  );
  const points = [];
  for (let i = 0; i < times.length; i += 1) {
    const temp = safeNum(temps[i]);
    const date = parseOmLocal(times[i], offset);
    if (temp == null || !date) continue;
    const parts = datePartsInZone(date, zone);
    const hour = hourInZone(date, zone);
    const stamp = civilHourUtc(parts, hour);
    if (stamp < startUtc || stamp >= endUtc) continue;
    const prev = points[points.length - 1];
    const newDay = !prev || prev.parts.day !== parts.day || prev.parts.month !== parts.month;
    const pop = Array.isArray(pops) ? safeNum(pops[i]) : null;
    points.push({
      temp: Math.round(temp),
      hour,
      pop,
      parts,
      label: hourTickLabel(date, zone),
      dayLabel: newDay ? hourlyDayLabel(parts, today) : "",
      now: stamp === civilHourUtc(today, nowHour),
    });
  }
  return points;
}

let hourlyPinBound = false;

function updateHourlyDayPin(scroll, pin) {
  if (!scroll || !pin) return;
  const days = [...scroll.querySelectorAll(".hourly-days > span")].map((el) => {
    const box = el.getBoundingClientRect();
    return {
      el,
      label: (el.dataset.label || el.textContent || "").trim(),
      left: box.left,
      right: box.right,
    };
  });
  if (!days.length) {
    pin.hidden = true;
    return;
  }
  const edge = scroll.getBoundingClientRect().left;
  let current = days[0];
  let next = days[1] || null;
  for (let i = 0; i < days.length; i += 1) {
    if (days[i].left <= edge + 2 && days[i].right > edge + 16) {
      current = days[i];
      next = days[i + 1] || null;
    }
  }
  days.forEach((day) => day.el.classList.toggle("is-current", day.el === current.el));
  pin.hidden = false;
  pin.textContent = current.label;
  pin.classList.toggle("today", current.label === "TODAY");
  const shell = scroll.closest(".hourly-wrap");
  const row = scroll.querySelector(".hourly-days");
  if (shell && row) {
    pin.style.top = `${row.getBoundingClientRect().top - shell.getBoundingClientRect().top}px`;
  }
  pin.style.transform = "translateX(0)";
  if (!next) return;
  const overlap = pin.offsetWidth - (next.left - edge);
  if (overlap > 0) pin.style.transform = `translateX(${-overlap}px)`;
}

function bindHourlyDayPin(scroll, pin) {
  if (hourlyPinBound || !scroll || !pin) return;
  hourlyPinBound = true;
  scroll.addEventListener(
    "scroll",
    () => {
      window.requestAnimationFrame(() => updateHourlyDayPin(scroll, pin));
    },
    { passive: true }
  );
}

function renderHourlyTemps(meteo) {
  const wrap = document.getElementById("hourly");
  const scroll = document.getElementById("hourly-scroll");
  const pin = document.getElementById("hourly-day-pin");
  if (!wrap || !scroll) return;
  const points = hourlyPoints(meteo);
  if (points.length < 2) {
    wrap.hidden = true;
    scroll.innerHTML = "";
    if (pin) pin.hidden = true;
    return;
  }
  wrap.hidden = false;
  const col = 40;
  const count = points.length;
  const width = Math.max(320, count * col);
  const height = 118;
  const padX = col / 2;
  const padTop = 16;
  const padBot = 10;
  const temps = points.map((point) => point.temp);
  const min = Math.min(...temps) - 2;
  const max = Math.max(...temps) + 2;
  const span = Math.max(1, max - min);
  const xs = points.map((_, i) => padX + (i * (width - padX * 2)) / (points.length - 1));
  const ys = temps.map((temp) => padTop + ((max - temp) / span) * (height - padTop - padBot));
  const thru = (from, to) =>
    xs
      .slice(from, to)
      .map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)},${ys[from + i].toFixed(1)}`)
      .join(" ");
  const area = (from, to) => {
    const line = thru(from, to);
    if (!line) return "";
    return `${line} L${xs[to - 1].toFixed(1)},${height} L${xs[from].toFixed(1)},${height} Z`;
  };
  const nowAt = Math.max(
    0,
    points.findIndex((point) => point.now)
  );
  const hasNow = points.some((point) => point.now);
  const pastEnd = hasNow ? nowAt + 1 : 0;
  const futureStart = hasNow ? nowAt : 0;
  const pastLine = pastEnd > 1 ? thru(0, pastEnd) : "";
  const futureLine = thru(futureStart, points.length);
  const dots = points
    .map((point, i) => {
      const past = hasNow && i < nowAt;
      const radius = point.now ? 4.2 : 2.6;
      const stroke = past ? "#ffd199" : "#ff9f0a";
      const fill = point.now ? "#ff9f0a" : "var(--bg-elevated)";
      return `<circle cx="${xs[i].toFixed(1)}" cy="${ys[i].toFixed(1)}" r="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="1.8"/>`;
    })
    .join("");
  const midnights = points
    .map((point, i) =>
      point.hour === 0 && i > 0
        ? `<line x1="${xs[i].toFixed(1)}" y1="0" x2="${xs[i].toFixed(1)}" y2="${height}" stroke="currentColor" stroke-opacity="0.12" stroke-width="1"/>`
        : ""
    )
    .join("");
  const nowLine = hasNow
    ? `<line x1="${xs[nowAt].toFixed(1)}" y1="0" x2="${xs[nowAt].toFixed(1)}" y2="${height}" stroke="#ff9f0a" stroke-opacity="0.35" stroke-width="1.2"/>`
    : "";
  const hourKind = (point, i) => {
    if (point.now) return "now";
    if (hasNow && i < nowAt) return "past";
    if (point.hour === 0) return "midnight";
    if (point.hour === 12) return "noon";
    return "";
  };
  const gridCols = `repeat(${count}, ${col}px)`;
  const rowStyle = `grid-template-columns:${gridCols};width:${width}px;min-width:${width}px`;
  scroll.innerHTML = `
    <div class="hourly-track" style="width:${width}px;min-width:${width}px">
      <div class="hourly-days" style="${rowStyle}">${hourlyDaySpans(points)
        .map(
          (day) =>
            `<span class="${day.label === "TODAY" ? "today" : ""}" data-label="${day.label}" style="grid-column: span ${day.hours}">${day.label}</span>`
        )
        .join("")}</div>
      <svg class="hourly-chart" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="width:${width}px;min-width:${width}px;height:${height}px" preserveAspectRatio="none" aria-hidden="true">
      ${midnights}
      ${nowLine}
      ${pastEnd > 1 ? `<path d="${area(0, pastEnd)}" fill="color-mix(in srgb, #ff9f0a 7%, transparent)"/>` : ""}
      <path d="${area(futureStart, points.length)}" fill="color-mix(in srgb, #ff9f0a 20%, transparent)"/>
      ${pastLine ? `<path d="${pastLine}" fill="none" stroke="#ffd199" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` : ""}
      <path d="${futureLine}" fill="none" stroke="#ff9f0a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      ${dots}
    </svg>
    <div class="hourly-temps" style="${rowStyle}">${points
      .map((point, i) => {
        const kind = point.now ? "now" : hasNow && i < nowAt ? "past" : "";
        return `<span class="${kind}">${point.temp}°</span>`;
      })
      .join("")}</div>
    <div class="hourly-pops" style="${rowStyle}">${points
      .map((point, i) => {
        const classes = [
          point.now ? "now" : "",
          hasNow && i < nowAt ? "past" : "",
          point.pop == null || point.pop < 30 ? "dry" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const label = point.pop == null ? "–" : `${Math.round(point.pop)}%`;
        return `<span class="${classes}">${label}</span>`;
      })
      .join("")}</div>
    <div class="hourly-hours" style="${rowStyle}">${points
      .map((point, i) => `<span class="${hourKind(point, i)}">${point.now ? "Now" : point.label}</span>`)
      .join("")}</div>
    </div>
  `;
  const nowMark = scroll.querySelector(".hourly-hours .now");
  if (nowMark) {
    const scrollerBox = scroll.getBoundingClientRect();
    const markBox = nowMark.getBoundingClientRect();
    scroll.scrollLeft += markBox.left + markBox.width / 2 - (scrollerBox.left + scrollerBox.width / 2);
  }
  bindHourlyDayPin(scroll, pin);
  updateHourlyDayPin(scroll, pin);
  window.requestAnimationFrame(() => updateHourlyDayPin(scroll, pin));
}

function renderForecast(forecast) {
  const periods = forecast?.properties?.periods || [];
  const near = pickNearTerm(periods);
  if (!near.period) {
    setText("forecast-short", "Forecast unavailable");
    upcomingDays = [];
    renderWeek();
    return;
  }
  setText("forecast-name", near.kind === "today" ? "Today" : "Tonight");
  setText("forecast-short", near.period.shortForecast || "");
  setText("forecast-temp", String(near.period.temperature ?? "--"));
  setText("forecast-detail", near.period.detailedForecast || "");
  upcomingDays = upcomingDaysFrom(periods);
  renderWeek();
}

async function refresh() {
  document.querySelector(".phone").classList.add("is-loading");
  try {
    const [meteo, air, nws, alerts] = await Promise.all([
      loadOpenMeteo().catch((error) => {
        console.warn("Open-Meteo failed", error);
        return null;
      }),
      loadAirQuality().catch(() => null),
      loadNwsForecast().catch((error) => {
        console.warn("NWS forecast failed", error);
        return null;
      }),
      loadNwsAlerts().catch(() => null),
    ]);
    if (nws && needsNwsGrid(meteo)) {
      nws.grid = await loadNwsGrid(nws.gridUrl);
    }
    renderAlerts(alerts);
    if (!meteo && !nws) throw new Error("No weather sources");
    const rendered = renderCurrent(meteo, air, nws?.grid, nws?.forecast);
    if (nws?.forecast) renderForecast(nws.forecast);
    else {
      setText("forecast-short", "Could not reach the National Weather Service");
      upcomingDays = [];
      renderWeek();
    }
    renderHourlyTemps(meteo);
    document.querySelector(".phone").dataset.summary = rendered.summary;
  } catch (error) {
    console.error(error);
    setText("condition", "Unable to load weather");
    setText("forecast-short", "Safari may be blocking a weather source. Try a refresh, or disable content blockers for this site.");
    showToast("Could not load local weather");
  } finally {
    document.querySelector(".phone").classList.remove("is-loading");
  }
}

function currentTheme() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function applyTheme(theme) {
  const next = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  storageSet("weather-theme", next);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "light" ? "#f2f2f7" : "#1c1c1e");
  const button = document.getElementById("theme-btn");
  if (button) {
    button.setAttribute("aria-label", next === "light" ? "Switch to dark theme" : "Switch to light theme");
  }
}

document.getElementById("theme-btn").addEventListener("click", () => {
  applyTheme(currentTheme() === "light" ? "dark" : "light");
});

function applyHouse(id, { refreshData = true } = {}) {
  const house = houseById(id);
  const previous = storageGet("weather-house");
  if (previous && previous !== house.id) {
    selectedDayId = null;
    hideDayDetail();
  }
  storageSet("weather-house", house.id);
  document.querySelectorAll(".house-switch [data-house]").forEach((button) => {
    button.setAttribute("aria-selected", button.dataset.house === house.id ? "true" : "false");
  });
  setText("place-text", house.name);
  document.title = `Today’s Weather Conditions · ${house.name}`;
  if (refreshData && currentPanel() === "almanac") refreshAlmanac();
  if (refreshData) refresh();
}

document.querySelectorAll(".house-switch [data-house]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.house === currentHouse().id) return;
    applyHouse(button.dataset.house);
  });
});

let almanacData = null;
let almanacPromise = null;

function zoneForLon(lon) {
  if (lon <= -162.5) return "Pacific/Honolulu";
  if (lon <= -129) return "America/Anchorage";
  if (lon <= -115) return "America/Los_Angeles";
  if (lon <= -102) return "America/Denver";
  if (lon <= -87) return "America/Chicago";
  return "America/New_York";
}

function zoneForHouse(house = currentHouse()) {
  return zoneForLon(Number(house.lon));
}

function datePartsInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")) };
}

function almanacDayKey(date = new Date(), timeZone = zoneForHouse()) {
  const { month, day } = datePartsInZone(date, timeZone);
  return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dayOfYear(year, month, day) {
  return Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / 86400000);
}

function formatClock(date, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function zoneOffsetMs(timeZone, instant) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const read = (type) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(read("year"), read("month") - 1, read("day"), read("hour"), read("minute"), read("second"));
  return asUtc - instant.getTime();
}

function localMidnight(year, month, day, timeZone) {
  let utc = Date.UTC(year, month - 1, day, 0, 0, 0);
  for (let i = 0; i < 3; i += 1) {
    const offset = zoneOffsetMs(timeZone, new Date(utc));
    utc = Date.UTC(year, month - 1, day, 0, 0, 0) - offset;
  }
  return new Date(utc);
}

function moonPosition(date, lat, lon) {
  const rad = Math.PI / 180;
  const day = date.getTime() / 86400000 - 0.5 + 2440588 - 2451545;
  const L = rad * (218.316 + 13.176396 * day);
  const M = rad * (134.963 + 13.064993 * day);
  const F = rad * (93.272 + 13.22935 * day);
  const lonEcl = L + rad * 6.289 * Math.sin(M);
  const latEcl = rad * 5.128 * Math.sin(F);
  const dist = 385001 - 20905 * Math.cos(M);
  const eps = rad * 23.4397;
  const ra = Math.atan2(Math.sin(lonEcl) * Math.cos(eps) - Math.tan(latEcl) * Math.sin(eps), Math.cos(lonEcl));
  const dec = Math.asin(Math.sin(latEcl) * Math.cos(eps) + Math.cos(latEcl) * Math.sin(eps) * Math.sin(lonEcl));
  const lw = rad * -lon;
  const phi = rad * lat;
  const H = rad * (280.16 + 360.9856235 * day) - lw - ra;
  const h = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const refraction = h < 0 ? 0 : 0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179));
  return { altitude: h + refraction, dist };
}

function moonTimes(lat, lon, year, month, day, timeZone) {
  const start = localMidnight(year, month, day, timeZone);
  const later = (hours) => new Date(start.getTime() + hours * 3600000);
  const hc = 0.133 * (Math.PI / 180);
  let h0 = moonPosition(start, lat, lon).altitude - hc;
  let rise = null;
  let set = null;
  let ye = 0;
  for (let i = 1; i <= 24; i += 2) {
    const h1 = moonPosition(later(i), lat, lon).altitude - hc;
    const h2 = moonPosition(later(i + 1), lat, lon).altitude - hc;
    const a = (h0 + h2) / 2 - h1;
    const b = (h2 - h0) / 2;
    const xe = -b / (2 * a || 1);
    ye = (a * xe + b) * xe + h1;
    const disc = b * b - 4 * a * h1;
    let roots = 0;
    let x1 = 0;
    let x2 = 0;
    if (disc >= 0) {
      const dx = Math.sqrt(disc) / (Math.abs(a) * 2 || 1);
      x1 = xe - dx;
      x2 = xe + dx;
      if (Math.abs(x1) <= 1) roots += 1;
      if (Math.abs(x2) <= 1) roots += 1;
      if (x1 < -1) x1 = x2;
    }
    if (roots === 1) {
      if (h0 < 0) rise = i + x1;
      else set = i + x1;
    } else if (roots === 2) {
      rise = i + (ye < 0 ? x2 : x1);
      set = i + (ye < 0 ? x1 : x2);
    }
    if (rise != null && set != null) break;
    h0 = h2;
  }
  return {
    rise: rise != null ? later(rise) : null,
    set: set != null ? later(set) : null,
    alwaysUp: rise == null && set == null && ye > 0,
    alwaysDown: rise == null && set == null && ye <= 0,
  };
}

function sunTimes(lat, lon, year, month, day) {
  const doy = dayOfYear(year, month, day);
  const gamma = ((2 * Math.PI) / 365) * (doy - 1);
  const eqtime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  const latr = (lat * Math.PI) / 180;
  const cosHa =
    Math.cos((90.833 * Math.PI) / 180) / (Math.cos(latr) * Math.cos(decl)) - Math.tan(latr) * Math.tan(decl);
  if (cosHa < -1 || cosHa > 1) return { sunrise: null, sunset: null };
  const ha = (Math.acos(Math.min(1, Math.max(-1, cosHa))) * 180) / Math.PI;
  const sunriseMin = 720 - 4 * (lon + ha) - eqtime;
  const sunsetMin = 720 - 4 * (lon - ha) - eqtime;
  const utc0 = Date.UTC(year, month - 1, day);
  return {
    sunrise: new Date(utc0 + sunriseMin * 60000),
    sunset: new Date(utc0 + sunsetMin * 60000),
  };
}

const SYNODIC = 29.530588853;
const KNOWN_NEW = Date.UTC(2000, 0, 6, 18, 14);

function moonState(date = new Date()) {
  const days = (date.getTime() - KNOWN_NEW) / 86400000;
  const age = ((days % SYNODIC) + SYNODIC) % SYNODIC;
  const cycle = age / SYNODIC;
  const illumination = (1 - Math.cos(2 * Math.PI * cycle)) / 2;
  const waxing = cycle < 0.5;
  let name = "Waxing Crescent";
  if (cycle < 0.03 || cycle >= 0.97) name = "New Moon";
  else if (cycle < 0.22) name = "Waxing Crescent";
  else if (cycle < 0.28) name = "First Quarter";
  else if (cycle < 0.47) name = "Waxing Gibbous";
  else if (cycle < 0.53) name = "Full Moon";
  else if (cycle < 0.72) name = "Waning Gibbous";
  else if (cycle < 0.78) name = "Last Quarter";
  else name = "Waning Crescent";
  let toFull = SYNODIC * 0.5 - age;
  if (toFull < -0.35) toFull += SYNODIC;
  if (toFull < 0) toFull = 0;
  const fullDate = new Date(date.getTime() + toFull * 86400000);
  return { age, cycle, illumination, waxing, name, toFull, fullDate };
}

function moonSvg(illumination, waxing, { fullDisk = false } = {}) {
  if (fullDisk || illumination >= 0.97) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="moon-full" cx="12" cy="12" r="7.1"/></svg>`;
  }
  let i = illumination;
  if (i > 0 && i < 0.08) i = 0.09;
  if (i > 0.92 && i < 1) i = 0.91;
  if (Math.abs(i - 0.5) < 0.03) {
    const half = waxing
      ? "M12 4.9A7.1 7.1 0 0 1 12 19.1Z"
      : "M12 4.9A7.1 7.1 0 0 0 12 19.1Z";
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="moon-unlit" cx="12" cy="12" r="7.1"/><path class="moon-lit" d="${half}"/><circle class="moon-rim" cx="12" cy="12" r="7.1"/></svg>`;
  }
  const rx = (Math.abs(1 - 2 * i) * 7.1).toFixed(2);
  const outer = waxing ? 1 : 0;
  const inner = i <= 0.5 ? (waxing ? 0 : 1) : waxing ? 1 : 0;
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="moon-unlit" cx="12" cy="12" r="7.1"/><path class="moon-lit" d="M12 4.9A7.1 7.1 0 0 ${outer} 12 19.1A${rx} 7.1 0 0 ${inner} 12 4.9Z"/><circle class="moon-rim" cx="12" cy="12" r="7.1"/></svg>`;
}

function formatFullWhen(toFull, fullDate, timeZone) {
  if (toFull < 0.6) return { value: formatShortDate(fullDate, timeZone), sub: "tonight" };
  const days = Math.max(1, Math.round(toFull));
  return {
    value: formatShortDate(fullDate, timeZone),
    sub: days === 1 ? "in 1 day" : `in ${days} days`,
  };
}

function formatShortDate(date, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
  }).format(date);
}

function paintSky(house) {
  const timeZone = zoneForHouse(house);
  const now = new Date();
  const { year, month, day } = datePartsInZone(now, timeZone);
  const sun = sunTimes(Number(house.lat), Number(house.lon), year, month, day);
  setText("almanac-sunrise", sun.sunrise ? formatClock(sun.sunrise, timeZone) : "—");
  setText("almanac-sunset", sun.sunset ? formatClock(sun.sunset, timeZone) : "—");
  const moonClock = moonTimes(Number(house.lat), Number(house.lon), year, month, day, timeZone);
  setText(
    "almanac-moonrise",
    moonClock.rise ? formatClock(moonClock.rise, timeZone) : moonClock.alwaysUp ? "Up all day" : "—"
  );
  setText(
    "almanac-moonset",
    moonClock.set ? formatClock(moonClock.set, timeZone) : moonClock.alwaysDown ? "Down all day" : "—"
  );
  const moon = moonState(now);
  setHtml("moon-icon", moonSvg(moon.illumination, moon.waxing));
  setHtml("full-moon-icon", moonSvg(1, true, { fullDisk: true }));
  setText("moon-name", moon.name);
  setText("moon-pct", `${Math.round(moon.illumination * 100)}%`);
  const next = formatFullWhen(moon.toFull, moon.fullDate, timeZone);
  setText("next-full", next.value);
  setText("next-full-sub", next.sub);
}

function formatAlmanacTemp(value) {
  return value == null || Number.isNaN(Number(value)) ? "—" : `${Math.round(Number(value))}°`;
}

async function loadAlmanac() {
  if (almanacData) return almanacData;
  if (!almanacPromise) {
    almanacPromise = fetch("almanac.json")
      .then((response) => {
        if (!response.ok) throw new Error("almanac.json");
        return response.json();
      })
      .then((data) => {
        almanacData = data;
        return data;
      })
      .catch((error) => {
        almanacPromise = null;
        throw error;
      });
  }
  return almanacPromise;
}

function recordLabel(kind, year) {
  return year ? `${kind} · ${year}` : kind;
}

let observedTemp = null;
let almanacScale = null;

function almanacPct(value, min, span) {
  return ((Number(value) - min) / span) * 100;
}

function paintAlmanacCapsule() {
  const normals = document.getElementById("almanac-normals-span");
  const today = document.getElementById("almanac-today-mark");
  if (!normals || !today) return;
  const scale = almanacScale;
  const span = scale && scale.rh != null && scale.rl != null ? scale.rh - scale.rl : 0;
  if (!scale || !(span > 0)) {
    normals.hidden = true;
    today.hidden = true;
    return;
  }
  if (scale.nl != null && scale.nh != null && scale.nh > scale.nl) {
    const left = Math.max(0, Math.min(100, almanacPct(scale.nl, scale.rl, span)));
    const right = Math.max(0, Math.min(100, almanacPct(scale.nh, scale.rl, span)));
    normals.hidden = false;
    normals.style.left = `${left}%`;
    normals.style.width = `${Math.max(0, right - left)}%`;
  } else {
    normals.hidden = true;
  }
  if (observedTemp != null) {
    const x = Math.max(0, Math.min(100, almanacPct(observedTemp, scale.rl, span)));
    today.hidden = false;
    today.style.left = `${x}%`;
    today.setAttribute("data-temp", `${Math.round(observedTemp)}°`);
  } else {
    today.hidden = true;
  }
}

function clearAlmanac() {
  almanacScale = null;
  setText("almanac-rh", "—");
  setText("almanac-nh", "—");
  setText("almanac-nl", "—");
  setText("almanac-rl", "—");
  setTempColor("almanac-rh", null);
  setTempColor("almanac-nh", null);
  setTempColor("almanac-nl", null);
  setTempColor("almanac-rl", null);
  setText("almanac-rh-label", "High");
  setText("almanac-rl-label", "Low");
  setText("almanac-foot", "Almanac unavailable");
  paintAlmanacCapsule();
}

function paintAlmanac(entry, dayKey) {
  setText("almanac-rh", formatAlmanacTemp(entry.recordHigh));
  setText("almanac-nh", formatAlmanacTemp(entry.normalHigh));
  setText("almanac-nl", formatAlmanacTemp(entry.normalLow));
  setText("almanac-rl", formatAlmanacTemp(entry.recordLow));
  setTempColor("almanac-rh", entry.recordHigh);
  setTempColor("almanac-nh", entry.normalHigh);
  setTempColor("almanac-nl", entry.normalLow);
  setTempColor("almanac-rl", entry.recordLow);
  setText("almanac-rh-label", recordLabel("High", entry.recordHighYear));
  setText("almanac-rl-label", recordLabel("Low", entry.recordLowYear));
  almanacScale = {
    rl: safeNum(entry.recordLow),
    rh: safeNum(entry.recordHigh),
    nl: safeNum(entry.normalLow),
    nh: safeNum(entry.normalHigh),
  };
  paintAlmanacCapsule();
  const month = Number(dayKey.slice(0, 2));
  const day = dayKey.slice(3);
  setText("almanac-foot", `${entry.station || "Climate station"} · ${month}/${day}`);
}

async function almanacEntryFor(house) {
  const key = almanacDayKey();
  const slot = almanacSlotFor(house);
  if (slot) {
    const data = await loadAlmanac();
    const entry = data?.[slot]?.days?.[key];
    const station = data?.[slot];
    if (!entry) return null;
    return { entry: { ...entry, station: station?.station || house.climate }, key };
  }
  const entry = await fetchRemoteAlmanac(house, key);
  return entry ? { entry, key } : null;
}

async function refreshAlmanac() {
  const gen = ++almanacGen;
  const house = currentHouse();
  paintSky(house);
  setText("almanac-foot", "Loading…");
  try {
    const result = await almanacEntryFor(house);
    if (gen !== almanacGen) return;
    if (!result) {
      clearAlmanac();
      return;
    }
    paintAlmanac(result.entry, result.key);
  } catch (error) {
    if (gen !== almanacGen) return;
    clearAlmanac();
  }
}

function currentPanel() {
  const query = new URLSearchParams(window.location.search).get("panel");
  if (query === "almanac" || query === "conditions") return query;
  return storageGet("weather-panel") === "almanac" ? "almanac" : "conditions";
}

function applyPanel(panel) {
  const next = panel === "almanac" ? "almanac" : "conditions";
  storageSet("weather-panel", next);
  document.querySelectorAll(".panel-switch [data-panel]").forEach((button) => {
    button.setAttribute("aria-selected", button.dataset.panel === next ? "true" : "false");
  });
  const conditions = document.getElementById("conditions-panel");
  const almanac = document.getElementById("almanac-panel");
  if (conditions) conditions.hidden = next !== "conditions";
  if (almanac) almanac.hidden = next !== "almanac";
  if (next === "almanac") refreshAlmanac();
}

document.querySelectorAll(".panel-switch [data-panel]").forEach((button) => {
  button.addEventListener("click", () => applyPanel(button.dataset.panel));
});

applyPanel(currentPanel());

function currentForecastPanel() {
  const query = new URLSearchParams(window.location.search).get("forecast");
  if (query === "today" || query === "extended") return query;
  return storageGet("weather-forecast") === "extended" ? "extended" : "today";
}

function applyForecastPanel(panel) {
  const next = panel === "extended" ? "extended" : "today";
  storageSet("weather-forecast", next);
  document.querySelectorAll(".forecast-switch [data-forecast]").forEach((button) => {
    button.setAttribute("aria-selected", button.dataset.forecast === next ? "true" : "false");
  });
  const today = document.getElementById("forecast-today-panel");
  const extended = document.getElementById("forecast-extended-panel");
  if (today) today.hidden = next !== "today";
  if (extended) extended.hidden = next !== "extended";
  window.scrollTo(0, window.scrollY || 0);
}

document.querySelectorAll(".forecast-switch [data-forecast]").forEach((button) => {
  button.addEventListener("click", () => applyForecastPanel(button.dataset.forecast));
});

applyForecastPanel(currentForecastPanel());

document.getElementById("day-strip").addEventListener("click", (event) => {
  const card = event.target.closest(".day-card");
  if (card?.dataset.id) showDayDetail(card.dataset.id);
});

async function geocodeZip(zip) {
  const cache = readJsonStore("weather-zip-cache");
  if (cache[zip]) return cache[zip];
  const data = await fetchJson(`https://api.zippopotam.us/us/${zip}`);
  const place = data.places?.[0];
  if (!place) throw new Error("Unknown ZIP");
  const resolved = {
    zip,
    name: `${place["place name"]}, ${place["state abbreviation"]}`,
    lat: Number(place.latitude),
    lon: Number(place.longitude),
  };
  cache[zip] = resolved;
  writeJsonStore("weather-zip-cache", cache);
  return resolved;
}

function persistHouseLocation(houseId, next) {
  const all = savedLocations();
  all[houseId] = next;
  storageSet("weather-locations", JSON.stringify(all));
}

async function reverseGeocode(lat, lon) {
  const data = await fetchJson(
    `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`
  );
  if (data.countryCode && data.countryCode !== "US") throw new Error("us-only");
  const zip = String(data.postcode || "").replace(/\D/g, "").slice(0, 5);
  const abbr = String(data.principalSubdivisionCode || "").replace(/^US-/, "");
  const city = data.locality || data.city;
  let name = city && abbr.length === 2 ? `${city}, ${abbr}` : city || "Current location";
  if (zip.length === 5) {
    try {
      const fromZip = await geocodeZip(zip);
      if (fromZip?.name) name = fromZip.name;
    } catch (error) {
      /* keep reverse-geocode name */
    }
  }
  return { zip, name, lat, lon };
}

function gpsErrorMessage(error) {
  const code = error?.code;
  if (error?.message === "us-only") return "Location is outside the US. Enter a ZIP instead.";
  if (error?.message === "unsupported") return "This browser can’t share location. Enter a ZIP instead.";
  if (code === 1) return "Location permission denied. Enable it in Settings, or enter a ZIP.";
  if (code === 2) return "Couldn’t read your location. Try again, or enter a ZIP.";
  if (code === 3) return "Location timed out. Try again, or enter a ZIP.";
  return "Couldn’t use your location. Enter a ZIP instead.";
}

function getDevicePosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("unsupported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 15000,
      maximumAge: 5 * 60 * 1000,
    });
  });
}

async function applyDeviceLocation() {
  const locate = document.getElementById("zip-locate");
  const error = document.getElementById("zip-error");
  const save = document.getElementById("zip-save");
  const input = document.getElementById("zip-input");
  if (locate) locate.disabled = true;
  if (save) save.disabled = true;
  if (error) error.hidden = true;
  try {
    const pos = await getDevicePosition();
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    const next = await reverseGeocode(lat, lon);
    const house = currentHouse();
    persistHouseLocation(house.id, next);
    if (input && next.zip) input.value = next.zip;
    closeZipSheet();
    applyHouse(house.id, { refreshData: true });
    showToast(`Using ${next.name}`);
  } catch (err) {
    if (error) {
      error.textContent = gpsErrorMessage(err);
      error.hidden = false;
    }
  } finally {
    if (locate) locate.disabled = false;
    if (save) save.disabled = false;
  }
}

function openZipSheet() {
  const house = currentHouse();
  const sheet = document.getElementById("zip-sheet");
  const input = document.getElementById("zip-input");
  const error = document.getElementById("zip-error");
  setText("zip-sheet-title", house.id === "beach" ? "Beach location" : "Home location");
  input.value = house.zip;
  error.hidden = true;
  sheet.hidden = false;
  setTimeout(() => input.focus(), 50);
}

function closeZipSheet() {
  document.getElementById("zip-sheet").hidden = true;
}

async function saveZipSheet() {
  const input = document.getElementById("zip-input");
  const error = document.getElementById("zip-error");
  const save = document.getElementById("zip-save");
  const zip = String(input.value || "").replace(/\D/g, "").slice(0, 5);
  if (zip.length !== 5) {
    error.textContent = "Enter a 5-digit US ZIP.";
    error.hidden = false;
    input.focus();
    return;
  }
  const house = currentHouse();
  save.disabled = true;
  error.hidden = true;
  try {
    const defaults = HOUSES[house.id];
    let next;
    if (zip === defaults.zip) {
      next = { zip: defaults.zip, name: defaults.name, lat: defaults.lat, lon: defaults.lon };
    } else {
      next = await geocodeZip(zip);
    }
    persistHouseLocation(house.id, next);
    closeZipSheet();
    applyHouse(house.id, { refreshData: true });
  } catch (err) {
    error.textContent = "Could not find that ZIP. Check it and try again.";
    error.hidden = false;
  } finally {
    save.disabled = false;
  }
}

document.getElementById("place").addEventListener("click", openZipSheet);
document.getElementById("zip-cancel").addEventListener("click", closeZipSheet);
document.getElementById("zip-save").addEventListener("click", saveZipSheet);
document.getElementById("zip-locate").addEventListener("click", applyDeviceLocation);
document.getElementById("zip-sheet").addEventListener("click", (event) => {
  if (event.target.id === "zip-sheet") closeZipSheet();
});
document.getElementById("zip-input").addEventListener("input", (event) => {
  event.target.value = String(event.target.value || "").replace(/\D/g, "").slice(0, 5);
});
document.getElementById("zip-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter") saveZipSheet();
  if (event.key === "Escape") closeZipSheet();
});

applyTheme(currentTheme());
applyHouse(currentHouse().id, { refreshData: false });

document.getElementById("share-btn").addEventListener("click", async () => {
  const house = currentHouse();
  const summary = document.querySelector(".phone").dataset.summary || `Weather for ${house.name}`;
  const shareData = {
    title: `${house.short} weather`,
    text: summary,
    url: window.location.href,
  };
  try {
    if (navigator.share) await navigator.share(shareData);
    else {
      await navigator.clipboard.writeText(summary);
      showToast("Copied current conditions");
    }
  } catch (error) {
    if (error?.name !== "AbortError") showToast("Share canceled");
  }
});

refresh();
setInterval(refresh, 5 * 60 * 1000);
