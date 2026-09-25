// utils.js
export const $  = sel => document.querySelector(sel);
export const $$ = sel => Array.from(document.querySelectorAll(sel));

export const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v]) => {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else n.setAttribute(k,v);
  });
  children.forEach(c => n.append(c));
  return n;
};

export async function fetchJSON(path){
  const r = await fetch(path);
  if (!r.ok) throw new Error(`HTTP ${r.status} - ${path}`);
  return r.json();
}

export const asLatLng = (pt) =>
  Array.isArray(pt) ? [pt[1], pt[0]] : [pt.lat, pt.lon];

export function stopsArrayToMap(stations){
  const m = new Map();
  (stations||[]).forEach(s => m.set(s.id, s));
  return m;
}

export function uniqueOrder(arr){
  const out = [];
  let last = null;
  for (const a of arr){
    if (!a) continue;
    if (!last || (a[0] !== last[0] || a[1] !== last[1])){
      out.push(a);
      last = a;
    }
  }
  return out;
}

// Divide una línea CSV respetando campos entre comillas ("a,b" y "" escapado)
export function splitCsvLine(line){
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++){
    const c = line[i];
    if (inQuotes){
      if (c === '"'){
        if (line[i + 1] === '"'){ cur += '"'; i++; }
        else inQuotes = false;
      } else {
        cur += c;
      }
    } else if (c === '"'){
      inQuotes = true;
    } else if (c === ','){
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

// Filas de un CSV como objetos {columna: valor}; ignora líneas vacías y
// comentarios (#)
export function parseCsvRows(text){
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'));
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const cols = splitCsvLine(line);
    const row = {};
    header.forEach((h, i) => { row[h] = (cols[i] || '').trim(); });
    return row;
  });
}
