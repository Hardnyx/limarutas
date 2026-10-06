# Recorridos por la red de calles

Cada ruta deja de ser un dibujo y pasa a ser un **recorrido por la red de
calles de OpenStreetMap**: la secuencia de vías y nodos de OSM por la que
pasa el bus. De ahí salen su geometría (la misma del mapa de fondo, que
también es de OSM: entra a los óvalos por el anillo, sigue la curva de la
avenida) y sus pasos («por Av. X 420 m, a la derecha en Av. Y, en el óvalo
toma la 2.ª salida…»), que se muestran en la ficha de la ruta (botón
«Recorrido») y sirven para corregirla.

OSM es el equivalente abierto de la red interna de Google Maps o Waze
(segmentos de calle con sus nodos, sentidos, rotondas, nombres), con
licencia ODbL: el mapa muestra «© OpenStreetMap contributors» y los
recorridos que salen de ella quedan bajo esa misma licencia.

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

Tres archivos por sentido, en la carpeta de la ruta:

| Archivo | Qué es |
| --- | --- |
| `route_track_trip<N>.geojson` | El dibujo de Wikiroutes. No se toca. |
| `route_track_trip<N>.vias.json` | **El recorrido**: la fuente. Sale de pegar el dibujo a la red una vez. |
| `route_track_trip<N>.osm.geojson` | Lo que carga el mapa: la línea (los nodos del recorrido, con sus correcciones) y sus pasos. |

`.vias.json` guarda, por tramo pegado a la red, su primer nodo y la lista de
vías de OSM que recorre: `[id de la vía, cuántos tramos de ella (+ en el
orden de la vía, − al revés)]`; cada vía empieza donde terminó la anterior.
Con la red se rehacen los nodos exactos (unos 3 KB por ruta, el mapa no lo
descarga). Lleva la fecha del extracto de OSM. Si con un `.pbf` nuevo una
vía ya no está o dejó de unirse (alguien la editó en OSM), esa ruta se
vuelve a pegar desde el dibujo, sola, y el reporte lo dice
(`"origen": "osm cambió"`).

Se usa el recorrido solo si se parece al dibujo (largo entre 0,85 y 1,15 del
original, a lo más el 30 % sin calle; con correcciones, solo lo segundo); si
no, la ruta sigue con su dibujo y queda en
`pipeline/output/recorridos_reporte.json` para revisarla. Las que lo usan van
marcadas `"osm": true` en `wr_map.json`, y el mapa y «Cómo llegar» cargan ese
archivo.

```
python pipeline/scripts/osm/build_recorridos.py               # todas, desde sus .vias.json (~1 min)
python pipeline/scripts/osm/build_recorridos.py 1087-ida      # algunas
python pipeline/scripts/osm/build_recorridos.py --rehacer     # volver a pegar los dibujos (~20 min)
python pipeline/scripts/osm/build_recorridos.py --marcar      # tras regenerar wr_map.json
```

Una ruta nueva (sin `.vias.json`) se pega sola en la siguiente corrida.

## Corregir una ruta (`config/recorridos_correcciones.json`)

No se redibuja: se dice por dónde va. Cada corrección rehace un pedazo del
recorrido, desde el final de un paso hasta el comienzo de otro, por la red:

```json
{
  "ruta": "1087-ida",
  "desde": "Alameda Sur",
  "hasta": "Defensores del Morro",
  "por": ["Alameda San Marcos", "Santa Anita"],
  "nota": "lo que se vio en la calle"
}
```

- `desde` / `hasta`: el número del paso, como sale en la ficha de la ruta, o
  el nombre de su calle (la primera vez que aparece; `"desde_vez": 2` para
  la segunda). Sin `desde`, desde el comienzo; sin `hasta`, hasta el final.
  Los nombres se comparan sin «Av.», «Jr.», «de», tildes ni mayúsculas:
  «Javier Prado» es «Avenida Javier Prado Este».
- `por`: en orden, calles por las que va (al menos 100 m seguidos por cada
  una, no basta cruzarla; `{"calle": "Av. Z", "m": 300}` para otro largo) y
  puntos `[lat, lon]` por donde pasa. Vacío: el camino más corto.
- El camino respeta los sentidos de circulación; si así no hay, sin ellos
  (un carril en contraflujo).
- Si `desde` y `hasta` caen a los dos lados de un pedazo sin calle, lo unen:
  así se arreglan los huecos.

Las correcciones se aplican sobre el recorrido guardado cada vez que se
corre el script; una que ya no calza (cambió el paso al que apunta) se salta
y se avisa. Las de los alimentadores van en `"alimentadores"`
(`"AS-04-ida"`) y se aplican en `build_alim_paths.py`.

## Pendiente

- Revisión automática: contra el sentido de una vía de un solo sentido,
  vueltas en U, salidas raras de un óvalo, tramos sin calle; y las rutas que
  no se pudieron pegar.
