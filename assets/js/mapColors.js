// mapColors.js
// Colores de corredores (por código o nombre del servicio) y ajuste del
// trazo cuando Leaflet dibuja en SVG.

/* ===========================
   Colores Corredores
   =========================== */

const CORR_COLORS = {
  '1': '#c89919', // Amarillo (#ffcd00 suavizado, ver softenColor)
  '2': '#e4002b', // Rojo
  '3': '#003594', // Azul
  '4': '#9b26b6', // Morado
  '5': '#8e8c13'  // Verde
};

export const CORR_FALLBACK = '#9ca3af';

function normStr(v){
  return String(v ?? '').trim().toUpperCase();
}

function pickFirstNonEmpty(obj, keys){
  for (const k of keys){
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return null;
}

function digitFromCorrCode(sUpper){
  const s = normStr(sUpper);
  if (!s) return null;

  // 101, 204, 371...
  const m3 = s.match(/^([1-5])\d{2}\b/);
  if (m3) return m3[1];

  // "SE-02", "SP-01", "SE 02"
  if (/^(SE|SP)\b/.test(s)) return '4';

  // "COLE BUS", "COLEBUS", "COLE ..."
  if (/^COLE\b/.test(s) || /^COLEBUS\b/.test(s) || /^COLE\s*BUS\b/.test(s)) return '3';

  return null;
}

function digitFromKeywords(sUpper){
  const s = normStr(sUpper);
  if (!s) return null;

  if (s.includes('AMARILLO')) return '1';
  if (s.includes('ROJO')) return '2';
  if (s.includes('AZUL')) return '3';
  if (s.includes('MORADO')) return '4';
  if (s.includes('VERDE')) return '5';

  return null;
}

function corrColorForId(anyId){
  const s = normStr(anyId);
  const d = digitFromCorrCode(s) || digitFromKeywords(s);
  if (d && CORR_COLORS[d]) return CORR_COLORS[d];
  return CORR_FALLBACK;
}

export function corrColorForSvc(svc){
  // Prioridad: code/ref/id, luego name/label, luego keywords
  const idLike = pickFirstNonEmpty(svc, ['id', 'code', 'ref', 'codigo', 'route', 'ruta', 'service', 'service_id']);
  const nameLike = pickFirstNonEmpty(svc, ['name', 'label', 'nombre', 'title', 'descripcion', 'description']);

  const d1 = digitFromCorrCode(idLike);
  if (d1 && CORR_COLORS[d1]) return CORR_COLORS[d1];

  // Si el id viene embebido en el nombre: "301 Principal", "Ruta 204", etc.
  const d2 = digitFromCorrCode(nameLike);
  if (d2 && CORR_COLORS[d2]) return CORR_COLORS[d2];

  const d3 = digitFromKeywords(idLike) || digitFromKeywords(nameLike);
  if (d3 && CORR_COLORS[d3]) return CORR_COLORS[d3];

  // Como último recurso, si svc.color existe y es un hex válido y no es gris, úsalo
  const c = String(svc?.color ?? '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(c) && c.toLowerCase() !== CORR_FALLBACK) return c;

  return CORR_FALLBACK;
}

// Fuerza stroke cuando Leaflet está en SVG y algún CSS lo pisa
export function forceStroke(layer, color){
  try {
    const p = layer && layer._path;
    if (!p) return;

    p.setAttribute('stroke', color);

    // inline style normal
    p.style.stroke = color;

    // inline style con prioridad
    if (p.style && p.style.setProperty) {
      p.style.setProperty('stroke', color, 'important');
      p.style.setProperty('stroke-opacity', '0.95', 'important');
      p.style.setProperty('fill', 'none', 'important');
    }
  } catch {}
}

export function isCorrLikeWrId(id){
  const base = String(id).replace(/-(ida|vuelta)$/i, '');
  const s = normStr(base);

  // 3 dígitos 1xx..5xx
  if (/^[1-5]\d{2}$/.test(s)) return true;

  // SE/SP
  if (/^(SE|SP)[-_ ]?\d{2}$/.test(s)) return true;

  // COLE BUS
  if (/^COLE\b/.test(s) || /^COLEBUS\b/.test(s) || /^COLE\s*BUS\b/.test(s)) return true;

  return false;
}

export function corrColorForWrId(id){
  const base = String(id).replace(/-(ida|vuelta)$/i, '');
  return corrColorForId(base);
}

/* ===========================
   Colores de ruta legibles
   =========================== */

// Brillo percibido (0–1) de un color #rrggbb
export function luminance(hex){
  const m = String(hex || '').match(/^#?([0-9a-f]{6})$/i);
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

// ¿Texto oscuro sobre este color?
export const isLightColor = hex => luminance(hex) > 0.55;

const MAX_LUM = 0.6;    // más brillante que esto (amarillo o verde fosforescente) no se lee en el mapa claro

function hexToHsl(hex){
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h, s, l){
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return '#' + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join('');
}

// Colores de Wikiroutes muy chillones (amarillo, verde o cyan fosforescentes):
// los amarillos pasan a dorado y todos se oscurecen hasta un brillo legible.
// El resto no cambia.
export function softenColor(hex){
  if (!/^#[0-9a-f]{6}$/i.test(String(hex || ''))) return hex;
  if (luminance(hex) <= MAX_LUM) return hex;
  let [h, s, l] = hexToHsl(hex);
  s = Math.min(s, 0.78);
  if (h >= 48 && h <= 75) h = 44;
  let out = hslToHex(h, s, l);
  for (let i = 0; i < 20 && luminance(out) > MAX_LUM; i++){
    l -= 0.02;
    out = hslToHex(h, s, l);
  }
  return out;
}
