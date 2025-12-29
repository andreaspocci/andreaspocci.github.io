const WORKER_BASE = "https://dry-frog-bb05.spocci.workers.dev";
const URL_STATION_NOW = `${WORKER_BASE}/station/now`;
const URL_STATION_HISTORY_COMPACT = `${WORKER_BASE}/station/history/compact?hours=48`;
const URL_FORECAST = `${WORKER_BASE}/forecast`;

const el = (id) => document.getElementById(id);

startClock();
init();

function startClock() {
  const tick = () => {
    const now = new Date();
    el("clock").textContent = now.toLocaleTimeString("it-CH", { hour: "2-digit", minute: "2-digit" });
    el("dateStr").textContent = now.toLocaleDateString("it-CH", { day: "2-digit", month: "short" });
  };
  tick();
  setInterval(tick, 20_000);
}

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

  if (!okStationNow && !okForecast) {
    setStatus("offline", "Offline");
    el("footerText").textContent = "Errore: stazione e previsioni non disponibili";
    el("heroTitle").textContent = "Offline";
    el("heroSubtitle").textContent = "Nessun dato disponibile";
    return;
  }

  setStatus("live", "Live");

  // hero label: preferisco forecast, altrimenti generic
  let conditionText = "Meteo attuale";
  let conditionDetail = "Stazione meteo attiva";

  if (okForecast && forecast.value?.current_weather) {
    const code = forecast.value.current_weather.weathercode;
    conditionText = conditionLabelFromCode(code);
    conditionDetail = "Previsione (Open-Meteo)";
  } else if (!okForecast) {
    conditionDetail = "Previsione non disponibile (quota/429)";
  }

  el("heroTitle").textContent = conditionText;
  el("heroSubtitle").textContent = conditionDetail;

  let lastSample = null;
  if (okStationNow) {
    lastSample = stationNow.value.sample;
    renderStationNow(lastSample);
    updateRainLayer(lastSample);
  } else {
    el("nowMeta").textContent = "Stazione non disponibile";
  }

  // storico: vero se c’è, altrimenti sintetico
  let pts = [];
  if (okHist) pts = histCompact.value.points || [];

  const useSynthetic = pts.length < 20 && lastSample; // soglia semplice
  if (useSynthetic) {
    pts = generateSyntheticHistoryFromSample(lastSample, 48, 10);
    el("chartLegend").textContent = "Storico provvisorio (dati sintetici). Appena arriva lo storico reale verrà sostituito.";
  } else if (!okHist) {
    el("chartLegend").textContent = "Storico non disponibile (KV/cron non configurati o ancora vuoto).";
  }

  renderSparks(pts);
  renderTempChartFromCompact(pts);
  renderWaveFromCompact(pts);

  if (okForecast) {
    renderHourly(forecast.value);
    renderDaily(forecast.value);
    const n1 = el("forecastNote1");
    const n2 = el("forecastNote2");
    if (n1) n1.textContent = "";
    if (n2) n2.textContent = "";
  }

  const footerParts = [];
  footerParts.push(okStationNow ? "stazione ok" : "stazione ko");
  footerParts.push(okHist ? "storico ok" : (useSynthetic ? "storico sintetico" : "storico ko"));
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
    dot.style.background = "rgba(34,197,94,0.9)";
    dot.style.boxShadow = "0 0 0 6px rgba(34,197,94,0.12)";
  } else if (mode === "loading") {
    dot.style.background = "rgba(59,130,246,0.95)";
    dot.style.boxShadow = "0 0 0 6px rgba(59,130,246,0.12)";
  } else {
    dot.style.background = "rgba(239,68,68,0.95)";
    dot.style.boxShadow = "0 0 0 6px rgba(239,68,68,0.12)";
  }
}

