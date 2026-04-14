from __future__ import annotations

import argparse
import csv
import json
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional, Tuple, List

try:
    from bs4 import BeautifulSoup
except ImportError as e:
    raise SystemExit(
        "Falta dependencia: beautifulsoup4\n"
        "Instala con: pip install beautifulsoup4"
    ) from e


HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")

# Captura códigos tipo EM40, IM42, EO01, etc.
ALNUM_CODE_RE = re.compile(r"\b([A-Za-z]{1,6}\d{1,6}[A-Za-z]{0,3})\b")

# Captura números "sueltos" (por si el title viene como "Ruta 1244 ...")
DIGITS_RE = re.compile(r"\b(\d{1,6}[A-Za-z]{0,2})\b")


@dataclass
class ListaRutaRow:
    codigo_antiguo: str
    codigo_nuevo: str
    distrito_origen: str
    distrito_destino: str
    empresa_operadora: str
    alias: str
    color_hex: str


def read_json(path: Path) -> Dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def safe_hex(value: str) -> Optional[str]:
    v = (value or "").strip()
    return v if HEX_RE.match(v) else None


def load_lista_rutas(csv_path: Path) -> Dict[str, ListaRutaRow]:
    if not csv_path.exists():
        return {}

    out: Dict[str, ListaRutaRow] = {}
    with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for r in reader:
            codigo_nuevo = (r.get("codigo_nuevo") or "").strip()
            if not codigo_nuevo:
                continue

            out[codigo_nuevo] = ListaRutaRow(
                codigo_antiguo=(r.get("codigo_antiguo") or "").strip(),
                codigo_nuevo=codigo_nuevo,
                distrito_origen=(r.get("distrito_origen") or "").strip(),
                distrito_destino=(r.get("distrito_destino") or "").strip(),
                empresa_operadora=(r.get("empresa_operadora") or "").strip(),
                alias=(r.get("alias") or "").strip(),
                color_hex=(r.get("color_hex") or "").strip(),
            )
    return out


def _normalize_code(code: str) -> str:
    code = (code or "").strip()
    m = re.match(r"^([A-Za-z]+)(\d+)([A-Za-z]*)$", code)
    if m:
        return f"{m.group(1).upper()}{m.group(2)}{m.group(3)}"
    return code


def extract_display_id(route_title: str) -> Optional[str]:
    """
    Prioridad:
    1) Alfanumérico (EM40, EO01, IM42)
    2) Numérico suelto (1244, 1001, etc.)
       Preferimos 3+ dígitos para evitar ruido, pero si no hay, tomamos el primero.
    """
    t = " ".join((route_title or "").split())
    if not t:
        return None

    m1 = ALNUM_CODE_RE.search(t)
    if m1:
        return _normalize_code(m1.group(1))

    nums = DIGITS_RE.findall(t)
    if not nums:
        return None

    # Preferir 3+ dígitos si existen
    for x in nums:
        if len(x) >= 3:
            return x

    return nums[0]


def simplify_stop_name(name: str) -> str:
    s = " ".join((name or "").split())
    if " - " in s:
        s = s.split(" - ", 1)[0].strip()
    return s


def extract_trip_endpoints_from_html(route_html_path: Path) -> Dict[int, Tuple[str, str]]:
    if not route_html_path.exists():
        return {}

    html = route_html_path.read_text(encoding="utf-8", errors="replace")
    soup = BeautifulSoup(html, "html.parser")

    endpoints: Dict[int, Tuple[str, str]] = {}
    trip_divs = soup.find_all(attrs={"trip-seq": True})

    for d in trip_divs:
        seq_raw = (d.get("trip-seq") or "").strip()
        if not seq_raw.isdigit():
            continue

        seq = int(seq_raw)
        text = " ".join(d.get_text(" ", strip=True).split())
        if "→" not in text:
            continue

        left, right = text.split("→", 1)
        start = simplify_stop_name(left.strip())
        end = simplify_stop_name(right.strip())

        if start and end:
            endpoints[seq] = (start, end)

    return endpoints


def detect_trips(folder: Path) -> List[int]:
    trips = []
    if (folder / "route_track_trip1.geojson").exists():
        trips.append(1)
    if (folder / "route_track_trip2.geojson").exists():
        trips.append(2)
    return trips


def stable_route_key_sort(k: str) -> Tuple[str, int, int, str]:
    """
    Orden estable:
    - prefijo letras ('' primero, luego alfabético)
    - número (si existe)
    - ida antes que vuelta
    """
    m = re.match(r"^([A-Za-z]*)(\d+)-(ida|vuelta)$", k)
    if m:
        pref = (m.group(1) or "").upper()
        num = int(m.group(2))
        side = 0 if m.group(3) == "ida" else 1
        return (pref, num, side, k)

    # Fallback estable
    return ("ZZZZ", 10**9, 9, k)


