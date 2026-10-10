// Catalog filtering shared by data and UI.
export function wrCanonicalCode(value){
  const s = String(value || '').trim();
  if (!s) return '';
  const n = Number(s);
  if (!Number.isNaN(n)) return String(n);
  return s.toUpperCase();
}

export function wrRouteBases(idRaw){
  let base = String(idRaw || '').toUpperCase().trim();
  const mTrip = base.match(/^(.*?)-(IDA|VUELTA)$/i);
  if (mTrip) base = mTrip[1];

  const out = new Set();
  if (base) out.add(base);

  // extrae la parte numérica final: "1_52587" → "52587"
  const mSuffix = base.match(/^\d+_(\d+)$/);
  if (mSuffix) out.add(mSuffix[1]);

  const m = base.match(/^(.+)_\d+$/);
  if (m && m[1]) out.add(m[1]);

  if (/^\d+$/.test(base)) out.add(String(Number(base)));

  return Array.from(out);
}

// ¿Ruta antigua revisada que sigue circulando? (catalog.semiformal.verificadas)
export function wrIsVerifiedOld(id, catalog){
  const list = catalog?.semiformal?.verificadas;
  if (!Array.isArray(list) || !list.length) return false;
  const set = new Set(list.map(c => String(c).toUpperCase().trim()));
  return wrRouteBases(id).some(b => set.has(b));
}

export function wrFilterRoutesByGroup(groupName, routes, catalog = {}){
  const upper = s => String(s).toUpperCase().trim();

  let cfg = null;
  if (groupName === 'transporte'){
    cfg = catalog.transporte || null;
  } else if (groupName === 'aerodirecto'){
    cfg = catalog.aerodirecto || null;
  } else if (groupName === 'expreso_san_isidro'){
    cfg = (catalog.otros && catalog.otros.expreso_san_isidro) || null;
  } else if (groupName === 'semiformal'){
    cfg = catalog.semiformal || null;
  } else {
    return routes || [];
  }

  if (!cfg) return routes || [];

  // mode "all": sin filtro. mode "atu": igual que "only" hasta migración del CSV.
  if (cfg.mode === 'all') return routes || [];

  const only = Array.isArray(cfg.only) ? new Set(cfg.only.map(upper)) : null;
  const exc  = Array.isArray(cfg.exclude) ? new Set(cfg.exclude.map(upper)) : new Set();

  return (routes || []).filter(rt => {
    const bases = wrRouteBases(rt && rt.id != null ? rt.id : '');
    if (!bases.length) return false;

    if (bases.some(b => exc.has(b))) return false;
    if (only) return bases.some(b => only.has(b));
    return true;
  });
}

