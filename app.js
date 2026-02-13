// ============================================
// Vliegweer - Model Airplane Weather App
// ============================================

// ---------- CONFIGURATION ----------

const CONFIG = {
  API_BASE: 'https://api.open-meteo.com/v1/forecast',
  DEFAULT_LAT: 51.4542,
  DEFAULT_LON: 6.0514,
  DEFAULT_NAME: 'Horst',
  STORAGE_KEY_LOCATION: 'vliegweer_location',
  STORAGE_KEY_CACHE: 'vliegweer_cache',
  CACHE_MAX_AGE_MS: 30 * 60 * 1000,

  WEIGHT_WIND: 0.40,
  WEIGHT_TEMP: 0.20,
  WEIGHT_DIRECTION: 0.20,
  WEIGHT_RAIN: 0.20,

  THRESHOLD_GREEN: 75,
  THRESHOLD_YELLOW: 50,
  THRESHOLD_ORANGE: 25,

  HOUR_START: 8,
  HOUR_END: 18,
  HOUR_MORNING_END: 12
};

const SCORE_COLORS = {
  green: '#4CAF50',
  yellow: '#FFC107',
  orange: '#FF9800',
  red: '#F44336'
};

const SCORE_LABELS = {
  green: 'Uitstekend vliegweer!',
  yellow: 'Redelijk vliegweer',
  orange: 'Matig vliegweer',
  red: 'Slecht vliegweer'
};

const WIND_DIRECTIONS = [
  'N', 'NNO', 'NO', 'ONO', 'O', 'OZO', 'ZO', 'ZZO',
  'Z', 'ZZW', 'ZW', 'WZW', 'W', 'WNW', 'NW', 'NNW'
];

const WEATHER_CODES = {
  0: 'Helder', 1: 'Licht bewolkt', 2: 'Half bewolkt',
  3: 'Bewolkt', 45: 'Mist', 48: 'Rijpmist',
  51: 'Lichte motregen', 53: 'Motregen', 55: 'Dichte motregen',
  56: 'Lichte ijzel', 57: 'Ijzel',
  61: 'Lichte regen', 63: 'Regen', 65: 'Zware regen',
  66: 'Lichte ijsregen', 67: 'Ijsregen',
  71: 'Lichte sneeuw', 73: 'Sneeuw', 75: 'Zware sneeuw',
  77: 'Sneeuwkorrels',
  80: 'Lichte buien', 81: 'Buien', 82: 'Zware buien',
  85: 'Lichte sneeuwbuien', 86: 'Zware sneeuwbuien',
  95: 'Onweer', 96: 'Onweer met hagel', 99: 'Zwaar onweer'
};

const SPECIAL_DAY_KEYS = new Set([
  '22-3', '4-4', '18-4', '26-4', '9-5', '17-5', '22-5', '23-5', '24-5',
  '20-6', '27-6', '18-7', '25-7', '2-8', '15-8', '22-8', '29-8', '6-9',
  '12-9', '26-9', '4-10', '17-10', '25-10', '1-11'
]);

// ---------- SCORING FUNCTIONS ----------

function calcWindScore(speedKmh) {
  // Bft 0-2 (0-11 km/h) = perfect, Bft 5+ (39+ km/h) = 0
  if (speedKmh <= 11) return 100;
  if (speedKmh >= 39) return 0;
  return Math.round(100 * (1 - (speedKmh - 11) / 28));
}

function calcTempScore(tempC) {
  if (tempC <= 0 || tempC >= 32) return 0;
  if (tempC >= 12 && tempC <= 24) return 100;
  if (tempC < 12) {
    // 0°C=0, 12°C=100
    return Math.round(100 * (tempC / 12));
  }
  // 24°C=100, 32°C=0
  return Math.round(100 * (1 - (tempC - 24) / 8));
}

function calcDirectionScore(degrees) {
  // Best: NO (45°) and ZW (225°). Worst: ZO (135°) and NW (315°).
  const angle = ((degrees % 360) + 360) % 360;
  // Distance to the NO-ZW axis (45° or 225°)
  // Map angle so that 45° becomes 0°
  const shifted = ((angle - 45) % 360 + 360) % 360;
  const modAngle = shifted % 180;
  const distFromAxis = Math.min(modAngle, 180 - modAngle);
  // distFromAxis: 0 = perfect (NO or ZW), 90 = worst (ZO or NW)
  return Math.round(100 * (1 - distFromAxis / 90));
}