function isNum(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function fmt(n, digits = 0) {
  if (!isNum(n)) return "—";
  return n.toFixed(digits);
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

  el("nowTemp").textContent = isNum(o.tempC) ? `${Math.round(o.tempC)}°` : "--°";

  const timeStr = s?.iso
    ? new Date(s.iso).toLocaleTimeString("it-CH", { hour: "2-digit", minute: "2-digit" })
    : "—";

  const windDir = degToCompass(w.directionDeg);
  el("nowMeta").textContent = `Ultimo campione ${timeStr} · Dir ${windDir} ${fmt(w.directionDeg,0)}°`;

  el("humNow").textContent = isNum(o.humidity) ? `${Math.round(o.humidity)}%` : "--%";
  el("pressNow").textContent = isNum(p.relativeHpa) ? `${Math.round(p.relativeHpa)} hPa` : "-- hPa";
  el("windNow").textContent = (isNum(w.speedKmh) || isNum(w.gustKmh)) ? `${fmt(w.speedKmh,0)} / ${fmt(w.gustKmh,0)} km/h` : "-- / -- km/h";

  el("solarNow").textContent = isNum(so.solarWm2) ? `${fmt(so.solarWm2,1)} W/m²` : "-- W/m²";
  el("uviNow").textContent = isNum(so.uvi) ? `${fmt(so.uvi,0)}` : "--";
  el("dewNow").textContent = isNum(o.dewPointC) ? `${fmt(o.dewPointC,0)}°` : "--°";

  const vpdKpa = isNum(o.vpdInHg) ? vpdToKpa(o.vpdInHg) : null;
  el("vpdNow").textContent = isNum(vpdKpa) ? `${fmt(vpdKpa,3)} kPa` : "-- kPa";

  el("rainRate").textContent = isNum(r.rateMmH) ? `${fmt(r.rateMmH,1)} mm/h` : "-- mm/h";
  el("rain1h").textContent = isNum(r.mm1h) ? `${fmt(r.mm1h,1)} mm` : "-- mm";
  el("rain24h").textContent = isNum(r.mm24h) ? `${fmt(r.mm24h,1)} mm` : "-- mm";
  el("rainDaily").textContent = isNum(r.dailyMm) ? `${fmt(r.dailyMm,1)} mm` : "-- mm";
  el("rainMonth").textContent = isNum(r.monthlyMm) ? `${fmt(r.monthlyMm,1)} mm` : "-- mm";
  el("rainYear").textContent = isNum(r.yearlyMm) ? `${fmt(r.yearlyMm,1)} mm` : "-- mm";
}

function renderSparks(points) {
  const arr = (k) => points.map(p => p[k]);

  drawSpark("spHum", arr("h"));
  drawSpark("spPress", arr("p"));
  drawSpark("spWind", arr("w"));

  drawSpark("spSolar", arr("s"));
  drawSpark("spUvi", arr("u"));
  drawSpark("spDew", arr("dew"));

  const vpdKpa = points.map(p => (isNum(p.vpd) ? vpdToKpa(p.vpd) : null));
  drawSpark("spVpd", vpdKpa);

  drawSpark("spRainRate", arr("rr"));
  drawSpark("spRain1h", arr("r1"));
  drawSpark("spRain24h", arr("r24"));
  drawSpark("spRainDaily", arr("rd"));
  drawSpark("spRainMonth", arr("rm"));
  drawSpark("spRainYear", arr("ry"));
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

  const clean = values.filter(isNum);
  if (clean.length < 2) {
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    ctx.moveTo(8, cssH - 10);
    ctx.lineTo(cssW - 8, cssH - 10);
    ctx.stroke();
    ctx.globalAlpha = 0.35;
    ctx.font = "11px system-ui";
    ctx.fillText("in attesa storico", 10, 14);
    ctx.globalAlpha = 1;
    return;
  }

  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = (max - min) || 1;

  const padX = 8;
  const padY = 6;
  const w = cssW - padX * 2;
  const h = cssH - padY * 2;

  ctx.globalAlpha = 0.25;
  ctx.beginPath();
  ctx.moveTo(padX, cssH - padY);
  ctx.lineTo(cssW - padX, cssH - padY);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.beginPath();
  let started = false;
  const n = values.length;

  for (let i = 0; i < n; i++) {
    const val = values[i];
    if (!isNum(val)) continue;
    const x = padX + (i / (n - 1)) * w;
    const y = padY + (1 - (val - min) / range) * h;
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }

  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.globalAlpha = 0.35;
  ctx.font = "11px system-ui";
  ctx.fillText(`${min.toFixed(0)}–${max.toFixed(0)}`, cssW - 58, 14);
  ctx.globalAlpha = 1;
}

function renderTempChartFromCompact(points) {
  const canvas = el("chartTemp");
  const ctx = canvas.getContext("2d");

  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 900;
  const cssH = canvas.clientHeight || 260;

  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, cssW, cssH);

  const temps = points.map(p => p.t).filter(isNum);
  if (temps.length < 2) return;

  const min = Math.min(...temps);
  const max = Math.max(...temps);
  const range = (max - min) || 1;

  const pad = 18;
  const w = cssW;
  const h = cssH;
  const usableW = w - pad * 2;
  const usableH = h - pad * 2;

  ctx.globalAlpha = 0.25;
  ctx.beginPath();
  ctx.moveTo(pad, h - pad);
  ctx.lineTo(w - pad, h - pad);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.beginPath();
  for (let i = 0; i < temps.length; i++) {
    const t = temps[i];
    const x = pad + (i / (temps.length - 1)) * usableW;
    const y = pad + (1 - (t - min) / range) * usableH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineWidth = 2;
  ctx.stroke();
}

function renderWaveFromCompact(points) {
  const canvas = el("wave");
  const ctx = canvas.getContext("2d");

  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 900;
  const cssH = canvas.clientHeight || 160;

  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, cssW, cssH);

  const temps = points.map(p => p.t).filter(isNum);
  if (temps.length < 2) return;

  const min = Math.min(...temps);
  const max = Math.max(...temps);
  const range = (max - min) || 1;

  ctx.globalAlpha = 0.20;
  ctx.beginPath();
  ctx.moveTo(0, cssH);
  const step = cssW / (temps.length - 1);
  for (let i = 0; i < temps.length; i++) {
    const y = 12 + (1 - (temps[i] - min) / range) * (cssH - 24);
    ctx.lineTo(i * step, y);
  }
  ctx.lineTo(cssW, cssH);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.beginPath();
  for (let i = 0; i < temps.length; i++) {
    const y = 12 + (1 - (temps[i] - min) / range) * (cssH - 24);
    const x = i * step;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineWidth = 2;
  ctx.stroke();
}

function updateRainLayer(sample) {
  const rate = sample?.rain?.rateMmH;
  const layer = el("rainLayer");
  if (!layer) return;

  const isRaining = isNum(rate) && rate > 0.05;
  layer.style.opacity = isRaining ? "1" : "0";

  if (!isRaining) {
    layer.innerHTML = "";
    return;
  }

  const drops = 70;
  layer.innerHTML = "";
  for (let i = 0; i < drops; i++) {
    const d = document.createElement("div");
    d.className = "rainDrop";
    d.style.left = Math.random() * 100 + "%";
    d.style.top = (-Math.random() * 100) + "px";
    d.style.animationDuration = (0.7 + Math.random() * 0.9) + "s";
    d.style.animationDelay = (-Math.random() * 1.2) + "s";
    d.style.opacity = String(0.15 + Math.random() * 0.55);
    layer.appendChild(d);
  }
}

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
  if ([61,63,65,66,67,80,81,82].includes(c)) return "🌧️";
  if ([71,73,75,77,85,86].includes(c)) return "🌨️";
  if ([95,96,99].includes(c)) return "⛈️";
  return "☁️";
}

