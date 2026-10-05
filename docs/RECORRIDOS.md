# Recorridos por la red de calles

Cada ruta deja de ser un dibujo y pasa a ser un **recorrido por la red de
calles de OpenStreetMap**: la secuencia de nodos de OSM por la que pasa el
bus. De ahí salen su geometría (la misma del mapa de fondo, que también es
de OSM: entra a los óvalos por el anillo, sigue la curva de la avenida) y sus
pasos («por Av. X 420 m, a la derecha en Av. Y, en el óvalo toma la 2.ª
salida…»), que sirven para leerla y corregirla.

## La red

`data/raw/osm/Lima.osm.pbf`, el extracto de OSM de Lima y Callao de BBBike
(`pipeline/scripts/osm/descargar_lima.py`; no está en el repo). Cada calle es
una polilínea: nodos (lat, lon) unidos por rectas. Las curvas se aproximan
con más nodos (un nodo cada ~12 m en una curva, cada ~4 m en una rotonda);
el error de la cuerda frente a la curva real es de 0,15 a 0,6 m, menor que la
precisión del mapeo (2–5 m) y que un píxel del mapa. `red_vial.py` arma el
grafo con las vías por donde va un bus y guarda de qué vía es cada tramo
(nombre, id, si es rotonda).

## Del dibujo al recorrido (`pipeline/scripts/osm/recorrido.py`)

El dibujo (Wikiroutes, una relación de OSM, un mapa QR) solo dice por dónde
va la ruta. *Map matching* (modelo oculto de Markov, Viterbi):

1. Un punto del dibujo cada 25 m; para cada uno, los tramos de calle a
   menos de 35 m (hasta 6).
2. Se elige la secuencia de tramos que mejor sigue al dibujo (cerca de cada
   punto) y en la que puntos seguidos están unidos por un camino de la red
   de largo parecido a la recta.
3. Para pegar un dibujo a la calle no se mira el sentido de circulación (el
   bus va por ahí: carril en contraflujo, o el sentido de OSM no es el de
   hoy). Con sentidos, un dibujo correcto daba vueltas de kilómetros (la
   1123 pasaba de 27 a 43 km).
4. Si no hay calle cerca, o dos puntos solo se unen con un rodeo de más del
   doble de la recta (+ 60 m) —una vía nueva, un carril exclusivo, una calle
   que falta en OSM—, se corta y ahí queda el dibujo original («sin calle»).
5. La geometría es la de los nodos, simplificada a 1,5 m como el resto del
   sitio.

Los **pasos** se arman de los tramos elegidos: los consecutivos de una misma
vía (por nombre) o de una misma rotonda se juntan; el giro entre una vía y
la siguiente (izquierda, derecha, sigue, da la vuelta) sale del cambio de
rumbo; en una rotonda se cuentan las salidas que se pasan. Los pasos de
menos de 25 m se juntan con el siguiente.

## Alimentadores (`build_alim_paths.py`)

Los que vienen de una relación de OSM se pegan a la red así (antes, un rulo
corto se cortaba en recta y cruzaba el óvalo: ahora solo se corta un ir y
volver por la misma calle, sin área; una vuelta a un óvalo se queda). Un
circuito cuyos extremos no coinciden se cierra por la red, no en recta. Los
de los mapas QR ya se trazan por la red (`config/alim_trazados.json`). Cada
sentido guarda sus `pasos` y, si los hay, cuántos tramos quedaron
`sin_calle`, en `alimentadores_paths.json`.

## Rutas de Wikiroutes (`build_recorridos.py`)

Cada `route_track_trip<N>.geojson` se pega a la red y se guarda al lado como
`route_track_trip<N>.osm.geojson` (con los pasos en sus propiedades). El
dibujo original no se toca: es de donde se vuelve a calcular. Se usa el
recorrido solo si se parece al dibujo (largo entre 0,85 y 1,15 del original,
a lo más el 30 % sin calle); si no, la ruta sigue con su dibujo y queda en
`pipeline/output/recorridos_reporte.json` para revisarla a mano. Las que lo
usan van marcadas `"osm": true` en `wr_map.json`, y el mapa y «Cómo llegar»
cargan ese archivo.

Orden: después de regenerar `wr_map.json` con los scripts de Wikiroutes,
`python pipeline/scripts/osm/build_recorridos.py --marcar` vuelve a poner las
marcas sin recalcular; con rutas nuevas o un `.pbf` nuevo, sin argumentos
(todas, ~25 min con 4 procesos) o con las claves de las rutas
(`1087-ida 1087-vuelta`).

## Pendiente

- Corregir a mano: hoy se corrige el dibujo de origen. La idea es poder
  corregir un paso («dobla en Z, no en W») y regenerar.
- Mostrar los pasos en la ficha de la ruta.