function calcRainScore(precipMm, precipProbability) {
  // Echte regen (≥0.3mm/h): niet vliegbaar
  if (precipMm >= 0.3) return 0;
  // Lichte motregen/sneeuw (0.1-0.3mm): flinke penalty maar niet 0
  if (precipMm > 0) return Math.max(0, Math.round(20 * (1 - precipMm / 0.3)));
  // Regenkans: agressieve curve
  if (precipProbability <= 0) return 100;
  if (precipProbability >= 70) return 0;
  return Math.max(0, Math.round(100 * Math.pow(1 - precipProbability / 70, 1.5)));
}

function calcOverallScore(wind, temp, direction, rain, windSpeedKmh) {
  // Windrichting is minder belangrijk bij lage windsnelheid
  // Bij Bft 0-1 (≤5 km/h): richting telt 25%, bij Bft 3+ (≥20 km/h): 100%
  const dirFactor = Math.min(1, Math.max(0.25, (windSpeedKmh - 5) / 15));
  const wDir = CONFIG.WEIGHT_DIRECTION * dirFactor;
  const wWind = CONFIG.WEIGHT_WIND + (CONFIG.WEIGHT_DIRECTION - wDir);

  // Echte regen (rain=0, dwz ≥0.3mm): niet vliegbaar, cap op 10
  if (rain === 0) {
    return Math.min(10, Math.round(
      wind * wWind + temp * CONFIG.WEIGHT_TEMP + direction * wDir
    ));
  }
  const base = Math.round(
    wind * wWind +
    temp * CONFIG.WEIGHT_TEMP +
    direction * wDir +
    rain * CONFIG.WEIGHT_RAIN
  );
  // Bij lage rain score (hoge regenkans): blend totaal richting rain score
  // rain=100 -> geen effect, rain=50 -> halve blend, rain=0 -> volledig rain
  if (rain < 50) {
    const blendFactor = 1 - rain / 50; // 0 bij rain=50, 1 bij rain=0
    const cap = rain + (100 - rain) * 0.4; // plafond gebaseerd op rain score
    return Math.round(Math.min(base, base * (1 - blendFactor * 0.5) + rain * blendFactor * 0.5));
  }
  return base;
}

function scoreToColorKey(score) {
  if (score >= CONFIG.THRESHOLD_GREEN) return 'green';
  if (score >= CONFIG.THRESHOLD_YELLOW) return 'yellow';
  if (score >= CONFIG.THRESHOLD_ORANGE) return 'orange';
  return 'red';
}

function scoreToColor(score) {
  return SCORE_COLORS[scoreToColorKey(score)];
}

function scoreToLabel(score) {
  return SCORE_LABELS[scoreToColorKey(score)];
}

function degreesToCompass(deg) {
  const idx = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
  return WIND_DIRECTIONS[idx];
}

function circularMeanDegrees(angles) {
  if (angles.length === 0) return 0;
  let sinSum = 0, cosSum = 0;
  for (const a of angles) {
    const rad = a * Math.PI / 180;
    sinSum += Math.sin(rad);
    cosSum += Math.cos(rad);
  }
  let mean = Math.atan2(sinSum, cosSum) * 180 / Math.PI;
  return ((mean % 360) + 360) % 360;
}

function kmhToBeaufort(kmh) {
  if (kmh < 1) return 0;
  if (kmh < 6) return 1;
  if (kmh < 12) return 2;
  if (kmh < 20) return 3;
  if (kmh < 29) return 4;
  if (kmh < 39) return 5;
  if (kmh < 50) return 6;
  if (kmh < 62) return 7;
  if (kmh < 75) return 8;
  if (kmh < 89) return 9;
  if (kmh < 103) return 10;
  if (kmh < 118) return 11;
  return 12;
}


// ---------- DATE UTILITIES ----------

const DAY_NAMES = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'];

function getWeekDates() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days = [];
  for (let i = 0; i < 14; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    date.setHours(0, 0, 0, 0);
    days.push({
      date,
      label: DAY_NAMES[date.getDay()]
    });
  }
  return days;
}