function conditionLabelFromCode(code) {
  const c = Number(code);
  if (c === 0) return "Sereno";
  if (c === 1 || c === 2) return "Variabile";
  if (c === 3) return "Coperto";
  if (c === 45 || c === 48) return "Nebbia";
  if ([51,53,55,56,57].includes(c)) return "Pioviggine";
  if ([61,63,65,66,67,80,81,82].includes(c)) return "Pioggia";
  if ([71,73,75,77,85,86].includes(c)) return "Neve";
  if ([95,96,99].includes(c)) return "Temporale";
  return "Meteo";
}

// genera dati sintetici per riempire grafici finché il KV non è popolato
function generateSyntheticHistoryFromSample(sample, hours, stepMinutes) {
  const now = Date.now();
  const stepMs = stepMinutes * 60 * 1000;
  const points = [];
  const n = Math.floor((hours * 60) / stepMinutes) + 1;

  const baseT = sample?.outdoor?.tempC;
  const baseH = sample?.outdoor?.humidity;
  const baseP = sample?.pressure?.relativeHpa;
  const baseW = sample?.wind?.speedKmh;
  const baseS = sample?.solar?.solarWm2;
  const baseU = sample?.solar?.uvi;
  const baseDew = sample?.outdoor?.dewPointC;
  const baseVpd = sample?.outdoor?.vpdInHg;

  const baseRainRate = sample?.rain?.rateMmH;
  const baseR1 = sample?.rain?.mm1h;
  const baseR24 = sample?.rain?.mm24h;
  const baseRd = sample?.rain?.dailyMm;
  const baseRm = sample?.rain?.monthlyMm;
  const baseRy = sample?.rain?.yearlyMm;

  // oscillazioni realistiche, non perfette
  const ampT = 2.2;
  const ampH = 6.0;
  const ampP = 2.0;
  const ampW = 2.0;
  const ampS = 60.0;

  for (let i = 0; i < n; i++) {
    const ts = now - (n - 1 - i) * stepMs;
    const phase = (i / n) * Math.PI * 2;

    const noise = (a) => (Math.random() - 0.5) * a;

    const t = isNum(baseT) ? baseT + Math.sin(phase) * ampT + noise(0.4) : null;
    const h = isNum(baseH) ? clamp(baseH + Math.cos(phase) * ampH + noise(1.2), 0, 100) : null;
    const p = isNum(baseP) ? baseP + Math.sin(phase * 0.6) * ampP + noise(0.6) : null;
    const w = isNum(baseW) ? Math.max(0, baseW + Math.abs(Math.sin(phase * 1.4)) * ampW + noise(0.6)) : null;

    // insolazione: più alta a metà serie, bassa ai bordi (finto giorno)
    const dayShape = Math.max(0, Math.sin(phase));
    const s = isNum(baseS) ? Math.max(0, baseS + dayShape * ampS + noise(10)) : null;
    const u = isNum(baseU) ? Math.max(0, baseU + dayShape * 0.8 + noise(0.2)) : null;

    const dew = isNum(baseDew) ? baseDew + Math.cos(phase) * 0.8 + noise(0.2) : null;
    const vpd = isNum(baseVpd) ? Math.max(0, baseVpd + Math.sin(phase) * 0.01 + noise(0.002)) : null;

    const rr = isNum(baseRainRate) ? Math.max(0, baseRainRate + noise(0.05)) : 0;
    const r1 = isNum(baseR1) ? Math.max(0, baseR1 + noise(0.1)) : 0;
    const r24 = isNum(baseR24) ? Math.max(0, baseR24 + noise(0.2)) : 0;
    const rd = isNum(baseRd) ? Math.max(0, baseRd + noise(0.2)) : 0;
    const rm = isNum(baseRm) ? Math.max(0, baseRm + noise(0.4)) : 0;
    const ry = isNum(baseRy) ? Math.max(0, baseRy + noise(1.0)) : 0;

    points.push({
      ts,
      t, h, p, w,
      s, u, dew, vpd,
      rr, r1, r24, rd, rm, ry
    });
  }

  return points;
}

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}
