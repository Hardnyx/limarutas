# Estaciones y nodos proyectados ATU

Explorar conserva los 106 ejes originales, su multipartición y colores del geovisor. El catálogo independiente contiene 171 entradas: 90 estaciones futuras, 25 centros de transferencia, 44 nodos DOT, 11 terminales de teleférico y un nodo intermodal. Hay 52 ubicaciones respaldadas: 30 estaciones y 22 centros de transferencia. Todas tienen `operativo=false`, `ruteable=false` y `plannerEligible=false`. No se agregan al grafo de viajes ni a las rutas actuales.

## Cobertura publicada

| Proyecto o tipo | Nombres documentados | Localizados | Método | Pendientes / siguiente documento |
|---|---:|---:|---|---|
| L2 | 22 | 14 | documented_intersection | 22 futuras; las 5 operativas se vinculan al inventario actual, sin duplicarlas. Cruces o planos actualizados para las restantes. |
| L3 | 28 | 2 | geopdf_digitized | Plano ATU esquemático: ingeniería actual para los 26 pendientes. |
| L4-ramal | 8 | 6 | documented_intersection | El Olivar y Morales Duárez requieren plano/cruce comprobado. Aeropuerto es el ramal histórico, no un acceso al nuevo terminal. |
| L4 | 20 | 6 | geopdf_digitized | Ingeniería actual para las 14 pendientes. |
| Grau | 4 | 0 | Sin localizar | 4 nombres; pruebas ATU 1–6/10/2026. Falta plano de andenes y conexión L1; no se presume servicio regular. |
| Sur | 5 | 0 | Sin localizar | EMAPE confirma 5 futuras en febrero 2026. Los nombres provienen de investigación aportada; EMAPE/431 devuelve 502. Falta plano de estaciones. |
| Universitaria | 3 | 2 | documented_intersection | 15 anunciadas: 3 elevadas identificadas y 12 a nivel sin nombres. CUI 2619225, expediente y estudio de demanda. |
| centro_transferencia | 25 | 22 | Mapa PMU georreferenciado | Villa El Salvador y Naranjal sin símbolo rotulado inequívoco; Tomás Valle tiene rótulo ambiguo entre dos puntos. |
| nodo_dot | 44 | 0 | Sin localizar | Tabla 59 tiene 44 filas, texto introductorio menciona 38. Figura 108 sin rótulos/IDs; se necesita la capa GIS, no asignación por proximidad. |
| terminal | 11 | 0 | Sin localizar | Figuras 49–52: terminales explícitos; planos o suficientes controles independientes para cada mapa. |
| nodo_intermodal | 1 | 0 | Sin localizar | Interconexión L7 explícita en Figura 50; falta geoubicación comprobada. |

## Evidencia y precisión

La existencia documental y la ubicación son campos independientes. `geometry=null` conserva nombres pendientes; los GeoJSON visibles incluyen únicamente puntos localizados. Se guardan `source_geometry`, `display_geometry=null`, hash de fuente, página PDF/impresa, edición, método, función de coordenada y nota de incertidumbre. Nunca se sustituyen por extremos del eje, centros de distrito, puntos uniformes, cruces inferidos ni `[0,0]`.

- **TSV-05 San Isidro, julio 2022:** 8 símbolos de L3/L4, escala 1:20 000. Se elige el mayor viewport `/VP` y se leen `/Measure`, `/GCS`, `/GPTS`, `/LPTS` y `/BBox`, sin números de objeto fijos. La transformación respeta el origen vertical y usa `always_xy=True`. Cinco controles de cuadrícula independientes dan residuales menores de 3 m. Esa cifra valida la transformación, no la precisión de los símbolos ni su vigencia como ingeniería. La antigua L6 del plano se excluye.
- **Figura 75 PMU:** imagen nativa 1672×1122, símbolos rojos explícitos. Transformación afín con cinco controles distribuidos de cartografía operativa y dos controles independientes. Residuales de ajuste y validación se conservan en `config/atu_station_locations.json`; RMSE independiente aproximado 260 m. Son referencias de área de CETRAM, sin accesos ni andenes. `uncertainty_m=null` porque los residuales no miden por sí solos el error de cada punto.
- **Ositrán 2024 y EMAPE Universitaria 2025:** cruces expresamente documentados y georreferenciados con segmentos OSM. Se conserva la pareja de calles, IDs de vías, segmentos, hash y fecha del extracto. `documented_intersection` / `intersection_reference` no equivale al centro de un andén. La distancia al eje PMU se informa sin mover el punto.
- **Variantes:** el PDF ATU descargado rotula Parque de la Reserva y Museo de Historia Natural, mientras la investigación aportada propone La Reserva y Parque de la Historia Natural. Se preservan como variantes y se documenta la discrepancia. Alejandro Velasco conserva Alejandro Velasco Astete como alias. L3/L4 Conde de San Isidro son dos identidades físicas; nombres compartidos no crean un intercambio ni fusionan estaciones.

