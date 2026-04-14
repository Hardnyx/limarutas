from __future__ import annotations

import argparse
import csv
import json
import re
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


# ==========================
# Modelos y utilidades base
# ==========================

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


def write_csv(path: Path, rows: List[Dict[str, str]], fieldnames: List[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow(r)


# ==========================
# Detección de ROOT
# ==========================

def find_repo_root(start: Path) -> Optional[Path]:
    """
    Prefiere el nivel donde exista config/lista_rutas.csv.
    Si no lo encuentra, busca config + data/processed/transporte y se queda
    con el nivel más alto que cumpla eso.
    """
    start = start.resolve()
    candidates = [start] + list(start.parents)

    # 1) Prioridad: donde exista lista_rutas.csv
    for p in candidates:
        if (p / "pipeline" / "input" / "lista_rutas.csv").exists():
            return p

    # 2) Si no hay, buscar combinación config + data/processed/transporte
    for p in reversed(candidates):
        cfg = p / "config"
        data_root = p / "data" / "processed" / "transporte"
        if cfg.exists() and data_root.exists():
            return p

    return None


# ==========================
# Carga de lista_rutas.csv
# ==========================

def load_lista_rutas(csv_path: Path) -> Dict[str, ListaRutaRow]:
    out: Dict[str, ListaRutaRow] = {}
    if not csv_path.exists():
        return out

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


def build_index_by_codigo_antiguo(lista: Dict[str, ListaRutaRow]) -> Dict[str, ListaRutaRow]:
    idx: Dict[str, ListaRutaRow] = {}
    for lr in lista.values():
        ca = (lr.codigo_antiguo or "").strip()
        if ca:
            idx[ca] = lr
    return idx


# ==========================
# Extracción de display_id y endpoints
# ==========================

# Códigos tipo EM40, IO01, SM36a, etc.
ALNUM_CODE_RE = re.compile(r"\b([A-Za-z]{1,6}\d{1,6}[A-Za-z]?)\b")
DIGITS_RE = re.compile(r"\b(\d{1,6})\b")


def _normalize_code(code: str) -> str:
    code = (code or "").strip()
    m = re.match(r"^([A-Za-z]+)(\d+)([A-Za-z]?)$", code)
    if m:
        prefix = m.group(1).upper()
        num = m.group(2)
        suffix = m.group(3).lower()
        return f"{prefix}{num}{suffix}"
    return code


def extract_display_id_from_title(route_title: str) -> Optional[str]:
    """
    Intenta sacar un código compacto a partir del título Wikiroutes.
      - "Ruta de autobús 1244 en el mapa de Lima" -> "1244"
      - "Ruta de autobús EM40 en el mapa de Lima" -> "EM40"
      - "Ruta de autobús 018p en el mapa de Lima" -> "018p"
    Si no encuentra nada razonable, devuelve None.
    """
    t = " ".join((route_title or "").split())
    if not t:
        return None

    # 1) Preferir alfanumérico tipo EM40, SM36a, etc.
    m1 = ALNUM_CODE_RE.search(t)
    if m1:
        return _normalize_code(m1.group(1))

    # 2) Si no hay alfanumérico, buscar números
    nums = DIGITS_RE.findall(t)
    if not nums:
        return None

    # Preferir números de 3+ dígitos
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
    """
    Intenta leer del HTML los extremos de los trips (ida / vuelta).
    Si no puede, devuelve dict vacío.
    """
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


# ==========================
# Ámbito desde el título: (X - Y) o Lima
# ==========================

AMBITO_RE = re.compile(r"\(([^()]*?\s-\s[^()]*?)\)")


def extract_ambito_from_title(title: str) -> str:
    t = title or ""
    m = AMBITO_RE.search(t)
    if m:
        return m.group(1).strip()
    return "Lima"


# ==========================
# Clasificación por categoría
# ==========================

# Patrones para "Transporte Formal sin Codigo Nuevo"
# Aplicados sobre display_id_raw (normalizado en mayúsculas)
CODIGO_FORMAL_SN_PATTERNS = [
    r"^CR\d{2}$",
    r"^DA\d{2}$",
    r"^ICR\d{2}$",
    r"^IM\d{2}$",
    r"^IO\d{2}$",
    r"^IPC\d{2}$",
    r"^OCR\d{2}$",
    r"^OM\d{2}$",
    r"^SP\d{2}$",

    r"^\d{3}P$",       # xxxP (001P, 018P, etc.)
    r"^C-\d{4}$",      # C-0000
    r"^C\d{4}$",       # C0000

    r"^CCH\d{2}$",
    r"^CH\d{2}$",

    r"^IH\d{2}$",
    r"^NH\d{2}$",
    r"^PCH\d{2}$",
    r"^PNH\d{2}$",
    r"^PSH\d{2}$",
    r"^R\d{2}$",
    r"^RA\d{2}$",
    r"^SH\d{2}$",
    r"^TCH\d{2}$",
    r"^TH\d{2}$",
    r"^TLU\d{2}$",
    r"^TMA\d{2}$",
    r"^TRI\d{2}$",
    r"^TSE\d{2}$",
    r"^TVE\d{2}$",
]

# Patrones que preferimos detectar en el título
TITLE_FORMAL_SN_PATTERNS = [
    r"\b\d{3}-96\b",      # xxx-96
    r"\bRTU-M-\d{2}\b",   # RTU-M-xx
]


def clasificar_categoria(
    display_id_raw: str,
    cand_match_type: str,
    cand_codigo_nuevo: str,
    title: str,
) -> str:
    """
    Devuelve una de:
      - "Corredores"
      - "Transporte Formalizado por la ATU"
      - "Transporte Formal sin Codigo Nuevo"
      - "Otros"
    según las reglas.
    """
    code = (display_id_raw or "").strip()
    code_upper = code.upper()
    title_upper = (title or "").upper()

    # Corredores: código de 3 dígitos
    if code.isdigit() and len(code) == 3:
        return "Corredores"

    # Transporte Formalizado por la ATU:
    # 4 números que están en lista_rutas como codigo_nuevo
    if cand_match_type == "codigo_nuevo":
        cn = (cand_codigo_nuevo or "").strip()
        if cn.isdigit() and len(cn) == 4:
            return "Transporte Formalizado por la ATU"

    # Transporte Formal sin Código Nuevo:
    # - 4 dígitos pero NO en lista_rutas como codigo_nuevo
    # - o tiene alguno de los formatos especificados
    is_four_digit = code.isdigit() and len(code) == 4

    matches_formal_sn_code = any(
        re.match(pat, code_upper) for pat in CODIGO_FORMAL_SN_PATTERNS
    )
    matches_formal_sn_title = any(
        re.search(pat, title_upper) for pat in TITLE_FORMAL_SN_PATTERNS
    )

    if is_four_digit or matches_formal_sn_code or matches_formal_sn_title:
        return "Transporte Formal sin Codigo Nuevo"

    # Resto
    return "Otros"


# ==========================
# CLI
# ==========================

def parse_args():
    p = argparse.ArgumentParser(
        description="Construye una tabla maestra wr_codes_master.csv con el mapeo Wikiroutes ↔ candidatos lista_rutas."
    )
    p.add_argument(
        "--root",
        type=str,
        default="",
        help="Ruta a la carpeta base del proyecto (Rutas). Si se omite, se intenta detectar automáticamente.",
    )
    p.add_argument(
        "--output",
        type=str,
        default="pipeline/output/wr_codes_master.csv",
        help="Ruta de salida relativa al ROOT para el CSV maestro.",
    )
    return p.parse_args()


# ==========================
# Main
# ==========================

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
    OUT_CSV = ROOT / args.output

    print(f"ROOT: {ROOT}")
    print(f"OUT_ROOT: {OUT_ROOT}  exists={OUT_ROOT.exists()}")
    print(f"LISTA_RUTAS_CSV: {LISTA_RUTAS_CSV}  exists={LISTA_RUTAS_CSV.exists()}")
    print(f"OUT_CSV: {OUT_CSV}")

    if not OUT_ROOT.exists():
        raise SystemExit("ERROR: data/processed/transporte no existe bajo ROOT.")

    lista = load_lista_rutas(LISTA_RUTAS_CSV)
    idx_antiguo = build_index_by_codigo_antiguo(lista)

    folders = sorted([p for p in OUT_ROOT.glob("route_*") if p.is_dir()])
    print(f"Carpetas route_* detectadas: {len(folders)}")

    rows: List[Dict[str, str]] = []

    # Estadísticas simples
    total = 0
    matched_nuevo = 0
    matched_antiguo = 0
    no_match = 0

    for folder in folders:
        total += 1
        route_json_path = folder / "route.json"
        route_html_path = folder / "route.html"

        if not route_json_path.exists():
            route_id = ""
            title = ""
        else:
            rj = read_json(route_json_path)
            route_id = str((rj.get("route_id") or "")).strip()
            title = str((rj.get("title") or "")).strip()

        display_id_raw = extract_display_id_from_title(title)
        display_id_source = "title" if display_id_raw else "route_id_fallback"

        if not display_id_raw:
            display_id_raw = route_id or folder.name

        endpoints = extract_trip_endpoints_from_html(route_html_path)
        end1_start, end1_end = ("", "")
        end2_start, end2_end = ("", "")

        if 1 in endpoints:
            end1_start, end1_end = endpoints[1]
        if 2 in endpoints:
            end2_start, end2_end = endpoints[2]

        # Candidatos desde lista_rutas
        cand_match_type = ""
        cand_codigo_nuevo = ""
        cand_codigo_antiguo = ""
        cand_alias = ""
        cand_color_hex = ""
        cand_empresa = ""
        cand_origen = ""
        cand_destino = ""

        lr: Optional[ListaRutaRow] = lista.get(display_id_raw)

        if lr is not None:
            matched_nuevo += 1
            cand_match_type = "codigo_nuevo"
        else:
            # Intentar por codigo_antiguo si display_id_raw es numérico
            if display_id_raw.isdigit():
                lr = idx_antiguo.get(display_id_raw)
                if lr is not None:
                    matched_antiguo += 1
                    cand_match_type = "codigo_antiguo"

        if lr is None:
            no_match += 1
        else:
            cand_codigo_nuevo = lr.codigo_nuevo
            cand_codigo_antiguo = lr.codigo_antiguo
            cand_alias = lr.alias
            cand_color_hex = lr.color_hex
            cand_empresa = lr.empresa_operadora
            cand_origen = lr.distrito_origen
            cand_destino = lr.distrito_destino

        # Categoría automática
        categoria = clasificar_categoria(
            display_id_raw=display_id_raw,
            cand_match_type=cand_match_type,
            cand_codigo_nuevo=cand_codigo_nuevo,
            title=title,
        )

        # Ámbito desde el título
        ambito_title = extract_ambito_from_title(title)

        folder_rel = folder.resolve().relative_to(ROOT).as_posix()

        row = {
            # Identificación básica
            "folder": folder.name,
            "folder_rel": folder_rel,
            "route_id": route_id,
            "title": title,

            # Lo que el script cree que es el código Wikiroutes
            "display_id_raw": display_id_raw,
            "display_id_source": display_id_source,

            # Contexto de extremos de ruta
            "end1_start": end1_start,
            "end1_end": end1_end,
            "end2_start": end2_start,
            "end2_end": end2_end,

            # Candidatos desde lista_rutas.csv
            "cand_match_type": cand_match_type,
            "cand_codigo_nuevo": cand_codigo_nuevo,
            "cand_codigo_antiguo": cand_codigo_antiguo,
            "cand_alias": cand_alias,
            "cand_color_hex": cand_color_hex,
            "cand_empresa_operadora": cand_empresa,
            "cand_distrito_origen": cand_origen,
            "cand_distrito_destino": cand_destino,

            # Clasificación automática
            "categoria": categoria,

            # Ámbito basado en el título ((X - Y) o Lima)
            "ambito_title": ambito_title,

            # Campos manuales inicializados por defecto
            # Por defecto: usamos el código traído (display_id_raw) y activamos la ruta
            "codigo_final": display_id_raw,
            "usar_en_mapa": "TRUE",
            "es_codigo_nuevo": "",
            "comentario": "",
        }

        rows.append(row)

    seen_por_nuevo = {
        r["cand_codigo_nuevo"]
        for r in rows
        if r["cand_match_type"] == "codigo_nuevo" and r["cand_codigo_nuevo"]
    }
    rows_dedup = [
        r for r in rows
        if not (
            r["cand_match_type"] == "codigo_antiguo"
            and r["cand_codigo_nuevo"] in seen_por_nuevo
        )
    ]
    duplicados_eliminados = len(rows) - len(rows_dedup)
    rows = rows_dedup

    fieldnames = list(rows[0].keys()) if rows else []
    write_csv(OUT_CSV, rows, fieldnames)

    print("")
    print("Resumen generación wr_codes_master.csv")
    print(f"  total rutas: {total}")
    print(f"  match por codigo_nuevo:   {matched_nuevo}")
    print(f"  match por codigo_antiguo: {matched_antiguo}")
    print(f"  sin match lista_rutas:    {no_match}")
    print(f"  duplicados eliminados:    {duplicados_eliminados}")
    print(f"CSV escrito en: {OUT_CSV}")

if __name__ == "__main__":
    main()
