# Pendientes

## Estado recuperado el 12 de octubre de 2026

Esta sección distingue los pedidos de «Limarutas 1» del backlog histórico de abajo.
La ejecución [Pages 38254350115](https://github.com/Hardnyx/limarutas/actions/runs/38254350115)
publicó correctamente `19987a7` a las 08:36 de Lima. El workflow ATU
[38250712928](https://github.com/Hardnyx/limarutas/actions/runs/38250712928) también terminó correctamente.

| Pedido | Estado comprobado | Evidencia o siguiente paso |
|---|---|---|
| AeroDirecto: Quilca, aeropuerto y coincidencias de Centro/Norte/Sur | Seis sentidos corregidos y publicados | `docs/osm/aerodirecto_itineraries.json`; originales y paraderos conservados |
| Naranjal: embarques físicos y códigos | Trece salidas corregidas y publicadas | `docs/osm/naranjal_boarding.json`; llegadas conservadas, desembarque aún sin certificar |
| Red PMU y pestaña Explorar | 106 ejes publicados, actualización semanal probada | `docs/ATU_PROYECTADAS.md`; cero objetos PMU en el planificador |
| Autoría ferroviaria del informe Metro/PMU | Adaptador de referencia implementado y diez paquetes comprobados por HTTP | `docs/atu/rail_authoring_checks.json`; 11 partes exactas, revisión cartográfica, sin OSM |
| Nombres de estaciones del informe | L2 pendiente, L3 y L4 incorporadas a fichas | 22, 28 y 8+20 nombres citados; no son puntos ni confirmación de ingeniería definitiva |
| Coordenadas de nuevas estaciones Metro | Pendiente de evidencia geográfica suficiente | No geocodificar automáticamente un nombre, centro de cámara o intersección para publicar un pin |
| Matellini | Archivo v3 recuperado; integración de embarques pendiente | Cuatro puntos regulares aptos para orientación, de Yandex; no son plataformas OSM verificadas. El Playero es estacional e inactivo; no activarlo |
| Desembarques Naranjal y Matellini | Pendiente de identificación física independiente | No reutilizar automáticamente la posición de embarque para las llegadas |

El archivo vigente de Matellini es `matellini_embarques_alimentadores_v3.geojson`,
versión `3.0-geolocated`, del 11 de octubre. Sus asignaciones son AS-02 Cedros
de Villa: 1; AS-07 América: 4; AS-04 Villa El Salvador: 11; AS-08 Los Próceres: 14.
El punto Playero (16) se conserva como evidencia estacional inactiva. La próxima
integración debe reconocer una referencia para pasajeros y su fuente, sin
convertirla en un nodo OSM ni certificar el circuito de llegada. El adaptador
actual de Naranjal exige nodos OSM explícitos; pasarle el v3 sin ampliarlo
omitiría sus features por tener otro esquema.

Los Markdown consultados para esta continuación fueron
`SKILL_ATU_RUTAS_PROYECTADAS_LIMARUTAS(2).md`,
`Informe_Instrucciones_Metro_PMU_Limarutas.md` y los documentos del repositorio
`PIPELINE`, `ROUTE_AUTHORING`, `ATU_PROYECTADAS` y `RECORRIDOS`.
El SKILL más reciente mantiene PRR/SIT y la renovación de Wikiroutes fuera
de la integración PMU; no reemplazar itinerarios operativos por esos datos.

### Backlog histórico

Las secciones siguientes conservan tareas abiertas previas; no son requisitos
nuevos ni prueba de que los pedidos ya publicados sigan pendientes.

## Calles de OpenStreetMap (caminatas e intersecciones)

Hoy las caminatas son en línea recta (hasta 400 m entre paraderos, con 30 %
de rodeo) y `data/raw/osm/transporte.zip` solo trae las vías por donde pasan
rutas (634 calles residenciales). Plan por fases, con push directo tras validar:

1. **Descarga y pipeline** (`pipeline/scripts/osm/`): consulta a Overpass con
   el recuadro de Lima y Callao, solo vías caminables (avenidas, calles,
   jirones, pasajes, veredas, escaleras; sin vías expresas ni `foot=no`). El
   crudo (~100–200 MB) no se versiona. Se corre en local o con una GitHub
   Action manual que prepare los datos para su validación y publicación.
   La adquisición necesita acceso de red a `overpass-api.de`.
2. **Caminatas reales entre paraderos**: cada paradero se engancha a la
   calle más cercana y se calcula la distancia por la red hasta los
   paraderos a ~600 m. Reemplaza la línea recta en `trip_graph.json`
   (+1,5–2,5 MB). Deja de proponer transbordos que cruzan un río, una vía
   expresa o un muro.
3. **Intersecciones**: un paradero a pocos metros del cruce de dos vías con
   nombre se nombra "Av. X con Av. Y" (se conserva el nombre de Wikiroutes
   para buscarlo); los paraderos de las dos avenidas quedan unidos con su
   caminata real y los pasos dicen "Cruza la Av. X hasta el paradero de la
   Av. Y".
4. **Caminata desde el punto elegido**: la red en cuadros de ~1 km; el
   navegador carga solo los de A y B y dibuja la caminata por las calles.

Licencia: ODbL; el mapa ya muestra "© OpenStreetMap".

## Rutas que realmente operan (ATU)

- **Rutas desiertas** (sin operador tras la renovación, RD D-000024-2025-ATU/DO,
  Anexo I): 1003, 1004, 1088, 1107, 1153, 1190, 1250, 1278, 1327, 1340, 1371,
  1437, 1456. Están en `catalog.transporte.exclude`. Si la ATU autoriza
  alguna (resoluciones DO-SSTR posteriores a junio de 2025), sacarla de ahí.
- **Corredores**: solo los servicios en operación según el portal de la ATU
  (`catalog.corredores.only`). Faltan trazados de **SE-08** (Azul) y **SE-09**
  (Morado).
- **Cole Bus B** (Corredor Azul, escolar): recorridos, paraderos y horarios de
  salida en `config/cole_bus.json`. Falta ubicar Ricardo Bentín, Mónaco y
  México para dibujarlo.
- **Rutas del PRR sin trazado de Wikiroutes**: 1420 y 1427–1460 (33 rutas,
  probablemente nuevas del PRR). `prr_fichas.json` trae su itinerario calle
  por calle: con las calles de OSM se podría trazar cada una.
- **Fichas técnicas en el sidebar**: intervalo de paso, km, flota y
  carrocería de cada ruta (`prr_fichas.json`, 1 MB: generar una versión
  liviana para el front).
- **Trazados sospechosos**: `pipeline/output/prr_wr_km.csv`
  (`atu/check_wr_km.py`) compara el largo de cada trazado de Wikiroutes con
  los km de su ficha; 88 capas se salen de ±30 % (1321 mide 3 veces lo de su
  ficha; 1462, la mitad): revisar si son de otra ruta o variantes.
- Fuente de "rutas que circulan": el anexo del subsidio ECO (resolución SSTR
  del 24/07/2026, operadores con servicio registrado en el SICM) listaría las
  rutas con operación real; el PDF recibido no trae el anexo.

## Otros

- Viajes con 2 transbordos.
- Búsqueda de direcciones (geocodificación).
- Portal Mapas QR de la ATU (`config/atu_portal_qr.json`, solo lo visible; comparar con `python pipeline/scripts/atu/check_portal_qr.py`). Los 23 alimentadores del portal están en el mapa con su terminal. Los que OSM no tiene o tiene con su recorrido viejo se trazan desde sus mapas QR por la red vial de OpenStreetMap (`red_vial.py`, nodo a nodo sobre `data/raw/osm/Lima.osm.pbf`, que baja `pipeline/scripts/osm/descargar_lima.py`; `config/alim_trazados.json`), corregidos con los paraderos oficiales de la base de la ATU (`data/raw/atu/BASE_PARADEROS_ATU.xlsx` → `config/alim_paraderos.json`, `import_base_paraderos.py`). Quedan aproximados Torre Blanca (sus paraderos —Machuca, Vega, Pisa…— no están en Wikiroutes) y Antúnez de Mayolo (la base marca calidad media: la ATU cambió paraderos en 2024); 115 de 615 paraderos sin paradero de Wikiroutes con su nombre, ubicados entre sus vecinos. Trapiche solo opera en hora punta, pero el planificador no mira horarios de alimentadores. Faltan dos líneas del Cole Bus (Ricardo Bentín, María Parado de Bellido); la base de la ATU da la Regular D como operativa y el catálogo, suspendida (confirmar).
- Alimentadores del sur: 11 paraderos oficiales sin paradero de Wikiroutes cerca, ubicados entre sus vecinos: AS-02 Isla Española (vuelta, en el punto de vuelta) y 10 de Noviembre; AS-04 INR, Villa Panamericana y Velasco Alvarado (en ambos sentidos), 200 Millas y Lavalle; AS-07 Panamericana; AS-08 Vista Alegre.
- Imágenes de las rutas.
- Llenar `semiformal.verificadas` en `config/catalog.json`.
- Ampliación norte del Metropolitano (Chimpu Ocllo – Naranjal) en el export de
  OSM de la vía (`metropolitano.json`): hoy esos tramos usan la macroruta.
- Fotos referenciales (`config/route_photos.json`, vacío): desde una máquina con acceso a Wikimedia Commons, correr `python pipeline/scripts/photos/commons_photos.py --buscar` (categorías «Ruta <código>» de Commons) o agregar un archivo por enlace con `--ruta 1244 --archivo <enlace de Commons>`. Solo licencias libres o permiso del autor con su enlace; el CI lo valida con `--check`.
- Base de paraderos de la ATU (`data/raw/atu/BASE_PARADEROS_ATU.xlsx`), Metropolitano: coincide con el mapa salvo dos errores de la base, que contradicen los mapas QR de la ATU: le da al Expreso 9 un sentido norte → sur (el mapa QR: solo Plaza de Flores → UNI, L-V 5:30–9:00) y al Súper Expreso Norte de norte a sur solo Naranjal y Estación Central (el mapa QR: también Dos de Mayo, Quilca y España, L-V 5:00–10:00 y 16:30–20:30). El mapa queda como está.
- Paraderos de alimentadores sin paradero de Wikiroutes con su nombre: se buscan en el cruce con la calle de su nombre, pero el export de OSM solo trae las calles por donde pasan buses (7 de 115); con las calles de OSM completas se ubicarían casi todos.
- Metropolitano por la Vía Expresa Grau (Central → Abancay, Andahuaylas, Parinacochas I y luego Grau, con la Línea 1): marcha blanca del 1 al 6 de octubre de 2026, operación regular en diciembre. Estaciones y fuente en `config/metropolitano_pendiente.json`; OSM tiene la calzada ('Vía Expresa Almirante Miguel Grau') pero no el servicio ni las estaciones, y Wikiroutes tampoco. Agregarlo cuando opere, con su horario y el mapa QR (para confirmar dónde quedan Andahuaylas y Parinacochas I).