## Fuentes, adquisición y actualización

Los documentos completos se descargaron y comprobaron por SHA-256 antes de extraer evidencia. Los extractos revisados viven en `data/raw/atu_estaciones/<id>/<sha256>/extract.json`; su propio hash también se verifica. Las copias binarias completas son caché de adquisición, reproducible desde las URLs oficiales. El catálogo publicado se reconstruye offline a partir de los extractos y revisiones, sin requerir PDFs, GDAL, PBF ni geocodificación.

| Fuente | Edición | SHA-256 del documento |
|---|---|---|
| [San Isidro TSV-05](https://msi.gob.pe/portal/wp-content/uploads/2022/07/7_TSV_05_INTEGRACION_DE_ESTACIONES_RED_DEL_SISTEMA_DE_TRANSPORTE_MASIVO.pdf) | 2022-07 | `294f8f3d00d8093ee069ed79a0848ffd889ae74de94a1b2d2a40983151d74b38` |
| [PMU aprobado Volumen II](https://cdn.www.gob.pe/uploads/document/file/9173500/7530942-volumen-ii-escenarios-y-planes-futuros%282%29.pdf?v=1766164056) | 2025-12 | `9025e4670dd6d918b582cb908321ffd26b0f5a79a14e79e991a25c4ff1da28d5` |
| [ATU exposición al Congreso](https://www3.congreso.gob.pe/Docs/comisiones2025/consumidor/files/so-10-exposicion-atu-02-12-2025.pdf) | 2025-11 | `c9961946a36fcdcdb9a1fc17573358607db639dfcb10c8b7997b92c580d28483` |
| [Ositrán Comunica](https://cdn.www.gob.pe/uploads/document/file/7039215/6058708-boletin-informativo-ositran-comunica-septiembre-2024.pdf?v=1727991989) | 2024-09 | `016c6021de0f060528ced9133806363f6b5eca524550d1b59a63c0f7ecde2e62` |
| [universitaria](https://www.gob.pe/institucion/emape/noticias/1338505-via-expresa-norte-megaobra-avanza-en-tramo-de-san-martin-de-porres-con-nuevas-pistas-veredas-y-ciclovia) | 2026-01-21 | `c78bb43f88d1485c8cb3020f5d4daa9eb06d1d05264cef0665fbe1423db026bd` |
| [universitaria-2025](https://www.gob.pe/institucion/emape/noticias/1104364-nuevo-corredor-vial-en-la-avenida-universitaria-de-comas-a-san-martin-de-porres-en-30-minutos) | 2025-01-27 | `5838acfe438d86de479614676d7f2d8835114fff4d2ce93dbc1292b2dda0bfef` |
| [grau](https://www.gob.pe/institucion/munilima/noticias/1202386-nuevo-corredor-en-la-via-expresa-grau-iniciamos-la-construccion-que-unira-el-metropolitano-y-la-linea-1) | 2025-07-02 | `dc232752516fed002d18e1c28582e7ddbb992682d2eec0143a55f2ca7c292792` |
| [grau-pruebas](https://www.gob.pe/institucion/atu/noticias/1451572-mtc-atu-inicia-pruebas-de-calibracion-de-equipos-con-pasajeros-en-la-conexion-del-metropolitano-por-la-via-expresa-grau) | 2026-10-01 | `71beafac94e9d81984cf8bc3d2063f07b33a8be8eaac7e7260c2b6f7e3d97fac` |
| [sur-2026](https://www.gob.pe/institucion/emape/noticias/1350450-2-pasos-a-desnivel-agilizaran-el-transito-en-la-via-expresa-sur) | 2026-02 | `568c4b1b918ef3546a79c21f244f0dad7a01ecb5dab930b8430f8b735199ad9c` |
| [Investigación aportada: fuentes descargables ATU](https://www.emape.gob.pe/noticia/431) | 2026-10-13 | `e5df66ac7908cc95e63f692a7745abb56ed630794548fb070c10972ca76d3436` |

`sync_station_sources.py` descarga candidatos con ETag/Last-Modified, verifica el cuerpo y conserva el último snapshot válido ante errores. La revisión semanal del workflow existente guarda un informe de cambios documentales. Un hash nuevo solicita revisión manual: no mueve estaciones ni presupone cambios de estaciones por una actualización del PDF o su HTML. No hay geocodificación indiscriminada ni publicación automática de coordenadas nuevas.

```sh
python3 pipeline/scripts/atu/sync_station_sources.py
# Restore the reviewed extract from the downloaded original:
python3 pipeline/scripts/atu/extract_station_documents.py --source-id san-isidro-tsv05 --input /path/to/source.pdf
python3 pipeline/run.py build --stage atu-stations
python3 pipeline/scripts/atu/validate_planned_stations.py
python3 pipeline/run.py validate
```

`geolocate_planned_stations.py` proporciona las transformaciones GeoPDF y afín para reproducir las revisiones. Las dependencias opcionales se fijan en `pipeline/requirements-atu-stations.txt`. Esa fase requiere pypdf, numpy y pyproj; la construcción/validación publicada usa biblioteca estándar. Los anclajes de símbolos, controles, matriz, residuales y segmentos de cruces están en `atu_station_locations.json`. Las coordenadas almacenadas son revisiones explícitas vinculadas al hash exacto de la fuente.

## Interfaz y validación

Estaciones, CETRAM, DOT, terminales y nodos intermodales tienen controles independientes en la misma pestaña Explorar. Al seleccionar un eje se dibujan exclusivamente sus relaciones documentales. Los pendientes aparecen en la lista sin pin; las fichas muestran método, antigüedad y fuentes. Símbolos diferenciados: círculo (estación), rombo (CETRAM), cuadrado (DOT), triángulo (terminal/nodo). Las capas se ocultan al salir de Explorar.

Se comprueban conteos, identidad, hashes, latitud/longitud, geometría nula, aislamiento operativo, preservación exacta de ejes, no fusión por nombre, reconstrucción idempotente y controles de interfaz en móvil y escritorio. Todos los archivos derivados se comparan contra una reconstrucción completa antes de publicar.

## Vacíos documentales y siguientes fuentes

- **L3 / L4 continuación:** búsqueda: ATU Congreso 2025 pp. 26-27 y TSV-05 2022. Resultado: Plano ATU esquemático, sin georreferenciación; se conservan solo los 8 símbolos GeoPDF comprobados. Siguiente: Planos de ingeniería o cartografía de estaciones actualizada.
- **Universitaria:** búsqueda: EMAPE CUI 2619225; presentación técnica 2025 URL citada. Resultado: 15 anunciadas, 3 referencias identificadas; presentación responde HTTP 502. Siguiente: Estudio de demanda / expediente técnico con las 12 estaciones a nivel.
- **Teleféricos:** búsqueda: PMU Vol II figuras 49-52 pp. PDF 169-170; anuncio ATU septiembre 2026. Resultado: Diagramas sin georreferenciación; no se equiparan versiones antiguas a ejes 2045. Siguiente: Planos o controles independientes suficientes para digitalizar símbolos.
- **L1 extensión / L5-L9 / otros BRT y corredores:** búsqueda: PMU ejes, CETRAM y DOT. Resultado: Nodos documentados; no listas completas de estaciones. Siguiente: Estudios de estaciones específicos de cada proyecto.
- **APM / trenes de cercanía:** búsqueda: PMU PDF 125 y 159. Resultado: Enlaces conceptuales, sin puntos de estación ni accesos del nuevo aeropuerto. Siguiente: Expedientes MTC / ProInversión y planos de terminales.
- **DOT:** búsqueda: Tabla 59 PDF 289-290 y Figura 108 PDF 291. Resultado: 44 nombres; los símbolos de Figura 108 no están rotulados ni tienen IDs que permitan atribuirlos sin inferencia. Siguiente: Capa GIS original o plano con identificadores de nodos.