function formatDate(date) {
  return date.toLocaleDateString('nl-NL', {
    day: 'numeric',
    month: 'long'
  });
}

function isSameDay(date1, date2) {
  return date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate();
}

function isSpecialDay(date) {
  const dayKey = `${date.getDate()}-${date.getMonth() + 1}`;
  return SPECIAL_DAY_KEYS.has(dayKey);
}

function formatDayLabelHTML(label, date) {
  if (!label || !isSpecialDay(date)) return label;
  const first = label.charAt(0);
  const rest = label.slice(1);
  return `<span class="special-day-initial">${first}</span>${rest}`;
}
// ---------- LOCATION MANAGEMENT ----------

function getSavedLocation() {
  try {
    const saved = localStorage.getItem(CONFIG.STORAGE_KEY_LOCATION);
    if (saved) return JSON.parse(saved);
  } catch (e) { /* ignore */ }
  return null;
}

function saveLocation(lat, lon, name) {
  localStorage.setItem(CONFIG.STORAGE_KEY_LOCATION,
    JSON.stringify({ lat, lon, name }));
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation niet beschikbaar'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        name: 'Huidige locatie'
      }),
      (err) => reject(new Error('Locatie niet beschikbaar')),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  });
}

async function reverseGeocode(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10`;
    const resp = await fetch(url);
    const data = await resp.json();
    return data.address?.city ||
      data.address?.town ||
      data.address?.village ||
      `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
  } catch {
    return `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
  }
}

async function forwardGeocode(query) {
  // Try parsing as coordinates first
  const parts = query.split(',').map(s => parseFloat(s.trim()));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    const name = await reverseGeocode(parts[0], parts[1]);
    return { lat: parts[0], lon: parts[1], name };
  }

  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=nl`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (data.results && data.results.length > 0) {
    const r = data.results[0];
    return { lat: r.latitude, lon: r.longitude, name: r.name };
  }
  throw new Error('Locatie niet gevonden');
}


// ---------- API FETCHING ----------

