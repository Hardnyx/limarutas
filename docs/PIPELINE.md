# Pipeline de datos

La adquisición de fuentes y la construcción de archivos derivados son pasos
distintos. El sitio consume archivos versionados; abrirlo y validar esos
archivos no requiere descargar datos ni instalar Selenium o pyosmium.

## Validar el checkout

Desde la raíz, con Python 3.10 o posterior:

```bash
python3 -m unittest discover -s pipeline/tests
python3 pipeline/run.py validate
python3 pipeline/run.py validate --manifest pipeline-inventory.json
```

La validación comprueba versión del grafo, coordenadas finitas, referencias
de paraderos y distritos, longitud de segmentos, intervalos positivos,
existencia de capas y carpetas, orden de paraderos sobre los trazados,
banderas de aproximación, columnas del CSV y cuadrículas peatonales.
También informa cuántos paraderos de alimentadores son aproximados y cuántas
aristas peatonales existentes quedaron con longitud cero al cuantizarse.
Esas cantidades describen los datos; no certifican su exactitud en la calle.

El inventario identifica archivos mediante SHA-256 y tamaños. Describe el
checkout validado, **no una fecha de adquisición de las fuentes**. CI lo guarda
como artefacto y no modifica datos. El despliegue mantiene su dependencia de
las pruebas, ahora ampliadas a dominio y contratos de datos.

## Construir derivados

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r pipeline/requirements.txt
python3 pipeline/run.py list
python3 pipeline/run.py build --stage trips --with-dependencies --dry-run
.venv/bin/python pipeline/run.py build --stage trips
```

`build` ejecuta únicamente la etapa solicitada con sus entradas actuales.
`--with-dependencies` incluye sus predecesoras en orden y evita duplicarlas.
`--dry-run` muestra comandos y fuentes faltantes sin escribir datos. El runner
comprueba las entradas declaradas antes de ejecutar la primera etapa.
Una construcción termina validando el conjunto que consume el sitio.

| Etapa | Predecesoras | Resultado principal |
|---|---|---|
| `stops` | — | `wr_stops_index.json` |
| `crossings` | `stops` | Cruces y alias del índice |
| `met-paths` | — | `metropolitano_paths.json` |
| `feeders` | `crossings`, `met-paths` | `alimentadores_paths.json` |
| `tracks` | `stops` | Trazados por calles y reporte de revisión |
| `walk` | — | Cuadrículas de `data/processed/caminata` |
| `trips` | `crossings`, `met-paths`, `feeders` | `trip_graph.json` |

`stops` conserva el comportamiento del script original: construye el índice.
La preparación inicial con `wr_build_stops_index.py --write-stops`, que
reescribe GeoJSON, requiere las listas HTML originales y debe hacerse aparte;
no se repite automáticamente sobre archivos ya emparejados. Para el fallback
HTML histórico, el clon debe tener el commit `1c1e782e^`, además del checkout
actual; un clon superficial puede necesitar `git fetch --unshallow`.

## Fuentes y límites de reproducción

| Fuente | Entradas conservadas o requeridas | Preparación |
|---|---|---|
| Wikiroutes | `wr_map.json`, carpetas de transporte, listas HTML o historial git | Scripts `wikiroutes/wr_scrape.py`, `wr_sync_indexes.py` y `wr_build_*` |
| OpenStreetMap | `data/raw/osm/Lima.osm.pbf`, export `transporte.zip`, datos de Metropolitano y Metro | `osm/descargar_lima.py`; el PBF está excluido de git |
| ATU / PRR | Anexo y fichas PDF, `prr_fichas.json`, catálogos y equivalencias | `atu/build_prr_fichas.py`; las fichas externas no están versionadas |
| ATU / mapas QR | `config/alim_trazados.json`, `alim_paraderos.json` | `metropolitano/build_alim_paths.py`; conserva `aprox` cuando interpola |
| Fotos | `config/route_photos.json`, referencias de Wikimedia Commons | `photos/commons_photos.py --check` |

Las dependencias directas están fijadas en `pipeline/requirements.txt`; el
navegador y la validación estática no las importan. Una reconstrucción completa
necesita recuperar las fuentes externas de la tabla. El refactor no actualiza
esas fuentes ni atribuye a los datos existentes una fecha de descarga nueva.
