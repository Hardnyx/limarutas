# Pendientes

## Calles de OpenStreetMap (caminatas e intersecciones)

Hoy las caminatas son en línea recta (hasta 400 m entre paraderos, con 30 %
de rodeo) y `data/raw/osm/transporte.zip` solo trae las vías por donde pasan
rutas (634 calles residenciales). Plan, un PR por fase:

1. **Descarga y pipeline** (`pipeline/scripts/osm/`): consulta a Overpass con
   el recuadro de Lima y Callao, solo vías caminables (avenidas, calles,
   jirones, pasajes, veredas, escaleras; sin vías expresas ni `foot=no`). El
   crudo (~100–200 MB) no se versiona. Se corre en local o con una GitHub
   Action manual que abre un PR. Desde el entorno de Claude en la nube hay
   que permitir `overpass-api.de` en *Network access*.
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
  probablemente nuevas del PRR).
- Fuente de "rutas que circulan": el anexo del subsidio ECO (resolución SSTR
  del 24/07/2026, operadores con servicio registrado en el SICM) listaría las
  rutas con operación real; el PDF recibido no trae el anexo.

## Otros

- Viajes con 2 transbordos.
- Búsqueda de direcciones (geocodificación).
- Alimentadores del Metropolitano en "Cómo llegar" (sus paraderos no traen orden).
- Imágenes de las rutas.
- Llenar `semiformal.verificadas` en `config/catalog.json`.
- Ampliación norte del Metropolitano (Chimpu Ocllo – Naranjal) en el export de
  OSM de la vía (`metropolitano.json`): hoy esos tramos usan la macroruta.
