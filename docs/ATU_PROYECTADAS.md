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

Un 304 o un 200 semánticamente idéntico no regenera los derivados ni hace commit.
El workflow termina sin reconstrucción ni validaciones adicionales cuando no
hay cambios semánticos. La telemetría de consulta queda en
`pipeline/temp/atu-sync-report.json`. Si falla una transformación, el informe
registra `success=false`; una escritura fallida restaura el conjunto anterior
antes de propagar el error. El primer GET real y una repetición 304 se
comprobaron durante la integración.

## Planificador y actualizaciones

Todos los objetos PMU llevan `operativo=false`, `ruteable=false` y `plannerEligible=false`. Explorar usa un módulo y un pane independientes; no registra servicios en los sistemas operativos, ni en `wr_map`, `wr_stops_index`, `trip_graph`, congestión o tiempos. La validación del grafo rechaza IDs `pmu:`. No hay promoción automática del estado declarado por ATU a operación local.

`.github/workflows/update-atu-pmu.yml` comprueba la fuente cada lunes a las 06:17 de Lima y permite ejecución manual. Las horas de Actions pueden retrasarse. Conserva caché HTTP, hace auditoría incondicional al menos cada 30 días, valida y hace un commit convencional solo ante cambios reales. Después dispara explícitamente el workflow Pages por `workflow_dispatch`, porque un push con GITHUB_TOKEN no activa otro workflow por push. Pages conserva todas las pruebas antes de publicar.

Esta integración se limita al PMU, conforme al encargo. PRR y SIT actual no reemplazan rutas operativas, geometrías aceptadas o correcciones locales. El historial Git conserva los snapshots anteriores.

## Autoría ferroviaria y nombres de estaciones

La API común reconoce los paquetes ATU del informe Metro/PMU mediante
`sourceKind=official_plan`, `transportMode=rail`, `geometryPolicy=preserve` y
`plannerEligible=false`. Importar verifica el hash del snapshot adquirido,
el objeto oficial, sus propiedades y el hash de geometría. Las partes de un
`MultiLineString` permanecen separadas en todos los pasos. Aceptar significa
aceptación cartográfica del proyecto; nunca autorización operativa.

`docs/atu/rail_authoring_checks.json` registra los diez paquetes del informe
comprobados por HTTP, con 11 partes y geometrías exactas. El funcionamiento,
revisión y exportación se describen en `docs/ROUTE_AUTHORING.md`. Las
exportaciones quedan aisladas y no duplican servicios dentro de Explorar.

`config/pmu_station_names.json` conserva nombres y fuentes del informe:
22 estaciones pendientes de L2, 28 del estudio L3, ocho del ramal L4 y 20 de
su continuación. Se vinculan por identidad lógica del eje y horizonte;
renombrar un eje en una fuente futura requiere revisar esa equivalencia.
La ficha los presenta como referencias con ubicación pendiente; no genera
marcadores. Las cinco estaciones operativas de L2 no se vuelven a incluir
como estaciones de su tramo pendiente. Las listas de estudio no garantizan
que el proyecto definitivo conserve el mismo número de estaciones.