async function fetchWeatherData(lat, lon) {
  const cacheKey = `${lat.toFixed(2)}_${lon.toFixed(2)}`;
  try {
    const cached = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY_CACHE) || '{}');
    if (cached.key === cacheKey && Date.now() - cached.timestamp < CONFIG.CACHE_MAX_AGE_MS) {
      return cached.data;
    }
  } catch { /* ignore */ }

  const url = `${CONFIG.API_BASE}?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,windspeed_10m,winddirection_10m,precipitation_probability,precipitation,weathercode&timezone=Europe/Amsterdam&forecast_days=16`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API fout: ${response.status}`);
  }
  const data = await response.json();

  try {
    localStorage.setItem(CONFIG.STORAGE_KEY_CACHE, JSON.stringify({
      key: cacheKey,
      timestamp: Date.now(),
      data
    }));
  } catch { /* storage full */ }

  return data;
}


// ---------- DATA PROCESSING ----------

function processWeatherData(apiData) {
  const allDays = getWeekDates();
  const hourlyTimes = apiData.hourly.time.map(t => new Date(t));

  function processDayData(targetDate, label) {
    const dayData = [];

    for (let i = 0; i < hourlyTimes.length; i++) {
      const time = hourlyTimes[i];
      if (!isSameDay(time, targetDate)) continue;

      const hour = time.getHours();
      if (hour < CONFIG.HOUR_START || hour >= CONFIG.HOUR_END) continue;

      const windSpeed = apiData.hourly.windspeed_10m[i];
      const windDir = apiData.hourly.winddirection_10m[i];
      const temp = apiData.hourly.temperature_2m[i];
      const precip = apiData.hourly.precipitation[i];
      const precipProb = apiData.hourly.precipitation_probability[i];
      const weatherCode = apiData.hourly.weathercode[i];

      const windScore = calcWindScore(windSpeed);
      const tempScore = calcTempScore(temp);
      const dirScore = calcDirectionScore(windDir);
      const rainScore = calcRainScore(precip, precipProb);
      const overall = calcOverallScore(windScore, tempScore, dirScore, rainScore, windSpeed);

      dayData.push({
        hour,
        time: `${String(hour).padStart(2, '0')}:00`,
        windSpeed: Math.round(windSpeed * 10) / 10,
        beaufort: kmhToBeaufort(windSpeed),
        windDir,
        windDirCompass: degreesToCompass(windDir),
        temp: Math.round(temp * 10) / 10,
        precip,
        precipProb,
        weatherCode,
        weatherDesc: WEATHER_CODES[weatherCode] || '?',
        scores: { wind: windScore, temp: tempScore, direction: dirScore, rain: rainScore, overall }
      });
    }

    const morning = dayData.filter(d => d.hour < CONFIG.HOUR_MORNING_END);
    const afternoon = dayData.filter(d => d.hour >= CONFIG.HOUR_MORNING_END);

    function aggregateSlot(entries) {
      if (entries.length === 0) return null;
      const avg = (arr) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
      const avgWind = entries.reduce((s, e) => s + e.windSpeed, 0) / entries.length;
      return {
        avgWind: avgWind.toFixed(1),
        beaufort: kmhToBeaufort(avgWind),
        maxWind: Math.max(...entries.map(e => e.windSpeed)).toFixed(1),
        maxBeaufort: Math.max(...entries.map(e => e.beaufort)),
        avgTemp: (entries.reduce((s, e) => s + e.temp, 0) / entries.length).toFixed(1),
        maxPrecipProb: Math.max(...entries.map(e => e.precipProb)),
        dominantDir: degreesToCompass(
          circularMeanDegrees(entries.map(e => e.windDir))
        ),
        score: avg(entries.map(e => e.scores.overall))
      };
    }

    const allScores = dayData.map(d => d.scores.overall);
    const dayScore = allScores.length > 0
      ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
      : 0;

    // Dominante weathercode: neem het "zwaarste" weer van de dag
    const codes = dayData.map(d => d.weatherCode);
    const dominantWeatherCode = codes.length > 0
      ? codes.reduce((worst, c) => c > worst ? c : worst, 0)
      : 0;

    return {
      label,
      date: targetDate,
      dateFormatted: formatDate(targetDate),
      dayScore,
      weatherCode: dominantWeatherCode,
      weatherDesc: WEATHER_CODES[dominantWeatherCode] || 'Onbekend',
      morning: aggregateSlot(morning),
      afternoon: aggregateSlot(afternoon),
      hourly: dayData
    };
  }

  return allDays.map(d => processDayData(d.date, d.label));
}


// ---------- UI RENDERING ----------


function renderForecast(days) {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('error-state').classList.add('hidden');
  document.getElementById('forecast').classList.remove('hidden');

  const container = document.getElementById('day-cards');

  // Groepeer per kalenderweek (ma=start)
  const activeDays = days.filter(d => d.hourly.length > 0);
  const weeks = new Map();
  activeDays.forEach(day => {
    // ISO weeknummer als key
    const d = new Date(day.date);
    const dayOfWeek = d.getDay() || 7; // ma=1..zo=7
    const thursday = new Date(d);
    thursday.setDate(d.getDate() + 4 - dayOfWeek);
    const yearStart = new Date(thursday.getFullYear(), 0, 1);
    const weekNum = Math.ceil((((thursday - yearStart) / 86400000) + 1) / 7);
    const key = `${thursday.getFullYear()}-W${weekNum}`;
    if (!weeks.has(key)) weeks.set(key, []);
    weeks.get(key).push(day);
  });

  let html = '';
  let weekIdx = 0;
  weeks.forEach((weekDays, key) => {
    const label = weekIdx === 0 ? 'Deze week' : weekIdx === 1 ? 'Volgende week' : 'Over 2 weken';
    html += `<h3 class="weekend-heading">${label}</h3>`;
    html += '<div class="cards-row">';
    weekDays.forEach((day, i) => {
      html += buildDayCardHTML(day, `d${weekIdx * 7 + i}`);
    });
    html += '</div>';
    weekIdx++;
  });

  container.innerHTML = html;

  // Attach expand buttons
  container.querySelectorAll('.expand-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.nextElementSibling;
      const isExpanded = target.classList.contains('expanded');
      if (isExpanded) {
        target.classList.remove('expanded');
        btn.textContent = 'Uurlijks detail ▼';
      } else {
        target.classList.add('expanded');
        btn.textContent = 'Uurlijks detail ▲';
      }
    });
  });

  document.getElementById('last-updated').textContent =
    new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

function weatherCodeToClass(code) {
  if (code <= 1) return 'weather-clear';
  if (code === 2) return 'weather-partly';
  if (code === 3) return 'weather-cloudy';
  if (code === 45 || code === 48) return 'weather-fog';
  if ((code >= 51 && code <= 57) || (code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'weather-rain';
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return 'weather-snow';
  if (code >= 95) return 'weather-thunder';
  return 'weather-cloudy';
}

function buildDayCardHTML(dayData, id) {
  const weatherClass = weatherCodeToClass(dayData.weatherCode);
  const dayLabelHtml = formatDayLabelHTML(dayData.label, dayData.date);
  return `
    <div class="day-card">
      <div class="weather-banner ${weatherClass}">
        <div class="weather-banner-overlay">
          <h2 class="day-name">${dayLabelHtml}</h2>
          <div class="day-date">${dayData.dateFormatted}</div>
          <div class="weather-desc">${dayData.weatherDesc}</div>
        </div>
      </div>
      <div class="time-slots">
        ${buildSlotHTML(dayData.morning, 'Ochtend')}
        ${buildSlotHTML(dayData.afternoon, 'Middag')}
      </div>
      <button class="expand-btn">Uurlijks detail ▼</button>
      <div class="hourly-detail">${buildHourlyHTML(dayData.hourly)}</div>
    </div>`;
}

const AIRPLANE_SVG_SMALL = `<svg class="airplane-svg-small" viewBox="0 0 200 200" fill="currentColor">
  <g transform="translate(100,100)">
    <rect x="-10" y="-80" width="20" height="160" rx="10"/>
    <ellipse cx="0" cy="8" rx="90" ry="13"/>
    <ellipse cx="0" cy="-64" rx="35" ry="7"/>
    <rect x="-4" y="-88" width="8" height="28" rx="4"/>
    <ellipse cx="0" cy="84" rx="18" ry="4"/>
  </g>
