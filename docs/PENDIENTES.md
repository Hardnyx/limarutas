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
- Alimentadores del norte (AN-01~17): OSM solo trae de 2 a 9 paraderos por sentido; pasar sus listas del portal de la ATU a `config/alim_paraderos.json`, como los del sur.
- Portal Mapas QR de la ATU (`config/atu_portal_qr.json`; comparar con `python pipeline/scripts/atu/check_portal_qr.py`): faltan en el mapa los alimentadores Naranjal e Izaguirre, los de la extensión norte (Belaunde: Carabayllo; Los Incas: Collique; Chimpu Ocllo: San Juan de Dios ×2, Universitaria, Carabayllo, Torre Blanca; Universidad: Trapiche, Torre Blanca; 22 de Agosto: Torre Blanca), dos líneas del Cole Bus (Ricardo Bentín, María Parado de Bellido) y los servicios Regular D y Expreso 4 del Metropolitano (el catálogo dice que la D ya no opera: confirmar con su mapa QR). AN-16 (Los Olivos) y AN-17 (Antúnez de Mayolo) tienen terminal Izaguirre en el mapa y el portal los agrupa en Naranjal. Para cada uno hace falta su página del portal (el mapa QR con paraderos y horario).
- Alimentadores del sur: 11 paraderos oficiales sin paradero de Wikiroutes cerca, ubicados entre sus vecinos: AS-02 Isla Española (vuelta, en el punto de vuelta) y 10 de Noviembre; AS-04 INR, Villa Panamericana y Velasco Alvarado (en ambos sentidos), 200 Millas y Lavalle; AS-07 Panamericana; AS-08 Vista Alegre.
- Imágenes de las rutas.
- Llenar `semiformal.verificadas` en `config/catalog.json`.
- Ampliación norte del Metropolitano (Chimpu Ocllo – Naranjal) en el export de
  OSM de la vía (`metropolitano.json`): hoy esos tramos usan la macroruta.
- Fotos referenciales (`config/route_photos.json`, vacío): desde una máquina con acceso a Wikimedia Commons, correr `python pipeline/scripts/photos/commons_photos.py --buscar` (categorías «Ruta <código>» de Commons) o agregar un archivo por enlace con `--ruta 1244 --archivo <enlace de Commons>`. Solo licencias libres o permiso del autor con su enlace; el CI lo valida con `--check`.
