const WORKER_FORECAST_URL = "https://dry-frog-bb05.spocci.workers.dev/forecast";
const STORAGE_KEY = "spocci_meteo_cache_v1";

const el = (id) => document.getElementById(id);

const state = {
  data: null,
  source: "live",
  cachedAt: null,
};

init();

async function init() {
  // Render immediato con cache locale, così non vedi bianco
  const local = readLocalCache();
  if (local?.data) {
    state.data = local.data;
    state.source = "cache";
    state.cachedAt = local.cachedAt;
    render();
  }

  // Poi prova a prendere dati aggiornati dal Worker
  try {
    const resp = await fetch(WORKER_FORECAST_URL, { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();

    // Se il Worker ti manda un errore strutturato
    if (json && json.error) throw new Error(json.error);

    state.data = json;
    state.source = "live";
    state.cachedAt = Date.now();

    writeLocalCache(json, state.cachedAt);
    render();
  } catch (e) {
    // Se non hai cache locale, almeno mostra un messaggio decente
    if (!state.data) {
      showOfflineFallback(e);
    } else {
      setStatus("cache", `Cache`);
      el("footerText").textContent = `Usata cache locale. Motivo: ${String(e).slice(0, 120)}`;
    }
  }
}

function showOfflineFallback(err) {
  setStatus("offline", "Offline");
  el("subtitle").textContent = "Dati non disponibili ora";
  el("nowTemp").textContent = "--°";
  el("nowDesc").textContent = "Nessun dato";
  el("nowMeta").textContent = "Controlla più tardi";
  el("rainToday").textContent = "--%";
  el("windNow").textContent = "-- km/h";
  el("minMaxToday").textContent = "--° / --°";
  el("hourly").innerHTML = "";
  el("daily").innerHTML = "";
  el("footerText").textContent = `Errore: ${String(err).slice(0, 160)}`;
}

function render() {
  if (!state.data) return;

  const d = state.data;

  const now = pickNow(d);
  const today = pickToday(d);
  const updated = formatUpdated(state.cachedAt);

  el("subtitle").textContent = `Ultimo aggiornamento: ${updated}`;
  setStatus(state.source, state.source === "live" ? "Live" : "Cache");

  el("heroIcon").textContent = iconFromCode(now.code);
  el("nowTemp").textContent = `${Math.round(now.temp)}°`;
  el("nowDesc").textContent = descFromCode(now.code);
  el("nowMeta").textContent = `${now.timeLabel} · ${now.windLabel}`;

  el("rainToday").textContent = `${Math.round(today.rainMax)}%`;
  el("windNow").textContent = `${Math.round(now.wind)} km/h`;
  el("minMaxToday").textContent = `${Math.round(today.min)}° / ${Math.round(today.max)}°`;

  renderHourly(d);
  renderDaily(d);

  const footer = state.source === "live"
    ? "Dati serviti dal Worker con cache"
    : "Dati da cache locale (il Worker o l’API erano limitati)";
  el("footerText").textContent = footer;
}

function setStatus(mode, text) {
  const pill = el("statusPill");
  const dot = pill.querySelector(".dot");
  el("statusText").textContent = text;

  // Non serve colore perfetto, serve chiarezza
  if (mode === "live") {
    dot.style.background = "rgba(34,197,94,.9)";
    dot.style.boxShadow = "0 0 0 6px rgba(34,197,94,.12)";
  } else if (mode === "cache") {
    dot.style.background = "rgba(245,158,11,.95)";
    dot.style.boxShadow = "0 0 0 6px rgba(245,158,11,.12)";
  } else {
    dot.style.background = "rgba(239,68,68,.95)";
    dot.style.boxShadow = "0 0 0 6px rgba(239,68,68,.12)";
  }
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

function pickNow(d) {
  // Preferisci current_weather se presente, altrimenti deriva dall’hourly
  if (d.current_weather) {
    const cw = d.current_weather;
    return {
      temp: cw.temperature,
      code: cw.weathercode ?? cw.weather_code ?? 0,
      wind: cw.windspeed ?? cw.wind_speed ?? 0,
      timeLabel: formatDateTime(cw.time),
      windLabel: `Vento ${Math.round((cw.windspeed ?? 0))} km/h`,
    };
  }

  const hourly = d.hourly;
  const i = findClosestHourIndex(hourly.time);
  return {
    temp: hourly.temperature_2m[i],
    code: hourly.weather_code[i],
    wind: hourly.wind_speed_10m[i],
    timeLabel: formatDateTime(hourly.time[i]),
    windLabel: `Vento ${Math.round(hourly.wind_speed_10m[i])} km/h`,
  };
}

function pickToday(d) {
  const daily = d.daily;
  const i = 0;
  return {
    min: daily.temperature_2m_min[i],
    max: daily.temperature_2m_max[i],
    rainMax: daily.precipitation_probability_max[i],
  };
}

function readLocalCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !obj.data) return null;
    return obj;
  } catch {
    return null;
  }
}

function writeLocalCache(data, cachedAt) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ data, cachedAt }));
  } catch {}
}

function findClosestHourIndex(times) {
  // times: array di stringhe ISO in timezone già applicato da Open-Meteo
  const now = Date.now();
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const t = Date.parse(times[i]);
    const diff = Math.abs(t - now);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}

function formatUpdated(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("it-CH", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatHour(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString("it-CH", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("it-CH", { day: "2-digit", month: "2-digit" });
}

function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString("it-CH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function weekdayName(iso, offset) {
  const d = new Date(iso);
  const name = d.toLocaleDateString("it-CH", { weekday: "long" });
  if (offset === 0) return "Oggi";
  if (offset === 1) return "Domani";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Open-Meteo weather_code mapping (semplificato ma utile)
function iconFromCode(code) {
  const c = Number(code);
  if ([0].includes(c)) return "☀️";
  if ([1, 2].includes(c)) return "🌤️";
  if ([3].includes(c)) return "☁️";
  if ([45, 48].includes(c)) return "🌫️";
  if ([51, 53, 55, 56, 57].includes(c)) return "🌦️";
  if ([61, 63, 65, 66, 67].includes(c)) return "🌧️";
  if ([71, 73, 75, 77].includes(c)) return "🌨️";
  if ([80, 81, 82].includes(c)) return "🌧️";
  if ([85, 86].includes(c)) return "🌨️";
  if ([95, 96, 99].includes(c)) return "⛈️";
  return "☁️";
}

function descFromCode(code) {
  const c = Number(code);
  if (c === 0) return "Sereno";
  if (c === 1) return "Quasi sereno";
  if (c === 2) return "Parzialmente nuvoloso";
  if (c === 3) return "Coperto";
  if (c === 45 || c === 48) return "Nebbia";
  if ([51,53,55].includes(c)) return "Pioviggine";
  if ([56,57].includes(c)) return "Pioviggine gelata";
  if ([61,63,65].includes(c)) return "Pioggia";
  if ([66,67].includes(c)) return "Pioggia gelata";
  if ([71,73,75].includes(c)) return "Neve";
  if (c === 77) return "Granuli di neve";
  if ([80,81,82].includes(c)) return "Rovesci";
  if ([85,86].includes(c)) return "Rovesci di neve";
  if (c === 95) return "Temporali";
  if ([96,99].includes(c)) return "Temporali con grandine";
  return "Variabile";
}
