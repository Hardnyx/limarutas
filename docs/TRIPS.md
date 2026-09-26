# Datos para "Cómo llegar"

Base para calcular viajes de A a B. Este paso solo prepara los datos; el
cálculo y su interfaz vienen después.

## Archivos

| Archivo | Qué es |
|---|---|
| `pipeline/scripts/trips/build_trip_graph.py` | Genera el grafo (unos 5 s) |
| `pipeline/output/trip_graph.json` | Paraderos y, por ruta y sentido, los paraderos en orden (1,8 MB; ~0,4 MB comprimido) |
| `assets/js/tripData.js` | Lo carga en el navegador y le agrega grupos, caminatas y búsqueda de paraderos cercanos |

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
