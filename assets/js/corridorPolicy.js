// Corridor classification and colors, independent of UI.
const CORR_COLORS = {
  '1': '#c89919', // Amarillo (suavizado)
  '2': '#e4002b', // Rojo
  '3': '#003594', // Azul
  '4': '#9b26b6', // Morado
  '5': '#8e8c13'  // Verde
};

const CORR_DIGIT_TO_KEY = {
  '1': 'amarillo',
  '2': 'rojo',
  '3': 'azul',
  '4': 'morado',
  '5': 'verde'
};

export const CORR_KEY_LABEL = {
  amarillo: 'Corredor Amarillo',
  rojo: 'Corredor Rojo',
  azul: 'Corredor Azul',
  morado: 'Corredor Morado',
  verde: 'Corredor Verde',
  otros: 'Otros'
};

const CORR_KEY_COLOR = {
  amarillo: '#c89919',
  rojo: '#e4002b',
  azul: '#003594',
  morado: '#9b26b6',
  verde: '#8e8c13'
};

export const CORR_GROUP_ORDER = ['amarillo','rojo','azul','morado','verde','otros'];


export function corrCanonical(value){
  const s = String(value || '').trim();
  if (!s) return '';
  if (/^\d+$/.test(s)) return String(Number(s));
  return s.toUpperCase();
}

export function corrServiceCodeOf(svc){
  return String((svc && (svc.corrServicio || svc.id)) || '').trim();
}

export function createCorridorPolicy(catalog){
function corrGetCatalogCfg(){
  const cat = catalog || {};
  return cat.corredores || cat.corr || null;
}

function corrBasesFor(codeRaw){
  let base = corrCanonical(codeRaw);
  base = base.replace(/-(IDA|VUELTA)$/i,'');
  const out = new Set();
  if (base) out.add(base);
  const m = base.match(/^(.+)_\d+$/);
  if (m && m[1]) out.add(m[1]);
  return Array.from(out);
}

function corrGetColorOverrides(){
  const cfg = corrGetCatalogCfg() || {};
  const raw = cfg.color_overrides || cfg.colorOverrides || {};
  const map = {};
  for (const [k, v] of Object.entries(raw || {})){
    const kk = String(k || '').toUpperCase().trim();
    if (!kk) continue;
    map[kk] = v;
  }
  return map;
}

function corrOverrideToGroupKey(v){
  if (!v) return null;

  if (typeof v === 'object'){
    const g = v.group || v.grupo || v.key || null;
    const gg = g ? String(g).trim().toLowerCase() : '';
    return CORR_KEY_COLOR[gg] ? gg : null;
  }

  if (typeof v === 'string'){
    const s = v.trim().toLowerCase();
    if (CORR_KEY_COLOR[s]) return s;

    if (s.startsWith('#')){
      for (const [k, hex] of Object.entries(CORR_KEY_COLOR)){
        if (hex.toLowerCase() === s) return k;
      }
    }
  }

  return null;
}

function corrOverrideToColor(v){
  if (!v) return null;

  if (typeof v === 'object'){
    const c = v.color || v.hex || null;
    if (c && typeof c === 'string' && c.trim().startsWith('#')) return c.trim();
    const g = corrOverrideToGroupKey(v);
    return g ? CORR_KEY_COLOR[g] : null;
  }

  if (typeof v === 'string'){
    const s = v.trim();
    if (s.startsWith('#')) return s;
    const g = corrOverrideToGroupKey(s);
    return g ? CORR_KEY_COLOR[g] : null;
  }

  return null;
}

function corrSpecialGroupKey(codeUpper){
  const raw = String(codeUpper || '').trim().toUpperCase();
  if (!raw) return null;

  const compact = raw.replace(/[\s_-]+/g, '');

  if (compact === 'COLEBUS') return 'azul';
  if (/^SE0?2$/.test(compact)) return 'morado';
  if (/^SP0?1$/.test(compact)) return 'morado';

  return null;
}

function corrGroupKeyForCode(code){
  const s = String(code || '').trim().toUpperCase();
  if (!s) return 'otros';

  const ov = corrGetColorOverrides();
  const v = ov[s];
  const gOv = corrOverrideToGroupKey(v);
  if (gOv) return gOv;

  const gSp = corrSpecialGroupKey(s);
  if (gSp) return gSp;

  const first = s[0];
  return CORR_DIGIT_TO_KEY[first] || 'otros';
}

function corrColorForCode(code){
  const s = String(code || '').trim().toUpperCase();
  if (!s) return null;

  const ov = corrGetColorOverrides();
  const v = ov[s];
  const cOv = corrOverrideToColor(v);
  if (cOv) return cOv;

  const gSp = corrSpecialGroupKey(s);
  if (gSp) return CORR_KEY_COLOR[gSp] || null;

  const first = s[0];
  return CORR_COLORS[first] || null;
}

function corrFilterServicesByCatalog(services){
  const cfg = corrGetCatalogCfg();
  if (!cfg) return services || [];

  const upper = x => String(x).toUpperCase().trim();
  const onlySet = Array.isArray(cfg.only)
    ? new Set(cfg.only.map(corrCanonical).map(upper))
    : null;

  const excSet = Array.isArray(cfg.exclude)
    ? new Set(cfg.exclude.map(corrCanonical).map(upper))
    : new Set();

  return (services || []).filter(svc => {
    const code = corrServiceCodeOf(svc);
    const bases = corrBasesFor(code).map(upper);
    if (!bases.length) return false;

    if (bases.some(b => excSet.has(b))) return false;
    if (onlySet) return bases.some(b => onlySet.has(b));
    return true;
  });
}

return { groupKey: corrGroupKeyForCode, color: corrColorForCode, filter: corrFilterServicesByCatalog };
}
