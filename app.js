const WORKER_BASE = "https://dry-frog-bb05.spocci.workers.dev";
const URL_STATION_NOW = `${WORKER_BASE}/station/now`;
const URL_STATION_HISTORY_COMPACT = `${WORKER_BASE}/station/history/compact?hours=48`;
const URL_FORECAST = `${WORKER_BASE}/forecast`;

const el = (id) => document.getElementById(id);

init();

async function init() {
  setStatus("loading", "Carico");

  const [stationNow, histCompact, forecast] = await Promise.allSettled([
    fetchJson(URL_STATION_NOW),
    fetchJson(URL_STATION_HISTORY_COMPACT),
    fetchJson(URL_FORECAST),
  ]);

  const okStationNow = stationNow.status === "fulfilled" && stationNow.value?.ok;
  const okHist = histCompact.status === "fulfilled" && histCompact.value?.ok;
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

  if (okHist) {
    const pts = histCompact.value.points || [];
    renderSparks(pts);
    renderTempChartFromCompact(pts);
  } else {
    setText("chartLegend", "Storico non disponibile (KV/cron non configurati o ancora vuoto).");
  }

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

function isNum(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function fmt(n, digits = 0) {
  if (!isNum(n)) return "—";
  return n.toFixed(digits);
}

function setText(id, text) {
  const node = el(id);
  if (node) node.textContent = text;
}

function vpdToKpa(vpdInHg) {
  return vpdInHg * 3.386389;
}

function degToCompass(deg) {
  if (!isNum(deg)) return "—";
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  const i = Math.round(((deg % 360) / 22.5)) % 16;
  return dirs[i];
}

function renderStationNow(s) {
  const o = s?.outdoor || {};
  const w = s?.wind || {};
  const p = s?.pressure || {};
  const so = s?.solar || {};
  const r = s?.rain || {};

  setText("nowTemp", isNum(o.tempC) ? `${Math.round(o.tempC)}°` : "--°");
  setText("nowDesc", "Stazione meteo");
  const timeStr = s?.iso
    ? new Date(s.iso).toLocaleTimeString("it-CH", { hour: "2-digit", minute: "2-digit" })
    : "—";
  const windDir = degToCompass(w.directionDeg);
  setText("nowMeta", `Ultimo campione: ${timeStr} · Dir ${windDir} ${fmt(w.directionDeg,0)}°`);

  setText("humNow", isNum(o.humidity) ? `${Math.round(o.humidity)}%` : "--%");
  setText("pressNow", isNum(p.relativeHpa) ? `${Math.round(p.relativeHpa)} hPa` : "-- hPa");
  setText("windNow", (isNum(w.speedKmh) || isNum(w.gustKmh)) ? `${fmt(w.speedKmh,0)} / ${fmt(w.gustKmh,0)} km/h` : "-- / -- km/h");

  setText("solarNow", isNum(so.solarWm2) ? `${fmt(so.solarWm2,1)} W/m²` : "-- W/m²");
  setText("uviNow", isNum(so.uvi) ? `${fmt(so.uvi,0)}` : "--");
  setText("dewNow", isNum(o.dewPointC) ? `${fmt(o.dewPointC,0)}°` : "--°");

  const vpdKpa = isNum(o.vpdInHg) ? vpdToKpa(o.vpdInHg) : null;
  setText("vpdNow", isNum(vpdKpa) ? `${fmt(vpdKpa,3)} kPa` : "-- kPa");

  setText("rainRate", isNum(r.rateMmH) ? `${fmt(r.rateMmH,1)} mm/h` : "-- mm/h");
  setText("rain1h", isNum(r.mm1h) ? `${fmt(r.mm1h,1)} mm` : "-- mm");
  setText("rain24h", isNum(r.mm24h) ? `${fmt(r.mm24h,1)} mm` : "-- mm");
  setText("rainDaily", isNum(r.dailyMm) ? `${fmt(r.dailyMm,1)} mm` : "-- mm");
  setText("rainMonth", isNum(r.monthlyMm) ? `${fmt(r.monthlyMm,1)} mm` : "-- mm");
  setText("rainYear", isNum(r.yearlyMm) ? `${fmt(r.yearlyMm,1)} mm` : "-- mm");
}

function renderSparks(points) {
  // points: {ts, t,h,p,w,s,u,r}
  const t = points.map(p => p.t);
  const h = points.map(p => p.h);
  const p = points.map(p => p.p);
  const w = points.map(p => p.w);
  const s = points.map(p => p.s);
  const u = points.map(p => p.u);
  const r = points.map(p => p.r);

  drawSpark("spHum", h);
  drawSpark("spPress", p);
  drawSpark("spWind", w);

  drawSpark("spSolar", s);
  drawSpark("spUvi", u);
  // vpd e dew non sono nel compatto: li lasciamo vuoti per ora (se li vuoi, li aggiungo nel compatto)
  // oppure li disegniamo con array vuoto
  drawSpark("spVpd", []);
  drawSpark("spDew", []);

  drawSpark("spRainRate", r);
  // per pioggia 1h/24h/daily/month/year dovremmo passare altri campi nel compatto; per ora restano vuoti
  drawSpark("spRain1h", []);
  drawSpark("spRain24h", []);
  drawSpark("spRainDaily", []);
  drawSpark("spRainMonth", []);
  drawSpark("spRainYear", []);
}

function drawSpark(canvasId, values) {
  const c = el(canvasId);
  if (!c) return;
  const ctx = c.getContext("2d");

  const cssW = c.clientWidth || 240;
  const cssH = 48;
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.floor(cssW * dpr);
  c.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, cssW, cssH);

  const v = values.filter(isNum);
  if (v.length < 2) {
    // linea base leggera
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.moveTo(0, cssH - 8);
    ctx.lineTo(cssW, cssH - 8);
    ctx.stroke();
    ctx.globalAlpha = 1;
    return;
  }

  const min = Math.min(...v);
  const max = Math.max(...v);
  const range = max - min || 1;

  const padX = 2;
  const padY = 4;
  const w = cssW - padX * 2;
  const h = cssH - padY * 2;

  ctx.beginPath();
  let idx = 0;
  for (const val of values) {
    if (!isNum(val)) continue;
    const x = padX + (idx / (v.length - 1)) * w;
    const y = padY + (1 - (val - min) / range) * h;
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    idx++;
  }
  ctx.lineWidth = 2;
  ctx.stroke();
}

function renderTempChartFromCompact(points) {
  const canvas = el("chartTemp");
  const ctx = canvas.getContext("2d");

  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 900;
  const cssH = 220;

  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, cssW, cssH);

  const temps = points.map(p => p.t).filter(isNum);
  if (temps.length < 2) {
    setText("chartLegend", "Storico insufficiente: aspetta campioni (cron ogni 10 minuti).");
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
  for (let i = 0; i < temps.length; i++) {
    const t = temps[i];
    const x = pad + (i / (temps.length - 1)) * usableW;
    const y = pad + (1 - (t - min) / (max - min || 1)) * usableH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineWidth = 2;
  ctx.stroke();

  setText("chartLegend", `Temp 48h: min ${min.toFixed(1)}° · max ${max.toFixed(1)}° · campioni ${temps.length}`);
}

/* previsioni: uguali a prima */
function renderHourly(d) {
  const root = el("hourly");
  if (!root) return;
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
  if (!root) return;
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
