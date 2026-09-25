// wrTexts.js
// Textos de los ítems de Wikiroutes: título (empresa · alias), extremos y
// limpieza de nombres. Funciones puras, sin DOM ni estado.

/* =========================
   Texto: título, empresa, extremos
   ========================= */

export function wrIsPlaceholder(text){
  if (!text) return false;
  const n = String(text).trim().toLowerCase();
  return (
    n === 'ninguno' ||
    n === 'ninguna' ||
    n === 'desconocido' ||
    n === 'desconocida' ||
    n === '?' ||
    n === '¿?' ||
    n === '-' ||
    n === 'sin nombre'
  );
}

export function wrBuildEmpresaDisplay(empresaRaw){
  if (!empresaRaw) return '';
  let s = empresaRaw.trim();
  if (s.length <= 30) return s;

  const prefixes = [
    'Empresa de Transportes y Servicios',
    'Empresa de Transportes',
    'Empresa de Transporte'
  ];
  for (const pref of prefixes){
    const needle = pref + ' ';
    if (s.startsWith(needle)){
      s = s.slice(needle.length);
      break;
    }
  }

  const suffixes = [' S.A.C.', ' S.A.'];
  for (const suf of suffixes){
    if (s.endsWith(suf)){
      s = s.slice(0, s.length - suf.length);
      break;
    }
  }

  return s.trim();
}

export function wrBuildTituloPrincipal(meta, rt){
  const rawAlias = meta && meta.alias ? String(meta.alias).trim() : '';
  const alias = rawAlias && !wrIsPlaceholder(rawAlias) ? rawAlias : '';

  const rawEmpresa = meta && meta.empresa_operadora
    ? String(meta.empresa_operadora).trim()
    : '';
  const empresa = rawEmpresa && !wrIsPlaceholder(rawEmpresa) ? rawEmpresa : '';

  // Si hay empresa y alias: "Empresa · Alias"
  if (empresa && alias){
    const combined = `${empresa} · ${alias}`;
    if (combined.length <= 35) return combined;
    if (rt && rt.id){
      const m = String(rt.id).match(/[-_](\d+)$/);
      if (m) return `${empresa} · Ruta ${m[1]}`;
    }
    return empresa;
  };

  // Si solo alias
  if (alias) return alias;

  // Si solo empresa
  if (empresa) return wrBuildEmpresaDisplay(empresa);

  if (rt && rt.label) return rt.label;
  if (rt && rt.id != null) return String(rt.id).toUpperCase();
  return '';
}

export function wrParseBaseStops(source){
  if (!source) return { from:'', to:'', label:'' };

  if (typeof source === 'string'){
    const raw = source.trim();
    if (!raw) return { from:'', to:'', label:'' };

    let s = raw;
    s = s.replace(/^\s*[^\s·]+\s*·\s*/,'');
    s = s.replace(/\s*\((ida|vuelta)\)\s*$/i,'');

    let parts = s.split('→');
    if (parts.length === 2){
      const from = parts[0].trim();
      const to   = parts[1].trim();
      return { from, to, label:`${from} \u2192 ${to}` };
    }

    parts = s.split(/\s*-\s*/);
    if (parts.length === 2){
      const from = parts[0].trim();
      const to   = parts[1].trim();
      return { from, to, label:`${from} \u2192 ${to}` };
    }

    return { from:'', to:'', label:s.trim() };
  }

  const props = source;

  const directFrom =
    props.from ||
    props.from_short ||
    props.fromShort ||
    props.origen ||
    props.origin ||
    null;

  const directTo =
    props.to ||
    props.to_short ||
    props.toShort ||
    props.destino ||
    props.destination ||
    null;

  if (directFrom || directTo){
    const from = String(directFrom || '').trim();
    const to   = String(directTo   || '').trim();
    const label = (from || to) ? `${from} \u2192 ${to}` : '';
    return { from, to, label };
  }

  if (Array.isArray(props.stops) && props.stops.length){
    const first = props.stops[0];
    const last  = props.stops[props.stops.length - 1];
    const getName = st => (st && (st.name || st.title || st.label || '')) || '';
    const from = String(getName(first)).trim();
    const to   = String(getName(last)).trim();
    const label = (from || to) ? `${from} \u2192 ${to}` : '';
    return { from, to, label };
  }

  let rawName = '';
  if (props.name != null) rawName = String(props.name);
  else if (props.title != null) rawName = String(props.title);

  if (!rawName.trim()) return { from:'', to:'', label:'' };

  let s = rawName;
  s = s.replace(/^\s*[^\s·]+\s*·\s*/,'');
  s = s.replace(/\s*\((ida|vuelta)\)\s*$/i,'');

  let parts = s.split('→');
  if (parts.length === 2){
    const from = parts[0].trim();
    const to   = parts[1].trim();
    return { from, to, label:`${from} \u2192 ${to}` };
  }

  parts = s.split(/\s*-\s*/);
  if (parts.length === 2){
    const from = parts[0].trim();
    const to   = parts[1].trim();
    return { from, to, label:`${from} \u2192 ${to}` };
  }

  return { from:'', to:'', label:s.trim() };
}

export function wrStopsFromExtremesForRoute(routeLike, extremes, dirKey){
  if (!routeLike || !extremes) return null;

  const candidates = [];

  if (typeof routeLike === 'string' || typeof routeLike === 'number'){
    candidates.push(routeLike);
  } else {
    const r = routeLike;
    if (r.wr_id    != null) candidates.push(r.wr_id);
    if (r.wrId     != null) candidates.push(r.wrId);
    if (r.route_id != null) candidates.push(r.route_id);
    if (r.routeId  != null) candidates.push(r.routeId);
    if (r.base_id  != null) candidates.push(r.base_id);
    if (r.id       != null) candidates.push(r.id);
  }

  for (const c of candidates){
    const key = String(c);
    const ext = extremes[key];
    if (ext && ext[dirKey]){
      const from = ext[dirKey].from ? String(ext[dirKey].from).trim() : '';
      const to   = ext[dirKey].to   ? String(ext[dirKey].to).trim()   : '';
      const label = (from || to) ? `${from} \u2192 ${to}` : '';
      return { from, to, label };
    }
  }

  return null;
}
