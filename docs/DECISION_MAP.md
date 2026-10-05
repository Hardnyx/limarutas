# Mapa de decisiones del usuario

Qué puede hacer una persona en el mapa, en qué situación, y qué debería pasar
según lo que ella esperaría. Es la especificación que verifican las pruebas:
`tests/explore.spec.js` recorre estas acciones en órdenes aleatorios y, después
de cada paso, comprueba los invariantes del final de este documento.

La nueva interfaz es la de todos (`?beta=0` vuelve a la anterior) y tiene las
mismas acciones con otro orden en pantalla; sus diferencias están en
[Nueva interfaz](#nueva-interfaz-beta1).

## Estado que ve el usuario

- **Rutas marcadas** (casillas del sidebar) → rutas dibujadas en el mapa.
- **Sentido** de cada ruta (Ida/Vuelta, Amb/N/S en el Metropolitano; en los Alimentadores Amb/Ida/Vta: ida del terminal al barrio, vuelta al terminal; por defecto solo la ida). Los paraderos que se dibujan son los del sentido dibujado; los de los Alimentadores, puntitos como los del corredor salvo la estación de partida. Los expresos de un solo sentido no tienen Amb/N/S; cada servicio del Metropolitano muestra su recorrido y horario por sentido.
- **Mostrar paradas** (activado por defecto).
- **Filtro de color** de Transporte público (depuración).
- **Rutas recientes** (hasta 8, se recuerdan en el navegador).
- **Panel "Rutas en este punto"**: cerrado, abierto por hover, fijado por clic, o de un paradero.
- **Vista** del mapa y **tema** (claro/oscuro).
- **Nombre de las rutas**: la gente no conoce el código de 4 dígitos sino el nombre popular ("EVIFASA B", "la 36", "El Chosicano"). El maestro trae `nombre_popular` (`pipeline/scripts/nombres_populares.py`): nombre curado con fuente (`config/nombres_populares.json`) › apodo del alias › número del alias › marca o empresa + letra (una "La C" sola es ambigua) › empresa › código. Es el título de la ruta (con la empresa detrás si no la nombra: "La 36 · 36 San Martín de Porres") y el chip de Cómo llegar y del panel del paradero (si pasa de 18 letras, el alias corto); el código va aparte ("ruta 1199"). El buscador pone primero la ruta cuyo nombre o alias es exactamente lo escrito ("evifasa b", "la 36", "36").

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
| × | Quita la fila **y la ruta del mapa** (sin la fila, solo se podría apagar buscándola en su lista) |
| Limpiar | Borra el historial; las rutas que están en el mapa se quedan (para quitarlas está Limpiar de "En el mapa"). Solo aparece si hay filas que no están en el mapa |
| Recargar la página | Las filas vuelven, desmarcadas |

### Opciones (en la nueva interfaz, menú ⚙ del mapa)

| Acción | Situación | Resultado esperado |
|---|---|---|
| Apagar "Mostrar paradas" | — | Se ocultan todos los paraderos |
| Encender "Mostrar paradas" | Más de 30 rutas visibles | Diálogo: Mostrar paraderos · Cancelar (recomendado) |
| Auto-centrar | Apagado | Marcar rutas o grupos no mueve la vista (elegir un paradero sí) |
| Mapa claro / oscuro | — | Cambia el fondo; el botón activo queda marcado |

## Nueva interfaz (`?beta=1`)

Es la predeterminada. `?beta=0` vuelve a la interfaz anterior (queda recordado
en el navegador) y `?beta=1` regresa a la nueva. `?debug=1` muestra además la
depuración de color.

| Acción | Situación | Resultado esperado |
|---|---|---|
| Abrir la página | — | Pestaña **Cómo llegar** activa; en Rutas, el buscador arriba del sidebar |
| Abrir un enlace con `?desde=lat,lon&hasta=lat,lon` | — | Cómo llegar con ese viaje ya calculado |
| Pestaña Cómo llegar | — | Aviso de que viene pronto y cómo buscar mientras tanto; ←/→ cambian de pestaña |
| Marcar o desmarcar rutas | — | "En el mapa (N)" muestra cuántas hay; cada sección, cuántas de las suyas (`1/440`) |
| Limpiar (En el mapa) | Con rutas | Igual que "Desmarcar todo"; el bloque desaparece al quedar en 0 |
| ⚙ (esquina del mapa) | — | Abre Mostrar paradas, Auto-centrar y Tema; se cierra con Esc, clic fuera o ⚙ |
| Esc | Ajustes abiertos | Cierra solo los ajustes (el panel de rutas, si estaba abierto, sigue) |

### Cómo llegar

| Acción | Situación | Resultado esperado |
|---|---|---|
| Escribir en Origen o Destino | — | Paraderos que coinciden (nombre · distrito · rutas); si ninguno tiene todas las palabras, los que más coinciden ("ovalo higuereta" → Higuereta). ↑/↓ y Enter eligen |
| 📍 | — | El siguiente clic en el mapa pone ese punto donde se tocó ("Cerca de…"): puede ser la casa o el trabajo, y la caminata a los paraderos ya se cuenta. Si cae casi encima de un paradero (14 px en pantalla, 60 m como mucho) se ajusta a él y lleva su nombre. No abre el panel de rutas. Esc cancela. Arrastrar el pin sigue la misma regla |
| Elegir el primer extremo | El punto no se ve | El mapa va a él; el foco pasa a Destino |
| Tener A y B | — | Hasta 6 opciones distintas. Un transbordo va antes que las rutas únicas solo si ahorra 20 min o el 20 % del viaje (se compara con la ruta única cómoda más rápida o, si no hay, con la más rápida). Cada tramo muestra la ruta principal con su nombre completo y, si otras hacen lo mismo, "o" y la más rápida de ellas (el resto, "+N" y en los pasos). Una etiqueta explica el orden: "Recomendada" (la primera), "Más rápida" y "Menos caminata" si son otras. Primero las rutas únicas con poca caminata (hasta 800 m) y los transbordos que ahorran 20 min o más; luego el resto, por un costo que suma tiempo, caminata (doble), transbordos (20 min) y espera (menor si varias rutas hacen el tramo). Todas las rutas únicas razonables aparecen, y lo mismo con Metro, Metropolitano o corredor (que pesan más: pasan seguido). Cada ruta se muestra con su código y su nombre (empresa · alias, "Corredor Rojo", "Metropolitano · Ruta C"). Cada tramo va en una línea (código, nombre y "+N" si otras rutas hacen lo mismo; basta tomar la primera que pase) y el tiempo a la derecha; los pasos solo en la opción elegida. La primera opción queda elegida, con sus pasos y dibujada por las calles |
| A y B a 600 m o menos | — | "Te conviene caminar" |
| Clic en otra opción | — | Se expande y se dibuja; la anterior se pliega |
| Arrastrar el pin A o B | — | Se vuelve a calcular |
| ⇅ Invertir | — | Cambia A por B y recalcula |
| Sin A ni B | — | Una ayuda corta: escribir un paradero o 📍, "Salir de aquí / Llegar aquí" y la Salida |
| Texto sin paraderos | — | "Ningún paradero con ese nombre…" con la sugerencia de usar 📍 |
| Salida | "Ahora (8:05)" (por defecto) o un día y hora | Solo entran los servicios del Metropolitano que circulan a esa hora (hora de Lima). El paso muestra su horario; si uno serviría pero no circula, se avisa "En otro horario también te sirve" con su horario; tocarlo pone la Salida en su próximo horario y recalcula |
| Incluir rutas antiguas | — | Recalcula incluyéndolas; sus pasos dicen "Ruta antigua · podría no circular" |
| Sin opciones | Hay con rutas antiguas | Botón "Buscar también con rutas antiguas" |
| Ver estas rutas completas | — | Las marca y pasa a la pestaña Rutas |
| Cambiar de pestaña | — | Cada una muestra lo suyo: en Cómo llegar solo el viaje; en Rutas solo las rutas marcadas (siguen marcadas mientras tanto) |
| × en un campo | — | Borra ese extremo, su pin y el resultado |
| (La URL) | — | Siempre refleja A y B (`?desde=…&hasta=…`); borrar un extremo lo quita |
| Compartir este viaje | Opción elegida | Copia el enlace (en celular, abre el menú de compartir) |
| Salir de aquí / Llegar aquí | Panel de un paradero | Pasa a Cómo llegar con ese paradero como origen o destino |

Los tiempos son estimados por distancia (bus ~15 km/h; Metro y
Metropolitano ~30 km/h; caminata con 30 % de rodeo) e incluyen la espera
(la mitad del intervalo de paso; ver docs/TRIPS.md). Un transbordo integrado
de la ATU (todos los tramos en Metro, Metropolitano o corredor) va primero si
es más rápido que el mejor directo y no hace caminar más de 500 m extra.

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
- **Paraderos con el mismo nombre** (hay decenas de «Universitaria»): en el buscador y en las sugerencias de «Cómo llegar» se muestran con su cruce («Universitaria con La Marina», «Trébol Javier Prado con Evitamiento», «Bypass Javier Prado con Aviación», «Plaza Norte · Alfredo Mendiola»), de todas las calles de OSM (`pipeline/scripts/cruces.py`, sobre `data/raw/osm/Lima.osm.pbf`). Trébol: hay una rampa en bucle; bypass: una de las dos avenidas pasa en puente o túnel sobre la otra. Buscar el nombre los trae a todos y el nombre con el cruce, ese. El cruce se encuentra por cualquiera de sus calles y se muestra empezando por la buscada («javier prado» → «Javier Prado con Brasil»); los dos paraderos de un mismo cruce son un solo resultado. En el mapa y en los pasos del viaje el paradero sigue llamándose como se llama.
- **Nombres con que se conoce cada calle** (`config/nombres_calles.json`): se muestra el nombre corto o popular («Riva Agüero», «Sucre», «Larco», «Colonial», «Wilson», «Colmena», «Huaylas»; algunos solo en su tramo) y se busca también por el oficial («Óscar R. Benavides», «Garcilaso de la Vega»); dos nombres de la misma calle nunca forman un cruce. Paraderos famosos con alias («22» → Kilómetro 22 de Túpac Amaru) y cruces con nombre propio (`config/cruces_nombres.json`: Trébol de Javier Prado, Bypass Las Torres, Puente Atocongo…), que se dicen en el resultado cuando se buscó por ellos.
- **En el mapa (nueva interfaz)**: el contador se despliega en el desglose de lo que está dibujado: una fila por ruta (con su sentido; tocarla lleva el mapa a ella, × la quita) o una por un grupo entero (todo el Metropolitano). Se recuerda si se dejó abierto (la primera vez, cerrado en el celular). Recientes es el historial: las que ya no están en el mapa, para volver a marcarlas.
- **Listas largas abiertas** (Transporte público, Rutas antiguas): su título y su filtro quedan arriba al bajar; al cerrarla desde ahí, la lista vuelve a su título.
- **Paraderos formales** (corredores y alimentadores): puntos sólidos del color de la ruta con borde blanco; los de las rutas de la pista, blancos con borde de color. Tocar uno abre «Rutas en este punto» con los corredores y alimentadores que paran ahí.
- **Buscador del mapa**: los resultados van en dos grupos con título, Rutas y Paraderos. Primero el que parece buscarse: un código o alias de ruta («1240», «la 36», «AN-19», «expreso 5») va a Rutas; un lugar que coincide claramente, a Paraderos. Elegir un paradero muestra sus rutas en el panel (ya no se mezclan en la lista). Con las flechas la lista se desplaza con el elegido y salta los títulos.

