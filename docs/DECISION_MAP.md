# Mapa de decisiones del usuario

Qué puede hacer una persona en el mapa, en qué situación, y qué debería pasar
según lo que ella esperaría. Es la especificación que verifican las pruebas:
`tests/explore.spec.js` recorre estas acciones en órdenes aleatorios y, después
de cada paso, comprueba los invariantes del final de este documento.

## Estado que ve el usuario

- **Rutas marcadas** (casillas del sidebar) → rutas dibujadas en el mapa.
- **Sentido** de cada ruta (Ida/Vuelta, o Amb/N/S en Metropolitano y Alimentadores).
- **Mostrar paradas** (activado por defecto).
- **Filtro de color** de Transporte público (depuración).
- **Rutas recientes** (hasta 8, se recuerdan en el navegador).
- **Panel "Rutas en este punto"**: cerrado, abierto por hover, fijado por clic, o de un paradero.
- **Vista** del mapa y **tema** (claro/oscuro).

## Acciones

### Sidebar

| Acción | Situación | Resultado esperado |
|---|---|---|
| Marcar una ruta | — | Se dibuja en su sentido elegido; si "Auto-centrar" está activo, el mapa va a ella; entra primera en Recientes |
| Desmarcar una ruta | — | Deja de dibujarse (también si todavía estaba cargando); la vista no se mueve |
| Elegir sentido (Ida/Vuelta, N/S…) | Ruta marcada | Cambia el trazo; **la vista no se mueve** |
| Elegir sentido | Ruta sin marcar | Se marca y se muestra en ese sentido (igual en todos los sistemas) |
| Marcar un grupo | Pocas rutas o paraderos apagados | Marca todas sus rutas visibles y encuadra el conjunto |
| Marcar un grupo | Más de 30 rutas Wikiroutes y paraderos activos | Diálogo: **Mostrar sin paraderos** (recomendado) · Mostrar con paraderos · Cancelar (o Esc / clic fuera). Mientras está abierto la casilla sigue sin marcar |
| Desmarcar un grupo | — | Desmarca sus rutas; la vista no se mueve |
| Grupo anidado (Metropolitano ⊃ Alimentadores ⊃ Norte/Sur) | — | El padre queda marcado, desmarcado o a medias según todas sus rutas |
| Desmarcar todo | — | Ninguna ruta marcada ni dibujada; se cierra el panel de rutas o paradero |
| Abrir/cerrar sección | Clic en el título | Solo pliega o despliega; no marca nada |
| Filtro de color (Transporte público) | — | Oculta las rutas que no corresponden y las desmarca si estaban marcadas; la casilla del grupo solo afecta a las visibles |

### Buscador

| Acción | Situación | Resultado esperado |
|---|---|---|
| Escribir código, alias o empresa | — | Sugerencias; solo rutas que existen en alguna lista |
| Elegir una ruta (clic o Enter) | Sin marcar | Se marca, el mapa va a ella y entra en Recientes |
| Elegir una ruta | Ya marcada | El mapa va a ella y pasa a ser la primera en Recientes |
| Escribir un paradero con nombre único | — | Primero el paradero (distrito y cantidad de rutas), debajo las rutas que paran ahí |
| Escribir un paradero con nombre repetido | — | Cada lugar por separado, con su distrito y "cerca de…" si hay varios en el mismo distrito |
| Elegir un paradero | — | El mapa va al paradero (marcador naranja) y se abre su panel con todas sus rutas |
| Limpiar búsqueda | — | Se vacía el campo y se cierran las sugerencias |
| Esc en el buscador | — | Se cierran las sugerencias (el texto queda) |

### Mapa

| Acción | Situación | Resultado esperado |
|---|---|---|
| Pasar el mouse por un paradero | Paradas activas | Su nombre; el panel de rutas no cambia |
| Tocar / clic en un paradero | — | Su nombre queda visible hasta tocar otra parte |
| Pasar el mouse por rutas | 2 o más superpuestas | Panel "Rutas en este punto" con sus códigos (tras ~150 ms quieto) |
| Pasar el mouse por rutas | Una sola | Sin panel |
| Clic en una línea | — | Fija el panel en ese punto |
| Clic donde no hay rutas | — | Cierra el panel |
| Esc | Panel abierto | Cierra el panel (y el marcador del paradero) |
| Zoom | Panel sin fijar | Se cierra |

### Panel "Rutas en este punto" / de paradero

| Acción | Resultado esperado |
|---|---|
| Pasar por un código | Detalle de la ruta y se resalta en el mapa (las demás del punto se atenúan) |
| Agregar a recientes | Entra en Recientes sin cambiar el mapa |
| Ver solo esta | Desmarca todo y deja solo esa ruta |
| Mostrar / Ocultar (paradero) | Marca o desmarca esa ruta |
| Mostrar las N rutas (paradero) | Marca todas; con más de 30 y paraderos activos, el mismo diálogo que los grupos |
| Plegar / Cerrar | Pliega el contenido / cierra el panel |

### Rutas recientes

| Acción | Resultado esperado |
|---|---|
| Casilla de una fila | Igual que la casilla de la ruta en su lista (y se sincronizan); no reordena |
| Ida/Vuelta en una fila | Igual que en la lista principal; la vista no se mueve |
| × | Quita la fila; la ruta sigue como estaba |
| Limpiar | Vacía la lista |
| Recargar la página | Las filas vuelven, desmarcadas |

### Opciones

| Acción | Situación | Resultado esperado |
|---|---|---|
| Apagar "Mostrar paradas" | — | Se ocultan todos los paraderos |
| Encender "Mostrar paradas" | Más de 30 rutas visibles | Diálogo: Mostrar paraderos · Cancelar (recomendado) |
| Auto-centrar | Apagado | Marcar rutas o grupos no mueve la vista (elegir un paradero sí) |
| Mapa claro / oscuro | — | Cambia el fondo; el botón activo queda marcado |

## Invariantes (se verifican después de cada paso)

1. Cada casilla de grupo está marcada, desmarcada o a medias según **todas** sus rutas visibles.
2. Una ruta Wikiroutes se dibuja **si y solo si** alguna casilla marcada la pide, en el sentido elegido.
3. Metropolitano, Alimentadores, Corredores y Metro solo se dibujan si su casilla está marcada.
4. Hay paraderos en el mapa solo con "Mostrar paradas" activo, y solo de rutas visibles.
5. Cada fila de Recientes muestra la misma casilla y el mismo sentido que su ruta.
6. Nunca hay dos diálogos abiertos.
7. No hay errores de JavaScript.
