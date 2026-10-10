// Pure labels and formatting shared by results and map rendering.
export const fmtM = m => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m / 10) * 10} m`);
export const walkMinOf = m => Math.max(1, Math.round((m * 1.3) / 75));

export const colorOf = route => route.color || '#3b82f6';
export function routeName(route){
  const name = route.name || '';
  if (route.group === 'corredor') return route.corridorName || 'Corredor';
  if (route.group === 'metropolitano') return `Metropolitano · ${name || route.code}`;
  if (route.group === 'alimentador') return `Alimentador ${route.code}${route.headsign ? ` · hacia ${route.headsign}` : ''}`;
  if (route.group === 'metro') return `Metro de Lima · ${name.replace(/^Línea\s+L/i, 'Línea ') || route.code}`;
  if (name && name !== route.code) return titleCase(name);
  const meta = route.metadata;
  return titleCase([meta?.empresa_operadora, meta?.alias].filter(Boolean).join(' · ')) || (route.group === 'antigua' ? 'Ruta antigua' : '');
}

// "HOLDING REAL EXPRESS" → "Holding Real Express" (siglas cortas y "La 6" quedan igual)
const SMALL = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'en']);
function titleCase(s){
  if (!s || s !== s.toUpperCase() || !/[A-ZÁÉÍÓÚÑ]{4}/.test(s)) return s;
  return s.toLowerCase().replace(/[a-záéíóúñü]+/g, (w, i) =>
    (i > 0 && SMALL.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1));
}

export function cardName(route){
  let name = routeName(route);
  if (!route.alias) return name;
  // El nombre del chip puede ir al inicio ("EVIFASA B · Virgen de Fátima") o
  // después de la empresa ("Santa Luzmila · La C"): se quita donde esté
  const parts = name.split(/\s*·\s*/).filter(p => p && p.toLowerCase() !== route.alias.toLowerCase()
    && !p.toLowerCase().startsWith(`${route.alias.toLowerCase()} -`));
  return [...parts, `ruta ${route.code}`].join(' · ');
}

