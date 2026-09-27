// metSchedule.js
// Horarios del Metropolitano (metropolitano_services.json → schedule):
//   schedule: { ns: [{ days: 'LMXJV', from: '05:00', to: '09:00' }, ...], sn: [...] }
// ns = norte→sur, sn = sur→norte. days usa L M X J V S D. Si "to" es menor que
// "from" el servicio cruza la medianoche: empieza el día indicado y sigue al
// siguiente (Lechucero: viernes 23:30 → sábado 04:00).
// Un sentido sin horario no existe.

const DAY_LETTERS = 'DLMXJVS';               // índice = Date#getDay()
const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export { DAY_NAMES };

const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
};

// Día (0 = domingo) y minuto del día en Lima para una fecha
export function limaTime(date = new Date()){
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Lima', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const get = (t) => parts.find(p => p.type === t)?.value;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day, min: Number(get('hour')) * 60 + Number(get('minute')) };
}

const hasDay = (w, day) => String(w.days || '').includes(DAY_LETTERS[day]);

// ¿Circula a esa hora? when = { day, min }
export function runsAt(windows, when){
  if (!Array.isArray(windows) || !when) return false;
  const prev = (when.day + 6) % 7;
  return windows.some(w => {
    const a = toMin(w.from), b = toMin(w.to);
    if (a <= b) return hasDay(w, when.day) && when.min >= a && when.min < b;
    // Cruza la medianoche
    return (hasDay(w, when.day) && when.min >= a) || (hasDay(w, prev) && when.min < b);
  });
}

// 'LMXJVS' → 'L–S'; 'LMXJV' → 'L–V'; 'VS' → 'Vie y Sáb'; 'D' → 'Dom'
const WEEK = 'LMXJVSD';
const SHORT = { L: 'Lun', M: 'Mar', X: 'Mié', J: 'Jue', V: 'Vie', S: 'Sáb', D: 'Dom' };
function daysText(days){
  const idx = [...new Set(String(days))].map(c => WEEK.indexOf(c)).filter(i => i >= 0).sort((a, b) => a - b);
  const run = idx.every((v, k) => k === 0 || v === idx[k - 1] + 1);
  if (run && idx.length > 2) return `${WEEK[idx[0]]}–${WEEK[idx[idx.length - 1]]}`;
  return idx.map(i => SHORT[WEEK[i]]).join(' y ');
}

const hourText = (hhmm) => String(hhmm).replace(/^0(\d)/, '$1');

// "L–V 5:00–9:00 · Sáb 6:00–9:00"
export function scheduleText(windows){
  if (!Array.isArray(windows) || !windows.length) return '';
  return windows.map(w => `${daysText(w.days)} ${hourText(w.from)}–${hourText(w.to)}`).join(' · ');
}

// Sentidos que existen: ['ns'], ['sn'] o ['ns', 'sn']
export function directionsOf(svc){
  return ['ns', 'sn'].filter(k => {
    const list = k === 'ns' ? svc.north_south : svc.south_north;
    return Array.isArray(list) ? list.length > 1 : Array.isArray(svc.stops) && svc.stops.length > 1;
  });
}
