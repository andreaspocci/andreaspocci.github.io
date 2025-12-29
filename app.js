const WORKER_BASE = "https://dry-frog-bb05.spocci.workers.dev";
const URL_STATION_NOW = `${WORKER_BASE}/station/now`;
const URL_STATION_HISTORY = `${WORKER_BASE}/station/history?hours=48`;
const URL_FORECAST = `${WORKER_BASE}/forecast`;

const el = (id) => document.getElementById(id);

init();

async function init() {
  setStatus("loading", "Carico");

  const [stationNow, stationHist, forecast] = await Promise.allSettled([
    fetchJson(URL_STATION_NOW),
    fetchJson(URL_STATION_HISTORY),
    fetchJson(URL_FORECAST),
  ]);

  const okStationNow = stationNow.status === "fulfilled" && stationNow.value?.ok;
  const okHist = stationHist.status === "fulfilled" && stationHist.value?.ok;
  const okForecast = forecast.status === "fulfilled" && !forecast.value?.error;

  const updated = new Date().toLocaleString("it-CH", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  el("subtitle").textContent = `Aggiornato: ${updated}`;

  if (!okStationNow && !okForecast) {
    setStatus("offline", "Offline");
    el("footerText").textContent = "Errore: stazione e previsioni non disponibili";
    return;
  }

  setStatus("live", "Live");

  if (okStationNow) renderStationNow(stationNow.value.sample);
  else el("nowMeta").textContent = "Stazione non disponibile";

  if (okHist) renderTempChart(stationHist.value.points || []);
  else el("chartLegend").textContent = "Storico non disponibile (KV o cron non configurati / ancora vuoto)";

  if (okForecast) {
    renderHourly(forecast.value);
    renderDaily(forecast.value);
  }

  const footerParts = [];
  footerParts.push(okStationNow ? "stazione ok" : "stazione ko");
  footerParts.push(okHist ? "storico ok" : "storico ko");
  footerParts.push(okForecast ? "previsioni ok" : "previsioni ko");
  el("footerText").textContent = footerParts.join(" · ");
}

async function fetchJson(url) {
  const r = await fetch(url, { cache: "no-store" });
  const t = await r.text();
  let j;
  try { j = JSON.parse(t); } catch { throw new Error(`JSON invalido da ${url}: ${t.slice(0,120)}`); }
  if (!r.ok) throw new Error(`HTTP ${r.status} da ${url}: ${t.slice(0,160)}`);
  return j;
}

function setStatus(mode, text) {
  const pill = el("statusPill");
  const dot = pill.querySelector(".dot");
  el("statusText").textContent = text;

  if (mode === "live") {
    dot.style.background = "rgba(34,197,94,.9)";
    dot.style.boxShadow = "0 0 0 6px rgba(34,197,94,.12)";
  } else if (mode === "loading") {
    dot.style.background = "rgba(59,130,246,.95)";
    dot.style.boxShadow = "0 0 0 6px rgba(59,130,246,.12)";
  } else {
    dot.style.background = "rgba(239,68,68,.95)";
    dot.style.boxShadow = "0 0 0 6px rgba(239,68,68,.12)";
  }
}

function fmt(n, digits = 0) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function renderStationNow(s) {
  const o = s.outdoor || {};
  const w = s.wind || {};
  const p = s.pressure || {};
  const so = s.solar || {};
  const r = s.rain || {};
  const i = s.indoor || {};
  const b = s.battery || {};

  el("nowTemp").textContent = o.tempC == null ? "--°" : `${Math.round(o.tempC)}°`;
  el("nowDesc").textContent = `Stazione meteo · percepita ${fmt(o.feelsLikeC,0)}°`;
  el("nowMeta").textContent = `Ultimo campione: ${new Date(s.iso).toLocaleTimeString("it-CH", { hour:"2-digit", minute:"2-digit" })} · Direzione ${fmt(w.directionDeg,0)}°`;

  el("humNow").textContent = o.humidity == null ? "--%" : `${Math.round(o.humidity)}%`;
  el("pressNow").textContent = p.relativeHpa == null ? "-- hPa" : `${Math.round(p.relativeHpa)} hPa`;
  el("windNow").textContent =
    w.speedKmh == null ? "-- / -- km/h" : `${fmt(w.speedKmh,0)} / ${fmt(w.gustKmh,0)} km/h`;

  el("solarNow").textContent = so.solarWm2 == null ? "-- W/m²" : `${fmt(so.solarWm2,1)} W/m²`;
  el("uviNow").textContent = so.uvi == null ? "--" : `${fmt(so.uvi,0)}`;
  el("vpdNow").textContent = o.vpdInHg == null ? "--" : `${fmt(o.vpdInHg,3)} inHg`;
  el("dewNow").textContent = o.dewPointC == null ? "--°" : `${fmt(o.dewPointC,0)}°`;

  el("rainRate").textContent = r.rateMmH == null ? "-- mm/h" : `${fmt(r.rateMmH,1)} mm/h`;
  el("rain1h").textContent = r.mm1h == null ? "-- mm" : `${fmt(r.mm1h,1)} mm`;
  el("rain24h").textContent = r.mm24h == null ? "-- mm" : `${fmt(r.mm24h,1)} mm`;
  el("rainDaily").textContent = r.dailyMm == null ? "-- mm" : `${fmt(r.dailyMm,1)} mm`;
  el("rainMonth").textContent = r.monthlyMm == null ? "-- mm" : `${fmt(r.monthlyMm,1)} mm`;
  el("rainYear").textContent = r.yearlyMm == null ? "-- mm" : `${fmt(r.yearlyMm,1)} mm`;

  el("inTemp").textContent = i.tempC == null ? "--°" : `${fmt(i.tempC,0)}°`;
  el("inHum").textContent = i.humidity == null ? "--%" : `${fmt(i.humidity,0)}%`;
  el("battV").textContent = b.batteryV == null ? "-- V" : `${fmt(b.batteryV,2)} V`;
  el("capV").textContent = b.capacitorV == null ? "-- V" : `${fmt(b.capacitorV,2)} V`;
}

function renderTempChart(points) {
  const canvas = el("chartTemp");
  const ctx = canvas.getContext("2d");

  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 900;
  const cssH = 220;

  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, cssW, cssH);

  const temps = points
    .map(p => p?.outdoor?.tempC)
    .filter(v => typeof v === "number" && isFinite(v));

  if (temps.length < 2) {
    el("chartLegend").textContent = "Storico insufficiente: aspetta che si accumulino campioni (cron ogni 10 minuti).";
    return;
  }

  const min = Math.min(...temps);
  const max = Math.max(...temps);

  const pad = 18;
  const w = cssW;
  const h = cssH;
  const usableW = w - pad * 2;
  const usableH = h - pad * 2;

  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.moveTo(pad, h - pad);
  ctx.lineTo(w - pad, h - pad);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.beginPath();
  let idx = 0;
  for (const p of points) {
    const t = p?.outdoor?.tempC;
    if (typeof t !== "number" || !isFinite(t)) continue;
    const x = pad + (idx / (temps.length - 1)) * usableW;
    const y = pad + (1 - (t - min) / (max - min)) * usableH;
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    idx++;
  }
  ctx.lineWidth = 2;
  ctx.stroke();

  el("chartLegend").textContent = `Temp 48h: min ${min.toFixed(1)}° · max ${max.toFixed(1)}° · campioni ${temps.length}`;
}

