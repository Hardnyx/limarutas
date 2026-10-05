# Datos para "Cómo llegar"

Cálculo de viajes de A a B: datos (`tripData.js`), algoritmo
(`tripPlanner.js`) y pestaña "Cómo llegar" de la nueva interfaz (`tripUi.js`).

## Archivos

| Archivo | Qué es |
|---|---|
| `pipeline/scripts/trips/build_trip_graph.py` | Genera el grafo (unos 5 s) |
| `pipeline/output/trip_graph.json` | Paraderos y, por ruta y sentido, los paraderos en orden (1,8 MB; ~0,4 MB comprimido) |
| `assets/js/tripData.js` | Lo carga en el navegador y le agrega grupos, caminatas y búsqueda de paraderos cercanos |
| `assets/js/tripPlanner.js` | Calcula las opciones de viaje |
| `assets/js/tripUi.js` | Pestaña "Cómo llegar": origen, destino, opciones y dibujo en el mapa |

Regenerar después de cambiar los datos de Wikiroutes, Metropolitano o Metro:

```bash
python pipeline/scripts/trips/build_trip_graph.py
```

**Nombres mal escritos** (typos de Wikiroutes, como "Canaval y Moreira"): se
corrigen en `config/stop_name_fixes.json` (palabra completa, sin distinguir
mayúsculas). Después de agregar una corrección:

```bash
python pipeline/scripts/wikiroutes/wr_build_stops_index.py --write-stops   # buscador y stops_trip<N>.geojson
python pipeline/scripts/trips/build_trip_graph.py
```

Cambiar `config/catalog.json` **no** requiere regenerarlo: qué rutas entran y
de qué grupo son se decide en el navegador.

## Qué contiene

- **Paraderos**: 9 950, con nombre y distrito. En Wikiroutes, las rutas que
  paran en el mismo lugar comparten el id del paradero, así que cada id es
  un nodo.
- **Rutas**: cada capa de Wikiroutes (`1240-ida`, `1240-vuelta`…), cada
  servicio del Metropolitano en cada sentido que existe (`met:A:ns`,
  `met:A:sn`; `met:6:ns` solo, porque el Expreso 6 solo va al sur), con sus
  propias estaciones por sentido, y las líneas del
  Metro (`metro:L1:0`, `metro:L1:1`), con sus paraderos en orden.
- **Alimentadores del Metropolitano** (`alim:AN-01:ida`, `alim:AN-01:vuelta`):
  `build_alim_paths.py` corta cada circuito en el terminal (el punto del
  trazado más cercano a su estación) y en el punto más lejano; los paraderos
  se ordenan por su posición a lo largo del trazado. La estación del
  terminal es el mismo nodo que en el Metropolitano: se transborda sin
  caminar. Los del sur (AS-02, AS-04, AS-07, AS-08, desde Matellini) usan
  los paraderos oficiales del portal de la ATU (`config/alim_paraderos.json`),
  cada uno en el paradero de Wikiroutes de su nombre junto al trazado o,
  si no hay, entre sus vecinos (`aprox`). Los demás usan los de OSM, que traen
  el nombre de la ruta y se nombran con el paradero de Wikiroutes más cercano.

## Decisiones

**Qué rutas entran.** Solo las que tienen casilla en el sidebar, con el grupo
de su lista: Transporte público (`atu`), Corredores, AeroDirecto, Otros,
Metropolitano, Metro y Rutas antiguas (`antigua`). Así el catálogo se aplica
en un solo lugar.

**Rutas antiguas.** No entran por defecto, porque podrían ya no circular.
Entran:
- las de `catalog.json` → `semiformal.verificadas` (revisadas y siguen
  circulando), que se mostrarán con la etiqueta "Sin autorización ATU";
- todas, si la persona activa "Incluir rutas antiguas"
  (`activeRoutes({ includeOld: true })`). Si no hay viaje sin ellas, se
  ofrecerá activarlo.

