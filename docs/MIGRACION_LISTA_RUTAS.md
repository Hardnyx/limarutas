# Migración de lista_rutas.csv a lista_rutas_maestro.csv

## Estado actual

El pipeline usa `pipeline/input/lista_rutas.csv` (230 rutas, scraping anterior de
Wikipedia). El nuevo maestro es `pipeline/output/lista_rutas_maestro.csv`
(460 rutas, fusión de Wikipedia + PDFs oficiales ATU).

## Qué cambia

| Campo            | lista_rutas.csv         | lista_rutas_maestro.csv          |
|------------------|-------------------------|----------------------------------|
| Cobertura        | ~230 rutas              | 460 rutas (1001-1492)            |
| empresa_operadora| Nombre largo sin limpiar| Nombre normalizado               |
| empresa_abrev    | No existe               | Abreviatura extraída             |
| fuente           | No existe               | `wikipedia` o `atu_pdf`         |
| color_hex        | Colores reales          | Reales (Wikipedia) o placeholder |

## Colores placeholder

Las 211 rutas del fallback ATU no tienen color oficial. Se les asigna un tono
del banco `COLORES_PLACEHOLDER` en `build_lista_rutas_atu.py` usando
`int(codigo_nuevo) % 10`. Son 10 tonos steel-blue/slate muted, visualmente
homogéneos (lectura de "sin marca") pero distinguibles entre sí.

Cuando una empresa actualice su color oficial en Wikipedia o en el PRR,
basta con correr `scrap_wikipedia_rutas.py` + `build_lista_rutas_atu.py`
y el color del CSV se actualiza automáticamente.

## Pasos para activar la migración

1. **Verificar pipeline:** correr celdas 2-4 de `run_pipeline.ipynb` y confirmar
   que el `wr_map.json` resultante es idéntico al actual.

2. **Actualizar scripts:** los siguientes scripts leen `lista_rutas.csv` y deben
   adaptarse a las nuevas columnas (`empresa_abrev`, `fuente`):
   - `pipeline/scripts/wikiroutes/build_wr_codes_master.py`
   - `pipeline/scripts/wikiroutes/sync_wr_indexes.py`
   - `pipeline/scripts/wikiroutes/wr_build_catalog.py`

3. **Reemplazar el CSV:**
   ```bash
   cp pipeline/output/lista_rutas_maestro.csv pipeline/input/lista_rutas.csv
   ```

4. **Actualizar catalog.json** para soportar `mode: "all" / "atu" / "only"`
   y el bloque `semiformal` de transporte no regularizado.

5. **Actualizar frontend** (`parsers.js`, `uiSidebar.wr.js`) para leer
   el nuevo esquema del catalog.

## Fuentes

- `lista_rutas_nuevas.csv`: scraping de Wikipedia (1001-1269, con alias, empresa, color)
- `lista_rutas_antiguas.csv`: scraping de Wikipedia (códigos antiguos 1101+)
- `lista_rutas_maestro.csv`: fusión Wikipedia + PDFs ATU + tabla PRR oficial
- Tabla de empresas: `docs/paraderos_ATU/PRR_099-2025_equivalencias.pdf`
  (sección 14, Resolución 099-2025-ATU/PE)