function renderHourly(d) {
  const root = el("hourly");
  root.innerHTML = "";

  const hourly = d.hourly;
  if (!hourly?.time?.length) return;

  const nowIndex = findClosestHourIndex(hourly.time);
  const count = 12;

  for (let i = nowIndex; i < Math.min(nowIndex + count, hourly.time.length); i++) {
    const t = hourly.time[i];
    const temp = hourly.temperature_2m[i];
    const code = hourly.weather_code[i];
    const rain = hourly.precipitation_probability[i];
    const wind = hourly.wind_speed_10m[i];

    const node = document.createElement("div");
    node.className = "hour";
    node.innerHTML = `
      <div class="hourT">${formatHour(t)}</div>
      <div class="hourI">${iconFromCode(code)}</div>
      <div class="hourV">${Math.round(temp)}°</div>
      <div class="hourS">${Math.round(rain)}% · ${Math.round(wind)} km/h</div>
    `;
    root.appendChild(node);
  }
}

function renderDaily(d) {
  const root = el("daily");
  root.innerHTML = "";

  const daily = d.daily;
  if (!daily?.time?.length) return;

  for (let i = 0; i < daily.time.length; i++) {
    const date = daily.time[i];
    const min = daily.temperature_2m_min[i];
    const max = daily.temperature_2m_max[i];
    const code = daily.weather_code[i];
    const rain = daily.precipitation_probability_max[i];

    const node = document.createElement("div");
    node.className = "day";
    node.innerHTML = `
      <div class="dayL">
        <div class="dayName">${weekdayName(date, i)}</div>
        <div class="dayDate">${formatDate(date)}</div>
      </div>
      <div class="dayIcon">${iconFromCode(code)}</div>
      <div class="dayR">
        <div class="dayTemp">${Math.round(min)}° / ${Math.round(max)}°</div>
        <div class="dayRain">${Math.round(rain)}%</div>
      </div>
    `;
    root.appendChild(node);
  }
}

function findClosestHourIndex(times) {
  const now = Date.now();
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const t = Date.parse(times[i]);
    const diff = Math.abs(t - now);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  }
  return best;
}

function formatHour(iso) {
  return new Date(iso).toLocaleTimeString("it-CH", { hour:"2-digit", minute:"2-digit" });
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("it-CH", { day:"2-digit", month:"2-digit" });
}

function weekdayName(iso, offset) {
  const d = new Date(iso);
  const name = d.toLocaleDateString("it-CH", { weekday: "long" });
  if (offset === 0) return "Oggi";
  if (offset === 1) return "Domani";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function iconFromCode(code) {
  const c = Number(code);
  if (c === 0) return "☀️";
  if (c === 1 || c === 2) return "🌤️";
  if (c === 3) return "☁️";
  if (c === 45 || c === 48) return "🌫️";
  if ([51,53,55,56,57].includes(c)) return "🌦️";
  if ([61,63,65,66,67].includes(c)) return "🌧️";
  if ([71,73,75,77,85,86].includes(c)) return "🌨️";
  if ([80,81,82].includes(c)) return "🌧️";
  if ([95,96,99].includes(c)) return "⛈️";
  return "☁️";
}


