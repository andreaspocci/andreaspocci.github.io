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

  if (!okStationNow && !okForecast) {
    setStatus("offline", "Offline");
    el("subtitle").textContent = "Dati non disponibili ora";
    el("footerText").textContent = `Errore: stazione e previsioni non disponibili`;
    return;
  }

  setStatus("live", "Live");

  const updated = new Date().toLocaleString("it-CH", { weekday:"short", day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" });
  el("subtitle").textContent = `Aggiornato: ${updated}`;

  if (okStationNow) renderStationNow(stationNow.value.sample);
  if (okHist) renderTempChart(stationHist.value.points || []);
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

function renderStationNow(s) {
  if (!s) return;

  const temp = s.tempC;
  const hum = s.humidity;
  const wind = s.windKmh;
  const press = s.pressure;

  el("nowTemp").textContent = temp == null ? "--°" : `${Math.round(temp)}°`;
  el("nowMeta").textContent = s.iso ? new Date(s.iso).toLocaleString("it-CH", { hour:"2-digit", minute:"2-digit" }) : "—";

  el("humNow").textContent = hum == null ? "--%" : `${Math.round(hum)}%`;
  el("windNow").textContent = wind == null ? "-- km/h" : `${Math.round(wind)} km/h`;
  el("pressNow").textContent = press == null ? "--" : `${Math.round(press)} hPa`;
}

function renderTempChart(points) {
  const canvas = el("chartTemp");
  const ctx = canvas.getContext("2d");

  // resize per device pixel ratio
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = 220;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, cssW, cssH);

  const temps = points.map(p => p.tempC).filter(v => typeof v === "number" && isFinite(v));
  if (temps.length < 2) {
    el("chartLegend").textContent = "Storico insufficiente. Attiva il cron o lascia il sito aperto per popolare i dati.";
    return;
  }

  const min = Math.min(...temps);
  const max = Math.max(...temps);

  const pad = 18;
  const w = cssW;
  const h = cssH;

  // assi leggeri
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.moveTo(pad, h - pad);
  ctx.lineTo(w - pad, h - pad);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // linea temperatura
  ctx.beginPath();
  const usableW = w - pad * 2;
  const usableH = h - pad * 2;

  let first = true;
  let idx = 0;
  for (const p of points) {
    if (typeof p.tempC !== "number" || !isFinite(p.tempC)) continue;
    const x = pad + (idx / (temps.length - 1)) * usableW;
    const y = pad + (1 - (p.tempC - min) / (max - min)) * usableH;
    if (first) { ctx.moveTo(x, y); first = false; }
    else ctx.lineTo(x, y);
    idx++;
  }
  ctx.lineWidth = 2;
  ctx.stroke();

  el("chartLegend").textContent = `Temperatura 48h: min ${min.toFixed(1)}° · max ${max.toFixed(1)}° · punti ${temps.length}`;
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