def find_repo_root(start: Path) -> Optional[Path]:
    start = start.resolve()
    candidates = [start] + list(start.parents)

    # 1) Preferir siempre la carpeta que tenga config/lista_rutas.csv
    #    Esto en tu caso es justo ...\Rutas\config\lista_rutas.csv
    for p in candidates:
        if (p / "pipeline" / "input" / "lista_rutas.csv").exists():
            return p

    # 2) Si por algún motivo no existe lista_rutas.csv,
    #    usar la combinación config + data/processed/transporte,
    #    pero prefiriendo el nivel MÁS ALTO (el root real).
    for p in reversed(candidates):
        cfg = p / "config"
        data_root = p / "data" / "processed" / "transporte"
        if cfg.exists() and data_root.exists():
            return p

    return None


def parse_args():
    p = argparse.ArgumentParser(description="Sincroniza wr_map.json y wr_overrides.json desde rutas descargadas.")
    p.add_argument("--root", type=str, default="", help="Ruta a la carpeta base del proyecto (Rutas).")
    p.add_argument("--mode", choices=["overwrite", "merge"], default="overwrite",
                   help="Si es merge, mantiene entries existentes en wr_map/wr_overrides.")
    p.add_argument("--verbose", action="store_true")
    p.add_argument("--max-ok", type=int, default=80)
    p.add_argument("--max-skip", type=int, default=120)

    p.add_argument("--print-no-display", action="store_true",
                   help="Imprime el array completo no_display_id_dump (muy largo).")
    p.add_argument("--dump-no-display", type=str, default="config/no_display_id_skips.json",
                   help="Ruta (relativa al ROOT) para guardar el JSON con los casos sin display_id extraíble del title.")
    p.add_argument("--sample-no-display", type=int, default=10,
                   help="Cantidad de ejemplos a imprimir de no_display_id_dump (por defecto 10).")

    # Casos donde display_id no matchea lista_rutas.csv
    p.add_argument("--dump-unmatched-lista", type=str, default="pipeline/output/unmatched_routes.json",
                   help="Ruta (relativa al ROOT) para guardar JSON con display_id que no está en lista_rutas.csv.")
    p.add_argument("--sample-unmatched-lista", type=int, default=10,
                   help="Cantidad de ejemplos a imprimir de unmatched_lista_dump (por defecto 10).")

    return p.parse_args()


def _print_sample(label: str, arr: List[Dict], n: int) -> None:
    n = max(0, n)
    print("")
    print(f"Muestra {label}: {min(n, len(arr))} de {len(arr)}")
    for i, it in enumerate(arr[:n], start=1):
        print(f"[{i}] folder={it.get('folder')} route_id={it.get('route_id')} "
              f"display_id={it.get('display_id')} trips={it.get('trips_detected')}")
        print(f"    title={it.get('title')}")
        nums = it.get("title_numbers_all") or []
        if nums:
            lens = [len(x) for x in nums]
            print(f"    title_numbers_all={nums}  lens={lens}")
        eps = it.get("endpoints_from_html") or {}
        if eps:
            print(f"    endpoints_from_html={eps}")


