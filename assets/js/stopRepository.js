// Shared stop data; no search or inspector dependencies.
const norm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

let stopsIndexPromise = null;

// Se carga recién al buscar algo que pueda ser un paradero
export function loadStopsIndex(){
  if (stopsIndexPromise) return stopsIndexPromise;
  stopsIndexPromise = fetch('pipeline/output/wr_stops_index.json')
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(({ routes, stops }) => stops.map(([name, lat, lon, idx, district, neighbor, cross, swap, alias]) => ({
      name,
      // Cómo se muestra al buscar: con su cruce ("Universitaria con Colonial",
      // wr_stops_cruces.py); en el mapa y en los pasos sigue siendo el nombre.
      // swap: el mismo cruce empezando por la otra calle ("Colonial con
      // Universitaria"), para quien busca esa; alias: otros nombres ("Trébol
      // de Javier Prado", "Óscar R. Benavides", "Km 22")
      label: cross || name,
      swap: swap || null,
      alias: alias || '',
      key: keyOf(name),
      labelKey: keyOf(cross || name),
      swapKey: swap ? keyOf(swap) : '',
      aliasKeys: alias ? alias.split(' · ').map(keyOf) : [],
      lat,
      lon,
      folderIds: idx.map(i => routes[i]),
      district: district || '',
      neighbor: neighbor || ''
    })))
    .catch(err => {
      console.warn('[stops] Sin índice de paraderos:', err.message);
      return [];
    });
  return stopsIndexPromise;
}

export const keyOf = t => norm(t).replace(/[^a-z0-9]+/g, ' ').trim();
export async function stopsNear(lat, lon, m = 40){
  const stops = await loadStopsIndex();
  const k = Math.cos(lat * Math.PI / 180);
  return stops
    .map(st => [st, Math.hypot((st.lat - lat) * 110_574, (st.lon - lon) * 111_320 * k)])
    .filter(([, d]) => d <= m)
    .sort((a, b) => a[1] - b[1])
    .map(([st]) => st);
}

