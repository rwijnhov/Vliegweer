diff --git a/app.js b/app.js
index 8123646284af04dbd48354cf385b6f48401c3c9d..711286e7f959df10177b0474edab1840159708c7 100644
--- a/app.js
+++ b/app.js
@@ -38,50 +38,56 @@ const SCORE_LABELS = {
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
 
+const SPECIAL_DAY_KEYS = new Set([
+  '22-3', '4-4', '18-4', '26-4', '9-5', '17-5', '22-5', '23-5', '24-5',
+  '20-6', '27-6', '18-7', '25-7', '2-8', '15-8', '22-8', '29-8', '6-9',
+  '12-9', '26-9', '4-10', '17-10', '25-10', '1-11'
+]);
+
 
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
@@ -194,50 +200,62 @@ function getWeekDates() {
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
 
+function isSpecialDay(date) {
+  const dayKey = `${date.getDate()}-${date.getMonth() + 1}`;
+  return SPECIAL_DAY_KEYS.has(dayKey);
+}
+
+function formatDayLabelHTML(label, date) {
+  if (!label || !isSpecialDay(date)) return label;
+  const first = label.charAt(0);
+  const rest = label.slice(1);
+  return `<span class="special-day-initial">${first}</span>${rest}`;
+}
+
 
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
@@ -458,55 +476,56 @@ function renderForecast(days) {
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
+  const dayLabelHtml = formatDayLabelHTML(dayData.label, dayData.date);
   return `
     <div class="day-card">
       <div class="weather-banner ${weatherClass}">
         <div class="weather-banner-overlay">
-          <h2 class="day-name">${dayData.label}</h2>
+          <h2 class="day-name">${dayLabelHtml}</h2>
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
