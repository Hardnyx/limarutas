# Mapa de decisiones del usuario

Qué puede hacer una persona en el mapa, en qué situación, y qué debería pasar
según lo que ella esperaría. Es la especificación que verifican las pruebas:
`tests/explore.spec.js` recorre estas acciones en órdenes aleatorios y, después
de cada paso, comprueba los invariantes del final de este documento.

La nueva interfaz (`?beta=1`) tiene las mismas acciones con otro orden en
pantalla; sus diferencias están en [Nueva interfaz](#nueva-interfaz-beta1).

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
| Filtro de lista (Transporte público, Rutas antiguas; solo en la nueva interfaz) | — | Oculta las rutas que no coinciden (código, empresa, sigla, alias, distritos), **sin desmarcarlas**: siguen en el mapa. La casilla del grupo solo afecta a las visibles. Esc limpia el filtro |

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

### Opciones (en la nueva interfaz, menú ⚙ del mapa)

| Acción | Situación | Resultado esperado |
|---|---|---|
| Apagar "Mostrar paradas" | — | Se ocultan todos los paraderos |
| Encender "Mostrar paradas" | Más de 30 rutas visibles | Diálogo: Mostrar paraderos · Cancelar (recomendado) |
| Auto-centrar | Apagado | Marcar rutas o grupos no mueve la vista (elegir un paradero sí) |
| Mapa claro / oscuro | — | Cambia el fondo; el botón activo queda marcado |

## Nueva interfaz (`?beta=1`)

Se activa con `?beta=1` (queda recordada en el navegador) y se apaga con
`?beta=0`. `?debug=1` muestra además la depuración de color.

| Acción | Situación | Resultado esperado |
|---|---|---|
| Abrir la página | — | Pestaña **Rutas** activa; buscador arriba del sidebar |
| Pestaña Cómo llegar | — | Aviso de que viene pronto y cómo buscar mientras tanto; ←/→ cambian de pestaña |
| Marcar o desmarcar rutas | — | "En el mapa (N)" muestra cuántas hay; cada sección, cuántas de las suyas (`1/440`) |
| Limpiar (En el mapa) | Con rutas | Igual que "Desmarcar todo"; el bloque desaparece al quedar en 0 |
| ⚙ (esquina del mapa) | — | Abre Mostrar paradas, Auto-centrar y Tema; se cierra con Esc, clic fuera o ⚙ |
| Esc | Ajustes abiertos | Cierra solo los ajustes (el panel de rutas, si estaba abierto, sigue) |

### Celular (pantallas de hasta 700 px)

El sidebar es una hoja que sube desde abajo, con tres alturas: **asomada**
(pestañas, buscador y "En el mapa"), **media** (al abrir) y **completa**.

| Acción | Resultado esperado |
|---|---|
| Tocar la manija | Alterna asomada ↔ media |
| Arrastrar la manija | Sigue al dedo y al soltar queda en la altura más cercana (con impulso) |
| ↑ / ↓ con la manija enfocada | Sube o baja una altura |
| Tocar el buscador | Completa (hay espacio para sugerencias y teclado) |
| Elegir una ruta o un paradero | Asomada; la ruta se encuadra en la parte visible del mapa y el paradero queda sobre el panel de rutas |
| Tocar el mapa | Asomada |
| Pestaña con la hoja asomada | Media |

El zoom y los créditos del mapa suben con la hoja (con la hoja completa se
ocultan) y el panel "Rutas en este punto" queda justo encima de ella. En la
interfaz actual, en celular, el sidebar y el buscador ocupan el ancho de la
pantalla sin salirse.

Orden de las secciones: Metro, Metropolitano, Corredores, Transporte público
("Buses con ruta autorizada por la ATU"), AeroDirecto, Otros, Rutas antiguas
("Sin autorización vigente de la ATU; algunas podrían ya no circular").

## Invariantes (se verifican después de cada paso)

1. Cada casilla de grupo está marcada, desmarcada o a medias según **todas** sus rutas visibles (las ocultas por un filtro no cuentan).
2. Una ruta Wikiroutes se dibuja **si y solo si** alguna casilla marcada la pide, en el sentido elegido.
3. Metropolitano, Alimentadores, Corredores y Metro solo se dibujan si su casilla está marcada.
4. Hay paraderos en el mapa solo con "Mostrar paradas" activo, y solo de rutas visibles.
5. Cada fila de Recientes muestra la misma casilla y el mismo sentido que su ruta.
6. Nunca hay dos diálogos abiertos.
7. No hay errores de JavaScript.