Al terminar la revisión del catálogo (sacar las que no operan), quedarán
solo las que circulan y el switch se podrá quitar.

**Vía principal y vía auxiliar.** En avenidas con dos calzadas (Panamericana
Norte, Grau…) hay paraderos con el mismo nombre en cada una, por ejemplo
"Control" y "Control (Auxiliar)", a 15 m. Son **paraderos distintos** (un
bus de la principal no para en la auxiliar y puede haber un separador),
**unidos por una caminata corta**. Lo mismo pasa con los dos lados de la pista.

**Caminatas.** Entre paraderos a 400 m o menos en línea recta
(`WALK_MAX_M`), calculadas en el navegador con una grilla.
En el mapa, cada tramo a pie del viaje elegido se dibuja por la red peatonal
propia (`walkRoute.js`), armada desde OpenStreetMap por
`pipeline/scripts/osm/build_walk_graph.py` (`data/processed/caminata/`, en
cuadrículas de 0,02°; el navegador carga solo las de la zona del tramo):
veredas, cruces, escaleras, puentes peatonales y calles. No va por las
ciclovías (salvo que también sean peatonales), ni por la vía del
Metropolitano, ni por dentro de las estaciones (andenes y pasillos a menos de
20 m de la vía: sería entrar a la zona paga), ni por autopistas o donde OSM
dice `foot=no`. OSM no une siempre la esquina con su vereda ni con la otra
calzada de la avenida: cada esquina se une a la vereda más cercana (hasta
20 m) y a la calle paralela más cercana (la otra calzada o la auxiliar, hasta
30 m); las veredas que terminan sueltas, al nodo más cercano (hasta 12 m); las
islas sueltas (veredas de un parque sin salida mapeada), fuera. Si no hay
camino o da más de 4 veces la recta (otra orilla de un río), queda en línea
recta. El cálculo del viaje no lo usa: sigue con la recta y su factor.

## Cálculo (`planTrip`)

1. Paraderos a 800 m o menos de A y de B (`ACCESS_MAX_M`); en rutas únicas,
   hasta 1,3 km (`DIRECT_ACCESS_MAX_M`: hay quien prefiere caminar 15 min antes
   que transbordar; su costo lo refleja). Si A y B están a 600 m o menos, se
   sugiere caminar.
2. **Directos**: desde cada paradero cerca de A, cada ruta que pasa por ahí
   se recorre hacia adelante hasta un paradero cerca de B.
3. **Un transbordo**: se precalcula, para cada paradero, la mejor forma de
   terminar el viaje (subir ahí y bajar cerca de B). Luego, desde cada
   paradero de la primera ruta, se busca ese final en el mismo paradero o
   caminando hasta 400 m. Nunca entre la ida y la vuelta del mismo servicio.
4. Se guarda la mejor opción por combinación de rutas. Un transbordo en el
   que alguna de sus rutas ya va directo se descarta, salvo que ahorre 10 min,
   y también uno con un tramo de 1 o 2 paraderos (mejor caminar).
5. **Alternativas por tramo**: otras rutas que suben a 150 m o menos de donde
   sube la del tramo y bajan a 150 m o menos de donde baja, sin tardar más del
   40 % (+5 min). Se muestran como "1057 o 1099 o 1200": la que pase primero.
6. **Orden**: primero las **rutas únicas cómodas** (directas con hasta 800 m
   a pie en total) y los transbordos que ahorran al menos 20 min frente a
   ellas; después, el resto. Dentro de cada grupo, por costo: minutos de
   viaje + la caminata otra vez (pesa doble; la del transbordo, triple) +
   20 por transbordo (bajarse, cruzar y esperar otro bus) + la espera de
   cada subida (ver abajo).
   Calibrado a mano con Canaval y Moreyra → Mariátegui (VES): la 1122
   directa (750 m a pie, ~82 min) va antes que 1057 › 1185 (~80 min, con
   transbordo en Atocongo).
   **Transbordo integrado de la ATU** (todos los tramos en Metro,
   Metropolitano o corredor: misma tarjeta, pasan seguido): cuenta 10 en vez
   de 20 y va primero si es más rápido que el mejor directo, no hace caminar
   más de 500 m extra y ninguna otra opción es más de 5 min más rápida.
   Calibrado con Habich → Estadio Monumental: Expreso 5 › Corredor Rojo
   (~87 min) va antes que la 1191 directa (~96 min, ~300 m menos a pie).
