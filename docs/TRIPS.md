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

Cambiar `config/catalog.json` **no** requiere regenerarlo: qué rutas entran y
de qué grupo son se decide en el navegador.

## Qué contiene

- **Paraderos**: 9 948, con nombre y distrito. En Wikiroutes, las rutas que
  paran en el mismo lugar comparten el id del paradero, así que cada id es
  un nodo.
- **Rutas**: cada capa de Wikiroutes (`1240-ida`, `1240-vuelta`…), cada
  servicio del Metropolitano en sus dos sentidos (`met:A:ns`, `met:A:sn`;
  los expresos con sus propias estaciones por sentido) y las líneas del
  Metro (`metro:L1:0`, `metro:L1:1`), con sus paraderos en orden.
- **Fuera por ahora**: los Alimentadores del Metropolitano, porque sus
  paraderos no traen orden y varios son circuitos.

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

## Cálculo (`planTrip`)

1. Paraderos a 800 m o menos de A y de B (`ACCESS_MAX_M`). Si A y B están a
   600 m o menos, se sugiere caminar.
2. **Directos**: desde cada paradero cerca de A, cada ruta que pasa por ahí
   se recorre hacia adelante hasta un paradero cerca de B.
3. **Un transbordo**: se precalcula, para cada paradero, la mejor forma de
   terminar el viaje (subir ahí y bajar cerca de B). Luego, desde cada
   paradero de la primera ruta, se busca ese final en el mismo paradero o
   caminando hasta 400 m. Nunca entre la ida y la vuelta del mismo servicio.
4. Se guarda la mejor opción por combinación de rutas. Un transbordo en el
   que alguna de sus rutas ya va directo se descarta, salvo que ahorre 10 min.
5. **Alternativas por tramo**: otras rutas que suben a 150 m o menos de donde
   sube la del tramo y bajan a 150 m o menos de donde baja, sin tardar más del
   40 % (+5 min). Se muestran como "1057 o 1099 o 1200": la que pase primero.
6. **Orden**: primero las **rutas únicas cómodas** (directas con hasta 800 m
   a pie en total) y los transbordos que ahorran al menos 20 min frente a
   ellas; después, el resto. Dentro de cada grupo, por costo: minutos de
   viaje + la caminata otra vez (pesa doble; la del transbordo, triple) +
   20 por transbordo (bajarse, cruzar y esperar otro bus) + la espera de
   cada subida, 10 / (1 + alternativas).
   Calibrado a mano con Canaval y Moreyra → Mariátegui (VES): la 1122
   directa (750 m a pie, ~82 min) va antes que 1057 › 1185 (~80 min, con
   transbordo en Atocongo).
7. Hasta 6 opciones que no se repitan (dos son la misma si en cada tramo
   comparten alguna ruta) y como mucho 2 transbordos que empiecen con las
   mismas rutas. Todas las rutas únicas que cuesten hasta 1,5 veces la
   mejor aparecen.
8. **Metro, Metropolitano y corredores** pesan más: su tiempo a bordo cuenta
   un 20 % menos y su espera es de 4 min (pasan seguido). Si hay una opción
   con ellos que cueste hasta 1,8 veces la mejor, siempre aparece.

Minutos estimados: caminata 75 m/min con 30 % de rodeo, bus 250 m/min
(~15 km/h), Metro y Metropolitano 500 m/min, 3 min por transbordo (bajar
y cruzar). El tramo se dibuja por el trazo de Wikiroutes (Metro y
Metropolitano, entre estaciones). Sin
horarios ni frecuencias: son aproximados y no incluyen la espera.

Pendiente: viajes con 2 transbordos, búsqueda de direcciones
(geocodificación), Alimentadores del Metropolitano.
