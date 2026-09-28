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
- `lista_rutas_maestro.csv`: fusión Wikipedia + fichas del PRR + tabla PRR oficial
  (`build_lista_rutas_atu.py`). El código antiguo es siempre el de la sección 14.
- `prr_fichas.json` (`pipeline/scripts/atu/build_prr_fichas.py`): las 465 rutas
  del PRR con código antiguo y empresa (sección 14 del anexo,
  `docs/3_099-2025-ATU_PE_ANEXO.pdf`) y lo que trae cada ficha técnica
  (sección 13): distritos, itinerario de ida y de vuelta, km, flota,
  intervalo, carrocería, puntos inicial y final.
- Fichas técnicas: carpeta de SharePoint de la ATU enlazada en la sección 13
  (https://atugobpe.sharepoint.com/:f:/s/DocumentosExternosSSTR/Ejh3kATKnVZKsuQE_ZPsm-ABFQaOF-Yiy7O7Blslk2kb7w?e=eb8yj4,
  «Actualización del Plan Regulador de Rutas»). No se versiona (36 MB): se
  descarga a `docs/paraderos_ATU/Plan actualizador de rutas/`. Archivos mal
  nombrados por la ATU: RUTA_IM55_128 (1288), RUTA_IO57B_IM44 (1304) y
  RUTA_2305_1188, que dice «RUTA 1188» pero la sección 14 le da el 1469.

## Combis (camionetas rurales)

Las rutas que el mapa muestra como vigentes (`catalog.transporte.only`) son
exactamente las 465 del PRR, y todas sus fichas exigen microbús (M2) o más:
236 minibús (M2-M3), 136 ómnibus (M3), 90 microbús (M2), 1 minibús (M2) y
2 eléctricas. Ninguna admite camioneta rural. Las rutas fuera del PRR (combis
incluidas) quedan en «Rutas antiguas», ocultas por defecto y fuera de «Cómo
llegar» salvo que se pidan.

Eso garantiza lo que la ATU autorizó, no el vehículo que circula hoy: la RD
N.° D-000029-2024-ATU/DO prorrogó en bloque todos los títulos habilitantes
(combis y cústers incluidas) y el PRR se implementa por etapas. En 2023 la
ATU nombró seis empresas cuya flota era solo de combis; sus rutas pasaron al
PRR con la misma empresa, pero con ficha de microbús o minibús:

| Código antiguo | PRR | Empresa | Carrocería en la ficha |
|---|---|---|---|
| CR62 | 1153 (desierta en 2025) | San Ignacio de Loyola | Minibús (M2-M3) |
| CR43 | 1145 | Transportes y Servicios Callao | Minibús (M2-M3) |
| CR17 | 1138 | Chim Pum Callao | Minibús (M2-M3) |
| IPC06 | 1444 | Consorcio Grupo Uvita | Microbús (M2) |
| CR42 | 1428 | Rápido Corre Caminos | Microbús (M2) |
| IM47, IO35B, IO38, IO45 | 1162, 1440, 1165, 1167 | Consorcio Briza | Minibús (M2-M3) |

No hay lista pública de qué rutas siguen con combis en la calle.