7. Hasta 6 opciones que no se repitan (dos son la misma si en cada tramo
   comparten alguna ruta) y como mucho 2 transbordos que empiecen con las
   mismas rutas. Todas las rutas únicas que cuesten hasta 1,5 veces la
   mejor aparecen.
8. **Metro, Metropolitano y corredores** pesan más: su tiempo a bordo cuenta
   un 20 % menos y se asume que pasan cada 8 min. Si hay una opción
   con ellos que cueste hasta 1,8 veces la mejor y haga al menos el 40 % del
   viaje en ellos, siempre aparece (le hace lugar el transbordo más caro,
   nunca una ruta única).

**Congestión.** Cada tramo de bus entre dos paraderos lleva el % extra que
dura en hora punta (`slow` en `trip_graph.json`, de
`pipeline/scripts/trips/congestion.py`). En cada punto vale la mayor de dos
demoras:

- La lista curada (`config/congestion.json`): tramos con factor medido o
  reportado. Abancay y Grau ×1,4 (~10–11 km/h según la ATU), Aviación en
  Gamarra ×1,5, Acho ×1,6 (zona: Evitamiento, Abancay, puente Ricardo
  Palma), Huánuco, Huanta, Caquetá, Samuel Alcázar, Alfonso Ugarte y
  Carretera Central ×1,3, La Marina, Universitaria, Túpac Amaru y Próceres
  ×1,25, Angamos, Venezuela y Evitamiento ×1,2. De la Panamericana, solo
  sus tramos críticos: Sur de Benavides al Puente Alipio ×1,35; Norte de
  Habich a Naranjal ×1,2 y de Naranjal a Zapallal ×1,3.
- La carga de la calle: cuántas líneas vigentes (rutas del PRR y
  corredores, por sus trazados de Wikiroutes) pasan por cada tramo frente a
  sus carriles por sentido (`lanes` de OSM). Desde 8 líneas por carril (la
  mediana de Lima es ~5), cada una suma 4 %, hasta 40 %: Huanta o Huánuco,
  ~22 líneas en 2 carriles, +12 % a +40 %.

Un carril exclusivo descuenta y manda sobre lo demás: Arequipa entre 9 de
Diciembre y Emilio Fernández (Corredor Azul) ×0,6, Javier Prado (Corredor
Rojo) ×0,8. Brasil y Tomás Marsano tienen carril segregado y no se
penalizan. Abancay sí, aunque tiene carril segregado desde enero de 2026:
lo comparten muchas rutas y lo invaden autos y taxis.

El planificador lo aplica completo en hora punta de lunes a viernes
(6:00–9:30 y 17:00–21:00), la mitad el resto del día, 0,4 los sábados, 0,2
los domingos y nada de noche. El Metropolitano (425 m/min, 25,5 km/h según
Global BRTData) y el Metro (500 m/min) van por vía exclusiva y tienen su
propia velocidad.

**Hora punta.** Además, todo bus que va por la pista (no el Metropolitano ni
el Metro) tarda más según la hora (`busPeakFactor`): ×1,8 de lunes a viernes
de 17:00 a 20:30, ×1,5 de 6:30 a 9:30, ×1,1 al mediodía (12:30–14:30) y los
sábados de día; ×1 el resto. Calibrado con un viaje real: la 1056 de Las
Begonias (San Isidro) a Amazonas (Cercado) un martes a las 17:15 tomó ~65
min a bordo, frente a ~27 a media mañana.

