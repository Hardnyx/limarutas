# Red proyectada ATU y Explorar

La pestaña **Explorar** muestra la capa PMU del geovisor ATU. La consulta inicial del 12 de octubre de 2026 contiene 106 ejes: 12 ferroviarios, BRT, corredores y teleféricos. El inventario reproducible está en `docs/atu/pmu_inventory.json`. Son ejes de planificación, no una lista de servicios comerciales futuros confirmados.

Las líneas conservan todos los vértices y partes oficiales. No se unen las partes de una `MultiLineString`, no se ajusta Metro a calles ni se inventan estaciones. Esta fuente no publica puntos de estaciones. Los colores neutros del mapa son derivados, no colores oficiales. La ficha distingue estado declarado por ATU, horizonte PMU y Last-Modified del archivo; ninguno confirma fecha de apertura. El escenario base se puede consultar sin cambiar la red operativa local.

## Adquisición y construcción

```bash
python3 pipeline/scripts/atu/sync_geovisor.py
python3 pipeline/scripts/atu/build_pmu.py
python3 pipeline/scripts/atu/validate_pmu.py
# Auditoría incondicional
python3 pipeline/scripts/atu/sync_geovisor.py --force
# Construcción sin descarga, mediante el runner
python3 pipeline/run.py build --stage atu-pmu
```

`sync_geovisor.py` descarga candidatos con TLS, ETag/Last-Modified y snapshots por hash en `pipeline/temp/atu-sources`. Compara contra lo publicado, valida clasificación y geometría antes de promover. Conserva el último conjunto válido ante HTML de error, colección vacía, cambios de esquema desconocidos, tecnología/horizonte desconocidos o caída de más del 50 % de features. Los campos y tecnologías admitidos están en `config/atu_geovisor_layers.json`.

Los originales exactos y el manifest están en `data/raw/atu_geovisor/`; los derivados independientes están en `data/processed/planificado/`. La identidad estable usa nombre y horizonte, no posición ni OBJECTID entre versiones. Cada derivado conserva OBJECTID del snapshot, propiedades, URL y SHA. El diff semántico en `pipeline/output/atu_pmu_diff.json` compara altas, bajas, geometría y propiedades, independientemente del orden JSON.

Un 304 o un 200 semánticamente idéntico no regenera los derivados ni hace commit. La telemetría de consulta queda en `pipeline/temp/atu-sync-report.json`. El primer GET real y una repetición 304 se comprobaron durante la integración.

## Planificador y actualizaciones

Todos los objetos PMU llevan `operativo=false`, `ruteable=false` y `plannerEligible=false`. Explorar usa un módulo y un pane independientes; no registra servicios en los sistemas operativos, ni en `wr_map`, `wr_stops_index`, `trip_graph`, congestión o tiempos. La validación del grafo rechaza IDs `pmu:`. No hay promoción automática del estado declarado por ATU a operación local.

`.github/workflows/update-atu-pmu.yml` comprueba la fuente cada lunes a las 06:17 de Lima y permite ejecución manual. Las horas de Actions pueden retrasarse. Conserva caché HTTP, hace auditoría incondicional al menos cada 30 días, valida y hace un commit convencional solo ante cambios reales. Después dispara explícitamente el workflow Pages por `workflow_dispatch`, porque un push con GITHUB_TOKEN no activa otro workflow por push. Pages conserva todas las pruebas antes de publicar.

Esta integración se limita al PMU, conforme al encargo. PRR y SIT actual no reemplazan rutas operativas, geometrías aceptadas o correcciones locales. El historial Git conserva los snapshots anteriores.