</svg>`;

function buildSlotHTML(slotData, title) {
  if (!slotData) {
    return `<div class="slot">
      <h3>${title}</h3>
      <div class="slot-airplane"><div style="color:var(--text-secondary)">${AIRPLANE_SVG_SMALL}</div></div>
      <div class="slot-score">--</div>
      <p class="no-data">Geen data</p>
    </div>`;
  }

  const color = scoreToColor(slotData.score);
  const label = scoreToLabel(slotData.score);
  return `
    <div class="slot">
      <h3>${title}</h3>
      <div class="slot-airplane"><div style="color:${color}">${AIRPLANE_SVG_SMALL}</div></div>
      <div class="slot-score-display">
        <span class="slot-score" style="color:${color}">${slotData.score}</span>
        <span class="slot-score-label">/ 100</span>
      </div>
      <div class="slot-text" style="color:${color}">${label}</div>
      <div class="slot-details">
        <div class="detail-row">
          <span class="detail-icon">💨</span>
          <span>Bft ${slotData.beaufort} (max ${slotData.maxBeaufort})</span>
        </div>
        <div class="detail-row">
          <span class="detail-icon">🌡️</span>
          <span>${slotData.avgTemp}°C</span>
        </div>
        <div class="detail-row">
          <span class="detail-icon">🧭</span>
          <span>${slotData.dominantDir}</span>
        </div>
        <div class="detail-row">
          <span class="detail-icon">🌧️</span>
          <span>${slotData.maxPrecipProb}% kans</span>
        </div>
      </div>
    </div>`;
}

function buildHourlyHTML(hourlyData) {
  if (hourlyData.length === 0) {
    return '<p class="no-data">Geen uurlijkse data beschikbaar</p>';
  }

  let html = `
    <div class="hourly-header">
      <span>Uur</span>
      <span>Wind</span>
      <span>Temp</span>
      <span>Kans</span>
      <span>Weer</span>
    </div>`;

  html += hourlyData.map(h => `
    <div class="hourly-row">
      <span class="hour">${h.time}</span>
      <span>Bft ${h.beaufort} ${h.windDirCompass}</span>
      <span>${h.temp}°C</span>
      <span>${h.precipProb}%</span>
      <span>${h.weatherDesc}</span>
    </div>`).join('');

  return html;
}

function showError(message) {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('forecast').classList.add('hidden');
  document.getElementById('error-state').classList.remove('hidden');
  document.getElementById('error-message').textContent = message;
}

function showLoading() {
  document.getElementById('loading').classList.remove('hidden');
  document.getElementById('forecast').classList.add('hidden');
  document.getElementById('error-state').classList.add('hidden');
}


// ---------- EVENT HANDLERS ----------

function setupEventListeners() {
  // Location button
  document.getElementById('location-btn').addEventListener('click', () => {
    document.getElementById('location-modal').classList.remove('hidden');
  });

  // Close modal
  document.getElementById('close-modal-btn').addEventListener('click', () => {
    document.getElementById('location-modal').classList.add('hidden');
  });

  // Backdrop click closes modal
  document.getElementById('location-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      e.currentTarget.classList.add('hidden');
    }
  });

  // GPS button
  document.getElementById('use-gps-btn').addEventListener('click', async () => {
    const btn = document.getElementById('use-gps-btn');
    btn.disabled = true;
    btn.textContent = 'Locatie ophalen...';
    try {
      const loc = await getCurrentPosition();
      const name = await reverseGeocode(loc.lat, loc.lon);
      saveLocation(loc.lat, loc.lon, name);
      document.getElementById('location-modal').classList.add('hidden');
      loadWeather();
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right: 6px;">
          <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
          <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
          <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
        </svg>
        Gebruik GPS-locatie`;
    }
  });

  // Save manual location
  document.getElementById('save-location-btn').addEventListener('click', async () => {
    const input = document.getElementById('location-input').value.trim();
    if (!input) return;
    const btn = document.getElementById('save-location-btn');
    btn.disabled = true;
    btn.textContent = 'Zoeken...';
    try {
      const loc = await forwardGeocode(input);
      saveLocation(loc.lat, loc.lon, loc.name);
      document.getElementById('location-modal').classList.add('hidden');
      document.getElementById('location-input').value = '';
      loadWeather();
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Opslaan';
    }
  });

  // Enter key in location input
  document.getElementById('location-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('save-location-btn').click();
    }
  });

  // Retry button
  document.getElementById('retry-btn').addEventListener('click', loadWeather);

  // Pull-to-refresh
  let touchStartY = 0;
  let isPulling = false;
  const pullIndicator = document.getElementById('pull-indicator');

  document.addEventListener('touchstart', (e) => {
    if (window.scrollY === 0) {
      touchStartY = e.touches[0].clientY;
      isPulling = true;
    }
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!isPulling) return;
    const diff = e.touches[0].clientY - touchStartY;
    if (diff > 80 && window.scrollY === 0) {
      pullIndicator.classList.add('visible');
    }
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    if (!isPulling) return;
    isPulling = false;
    const diff = e.changedTouches[0].clientY - touchStartY;
    pullIndicator.classList.remove('visible');
    if (diff > 80 && window.scrollY === 0) {
      loadWeather();
    }
  }, { passive: true });
}


// ---------- MAIN LOAD FUNCTION ----------

async function loadWeather() {
  showLoading();

  try {
    let location = getSavedLocation();

    if (!location) {
      location = {
        lat: CONFIG.DEFAULT_LAT,
        lon: CONFIG.DEFAULT_LON,
        name: CONFIG.DEFAULT_NAME
      };
    }

    document.getElementById('location-name').textContent = location.name;

    const apiData = await fetchWeatherData(location.lat, location.lon);
    const days = processWeatherData(apiData);
    renderForecast(days);

  } catch (err) {
    console.error('Weather load error:', err);
    showError(`Kan weerdata niet laden: ${err.message}`);
  }
}


// ---------- SERVICE WORKER & BOOT ----------

async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      console.log('Service Worker geregistreerd:', reg.scope);
    } catch (err) {
      console.warn('Service Worker registratie mislukt:', err);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  setupEventListeners();
  loadWeather();
});