**Metropolitano con cambio de servicio.** El primer tramo en el
Metropolitano puede seguir en otro servicio en la misma estación (B › Expreso
1 en Central) y de ahí hacer un transbordo a un bus: Habich → San Rodolfo va
en Metropolitano hasta Matellini y la 1087. Cambiar de servicio no es salir
del sistema: suma 2 min y una molestia menor que un transbordo integrado.

**Estación más lejana.** Si el tramo a pie lleva a una estación del
Metropolitano y hay otra más cerca donde ese servicio no para, el paso lo
dice («El Expreso 2 no para en Canaval y Moreyra, que está más cerca»).

Minutos estimados: caminata 75 m/min con 30 % de rodeo, bus 250 m/min (más la congestión)
(~15 km/h), Metro 500 m/min, Metropolitano 425 m/min, 3 min por transbordo (bajar
y cruzar). El tramo se dibuja por el trazo de Wikiroutes; el Metropolitano, por su
macroruta (A o B, en el sentido del viaje), como en la pestaña Rutas; el Metro,
entre estaciones. Se marca cada paradero del tramo, con su nombre.

**Espera.** Cada ruta del PRR trae en su ficha técnica el intervalo de paso
(`prr_fichas.json` → `trip_graph.json` `headway`): de 2 a 8 min, mediana 5.
La ficha no trae horario de operación ni distingue hora punta: es el
intervalo de diseño, uno para todo el día (en la práctica, de noche pasan
menos). Llegando sin mirar el horario, la espera media es la mitad del
intervalo; si sirven varias rutas, 1 / (2 · Σ 1/intervalo). Sin ficha
(rutas antiguas, alimentadores) se asume un intervalo de 20 min; Metro,
Metropolitano y corredores, 8. Los minutos del viaje incluyen esa espera, y
el paso lo dice: "Pasa cada ~5 min según la ATU · espera ~3 min".

La flota y el intervalo de la ficha dan una velocidad comercial (km de ida y
vuelta ÷ flota × intervalo) de mediana 14,6 km/h, lo que confirma los ~15 km/h
del bus; por ruta es muy dispersa (4 a 45 km/h) y no se usa.

**Horarios del Metropolitano.** `metropolitano_services.json` trae el horario
de cada sentido (`schedule.ns`, `schedule.sn`: días `LMXJVSD` y horas; si
termina antes de empezar, cruza la medianoche, como el Lechucero de viernes y
sábado 23:30–4:00). Un sentido sin horario no existe. En "Cómo llegar" se
elige la **Salida** (Ahora, o un día y hora; siempre hora de Lima): solo
entra lo que circula a esa hora. El paso dice el horario del servicio, y si
un servicio serviría pero no circula a esa hora, se avisa con su horario.
El resto de rutas se asume en servicio a cualquier hora.

Servicios vigentes (horarios de los mapas QR de la ATU, 2026-09): regulares A,
B y C; expresos 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, SX, SXN, SXN desde 22
de Agosto (`SXN-22`, solo al sur) y Lechucero. La Ruta D ya no opera.

**Trazado del Metropolitano.** `build_met_paths.py` arma el recorrido de cada
servicio y sentido sobre la vía exclusiva (export de OSM
`metropolitano.json`, respetando las calzadas de un solo sentido), estación
por estación, con los metros recorridos. Se usa para dibujar (en Rutas y en
Cómo llegar) y para el tiempo a bordo (`segM` en `trip_graph.json`). Los
tramos que el export no cubre (ampliación norte) van por la macroruta.

```bash
python pipeline/scripts/metropolitano/build_met_paths.py
python pipeline/scripts/metropolitano/build_alim_paths.py
python pipeline/scripts/trips/build_trip_graph.py
```

Pendientes (OSM, 2 transbordos, direcciones…): [PENDIENTES.md](PENDIENTES.md).