def main() -> None:
    args = parse_args()

    if args.root.strip():
        ROOT = Path(args.root).expanduser().resolve()
    else:
        detected = find_repo_root(Path.cwd())
        if detected is None:
            detected = find_repo_root(Path(__file__).resolve().parent)
        ROOT = (detected or Path.cwd()).resolve()

    OUT_ROOT = ROOT / "data" / "processed" / "transporte"
    LISTA_RUTAS_CSV = ROOT / "pipeline" / "input" / "lista_rutas.csv"
    WR_MAP_JSON = ROOT / "pipeline" / "output" / "wr_map.json"
    WR_OVERRIDES_JSON = ROOT / "config" / "wr_overrides.json"

    print(f"CWD: {Path.cwd().resolve()}")
    print(f"ROOT: {ROOT}")
    print(f"OUT_ROOT: {OUT_ROOT}  exists={OUT_ROOT.exists()}")
    print(f"LISTA_RUTAS_CSV: {LISTA_RUTAS_CSV}  exists={LISTA_RUTAS_CSV.exists()}")
    print(f"WR_MAP_JSON: {WR_MAP_JSON}")
    print(f"WR_OVERRIDES_JSON: {WR_OVERRIDES_JSON}")

    lista = load_lista_rutas(LISTA_RUTAS_CSV)

    # Índice auxiliar por código antiguo, para mapear por ejemplo 1217 -> 1005
    lista_by_codigo_antiguo: Dict[str, ListaRutaRow] = {}
    for lr in lista.values():
        ca = (lr.codigo_antiguo or "").strip()
        if ca:
            lista_by_codigo_antiguo[ca] = lr

    wr_map: Dict = {"routes": {}}
    wr_overrides: Dict = {}

    # Cargar overrides existentes siempre para respetar ediciones manuales
    existing_overrides: Dict = {}
    if WR_OVERRIDES_JSON.exists():
        try:
            existing_overrides = read_json(WR_OVERRIDES_JSON)
            if not isinstance(existing_overrides, dict):
                existing_overrides = {}
        except Exception:
            existing_overrides = {}

    if args.mode == "merge":
        if WR_MAP_JSON.exists():
            wr_map = read_json(WR_MAP_JSON)
            if "routes" not in wr_map or not isinstance(wr_map["routes"], dict):
                wr_map = {"routes": {}}
        if WR_OVERRIDES_JSON.exists():
            wr_overrides = read_json(WR_OVERRIDES_JSON)
            if not isinstance(wr_overrides, dict):
                wr_overrides = {}

    routes_out: Dict[str, Dict] = dict(wr_map.get("routes", {}))
    overrides_out: Dict[str, Dict] = dict(wr_overrides)

    folders = sorted([p for p in OUT_ROOT.glob("route_*") if p.is_dir()])
    print(f"Folders route_* detectados: {len(folders)}")

    stats = Counter()
    ok_list = []
    skip_list = []

    # Casos donde no se pudo sacar display_id del title (se usará fallback route_id)
    no_display_id_dump: List[Dict] = []

    # Casos donde display_id existe pero no está en lista_rutas.csv
    unmatched_lista_dump: List[Dict] = []

    for folder in folders:
        stats["folders_total"] += 1

        route_json_path = folder / "route.json"
        route_html_path = folder / "route.html"

        if not route_json_path.exists():
            stats["skip_missing_route_json"] += 1
            if len(skip_list) < args.max_skip:
                skip_list.append((folder.name, "missing route.json", ""))
            continue

        rj = read_json(route_json_path)
        route_id = str((rj.get("route_id") or "")).strip()
        title = str((rj.get("title") or "")).strip()

        trips = detect_trips(folder)
        if not trips:
            stats["skip_no_trip_files"] += 1
            if len(skip_list) < args.max_skip:
                skip_list.append((folder.name, "no route_track_trip*.geojson", ""))
            continue

        endpoints = extract_trip_endpoints_from_html(route_html_path)

        display_id = extract_display_id(title)
        display_id_source = "title"

        # Respetar override manual si existe para esta carpeta o route_id
        _ovr = existing_overrides.get(folder.name) or (existing_overrides.get(route_id) if route_id else None)
        lookup_id = display_id or route_id
        if _ovr and _ovr.get("display_id"):
            display_id = _ovr["display_id"]
            display_id_source = "override"

        if not display_id:
            # Fallback: nunca descartamos por esto. Usamos route_id para que "exista" en wr_map.
            display_id = route_id or folder.name
            display_id_source = "route_id_fallback"
            stats["fallback_display_id_used"] += 1

            no_display_id_dump.append({
                "folder": folder.name,
                "folder_rel": folder.resolve().relative_to(ROOT).as_posix(),
                "route_id": route_id,
                "display_id": display_id,
                "display_id_source": display_id_source,
                "title": title,
                "title_numbers_all": re.findall(r"\d+", title),
                "trips_detected": trips,
                "has_route_html": route_html_path.exists(),
                "endpoints_from_html": {str(k): {"start": v[0], "end": v[1]} for k, v in endpoints.items()},
            })

        # Primero intentamos matchear display_id como codigo_nuevo
        lr = lista.get(lookup_id) or lista.get(display_id)

        # Si no hay match directo por codigo_nuevo, probar como codigo_antiguo (solo numérico)
        if lr is None:
            normalized = (lookup_id or "").strip()
            if normalized.isdigit():
                lr_alt = lista_by_codigo_antiguo.get(normalized)
                if lr_alt is not None:
                    if lr_alt.codigo_nuevo and lr_alt.codigo_nuevo != display_id:
                        stats["display_id_from_codigo_antiguo"] += 1
                        display_id = lr_alt.codigo_nuevo
                        display_id_source = f"{display_id_source}+from_codigo_antiguo"
                    lr = lr_alt

        if lr is None:
            stats["unmatched_lista_rutas"] += 1
            unmatched_lista_dump.append({
                "folder": folder.name,
                "folder_rel": folder.resolve().relative_to(ROOT).as_posix(),
                "route_id": route_id,
                "display_id": display_id,
                "display_id_source": display_id_source,
                "title": title,
                "title_numbers_all": re.findall(r"\d+", title),
                "trips_detected": trips,
                "endpoints_from_html": {str(k): {"start": v[0], "end": v[1]} for k, v in endpoints.items()},
            })

        color = safe_hex(lr.color_hex) if lr else None
        if not color:
            color = "#888888"

        def fallback_name_pair() -> Tuple[str, str]:
            if lr and lr.distrito_origen and lr.distrito_destino:
                return (lr.distrito_origen, lr.distrito_destino)
            return ("Origen", "Destino")

        folder_rel = folder.resolve().relative_to(ROOT).as_posix()

        # Colisión de keys (por si se repite display_id): añadimos sufijo route_id
        def _route_key(base: str, side: str) -> str:
            k = f"{base}-{side}"
            if k in routes_out and routes_out[k].get("folder") != folder_rel:
                return f"{base}_{route_id}-{side}" if route_id else f"{base}_{folder.name}-{side}"
            return k

        if 1 in trips:
            start1, end1 = endpoints.get(1, fallback_name_pair())
            name1 = f"{display_id} · {start1} → {end1}"
            key1 = _route_key(display_id, "ida")
            routes_out[key1] = {"folder": folder_rel, "trip": 1, "color": color, "name": name1}

        if 2 in trips:
            if 2 in endpoints:
                start2, end2 = endpoints[2]
            elif 1 in endpoints:
                s1, e1 = endpoints[1]
                start2, end2 = e1, s1
            else:
                s1, e1 = fallback_name_pair()
                start2, end2 = e1, s1

            name2 = f"{display_id} · {start2} → {end2}"
            key2 = _route_key(display_id, "vuelta")
            routes_out[key2] = {"folder": folder_rel, "trip": 2, "color": color, "name": name2}

        base_name = None
        # Intentar usar el name de ida, aunque exista colisión, buscamos cualquier key que termine en -ida
        for k in (f"{display_id}-ida", f"{display_id}_{route_id}-ida" if route_id else ""):
            if k and k in routes_out:
                base_name = routes_out[k].get("name")
                break
        if not base_name:
            base_name = f"{display_id} · Ruta"

        overrides_out[folder.name] = {"display_id": display_id, "color": color, "name": base_name}
        if route_id:
            overrides_out[route_id] = {"display_id": display_id, "color": color}

        stats["ok_folders"] += 1
        if len(ok_list) < args.max_ok:
            ok_list.append((folder.name, route_id, display_id, trips, title[:140]))

    ordered_keys = sorted(routes_out.keys(), key=stable_route_key_sort)
    wr_map_final = {"routes": {k: routes_out[k] for k in ordered_keys}}

    write_json(WR_MAP_JSON, wr_map_final)
    write_json(WR_OVERRIDES_JSON, overrides_out)

    print("")
    print("Resumen:")
    for k in [
        "folders_total",
        "ok_folders",
        "skip_missing_route_json",
        "skip_no_trip_files",
        "fallback_display_id_used",
        "display_id_from_codigo_antiguo",
        "unmatched_lista_rutas",
    ]:
        print(f"  {k}: {stats.get(k, 0)}")

    print("")
    print(f"OK. Rutas en wr_map.json: {len(wr_map_final['routes'])}")
    print(f"OK. Entradas en wr_overrides.json: {len(overrides_out)}")

    dump_no_display = (ROOT / args.dump_no_display).resolve()
    dump_no_display.parent.mkdir(parents=True, exist_ok=True)
    dump_no_display.write_text(json.dumps(no_display_id_dump, ensure_ascii=False, indent=2), encoding="utf-8")

    dump_unmatched = (ROOT / args.dump_unmatched_lista).resolve()
    dump_unmatched.parent.mkdir(parents=True, exist_ok=True)
    dump_unmatched.write_text(json.dumps(unmatched_lista_dump, ensure_ascii=False, indent=2), encoding="utf-8")

    _print_sample("fallback_display_id (title sin código)", no_display_id_dump, args.sample_no_display)
    _print_sample("unmatched_lista_rutas (código no está en lista_rutas.csv)", unmatched_lista_dump, args.sample_unmatched_lista)

    if args.print_no_display:
        print("")
        print("Array completo no_display_id_dump:")
        print(json.dumps(no_display_id_dump, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
