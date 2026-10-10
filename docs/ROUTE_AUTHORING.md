# Recorridos editables

El motor de edición se encuentra en `pipeline/authoring`. Los scripts y los
datos publicados existentes mantienen sus contratos. Los resultados nuevos
se preparan en `pipeline/temp/authoring`; no se escriben implícitamente en
`data/processed` ni en `pipeline/output`.

## Red de calles

```sh
python3 pipeline/scripts/osm/descargar_lima.py
python3 -m pip install osmium==4.1.1
python3 -m pipeline.authoring.network
```

La red utiliza coordenadas GeoJSON `[longitud, latitud]`, conserva todos los
nodos geométricos y referencia cada segmento por `id_vía:índice`. Estos
identificadores pertenecen a una versión de red, identificada por SHA-256
del extracto y la versión de la política de interpretación. No son identificadores permanentes entre distintas versiones
de OSM. Los tramos compartidos conservan exactamente sus coordenadas.

La política del motor permite vías exclusivas de buses y excepciones de
acceso explícitas. Respeta sentidos para buses y restricciones de giro con
nodo intermedio. Las restricciones condicionales o con vías intermedias
se conservan como pendientes de interpretación: un recorrido que las
atraviese necesita revisión y no debe aprobarse automáticamente.

Las calzadas separadas (`highway=busway`) mantienen su geometría propia.
Las vías de acceso reservado se distinguen de los carriles señalizados
dentro de una calzada (`busway:*`, `bus:lanes`, `lanes:bus`, y variantes PSV).
Estas últimas etiquetas no aportan una geometría independiente del carril:
se conservan sin fabricar desplazamientos laterales. Un bus convencional
no puede construir un recorrido por una calzada reservada salvo que se
indique una autorización explícita por vía. Los perfiles BRT/corredor
requieren identificar el sistema correspondiente; el nombre comercial de
una ruta por sí solo no autoriza el uso de una infraestructura reservada.

`docs/osm/authoring_network.json` registra el extracto verificado y las
medidas obtenidas durante su preparación. La distribución de longitudes
incluye segmentos rectos y curvos; no certifica la precisión de todas las
curvas de Lima.

## Compatibilidad

Las referencias de pruebas fijan seis sentidos publicados, incluidos los
GeoJSON originales, ajustados, paraderos y referencias de vías. Una
regeneración deliberada debe revisarse en un commit independiente y
actualizar explícitamente las referencias correspondientes. Las funciones
de horarios, selección y planificación siguen cubiertas por las pruebas
de dominio y navegador existentes.

## Arrancar el editor

Desde la raíz del repositorio, después de preparar la red:

```sh
python3 -m pipeline.authoring serve
```

Abre `http://127.0.0.1:8081/editor.html`. El servicio carga la red una vez;
la preparación y el uso del extracto completo requieren memoria considerable
(del orden de 1–2 GB en este piloto). No se descarga OSM en cada edición.

El editor permite abrir rutas existentes, importar trazados con paraderos,
crear rutas seleccionando calles reales, sustituir un intervalo sin cambiar
el resto, arrastrar pasos y paraderos, deshacer y cancelar cambios. Al
arrastrar un paso se elige explícitamente la calzada cercana. La fuente se
muestra en gris; el recorrido ajustado, en azul; las calzadas reservadas,
en morado; los tramos sin resolver, en rojo.

Los paraderos conservan sus coordenadas fuente y su identidad. El vínculo
con el recorrido es una proyección adicional, no un movimiento automático
del paradero. Las posiciones alejadas o fuera de orden bloquean la aceptación.
El perfil BRT/corredor se selecciona por servicio y sistema: no basta con
estar cerca de una avenida para utilizar su calzada segregada.

**El editor y su API funcionan con este servicio local.** El sitio público
está alojado en GitHub Pages y no ejecuta Python. Abrir `editor.html` en ese
sitio muestra cómo iniciar el servicio y deja la edición deshabilitada.
Alojar una API compartida, con autenticación y almacenamiento persistente,
es un despliegue adicional; este cambio no lo presenta como disponible.

## API común para el editor y la automatización

Todas las operaciones reciben JSON y devuelven
`{"version":1,"result":...}`. Se pueden ejecutar por HTTP:

```sh
curl -sS http://127.0.0.1:8081/api/v1/operations \
  -H 'Content-Type: application/json' \
  -d '{"operation":"resolve","query":{"kind":"street","query":"Av. Brasil"}}'
```

O sin HTTP, utilizando exactamente el mismo motor:

```sh
python3 -m pipeline.authoring call --request solicitud.json
```

El comando carga la red por invocación; para varias operaciones conviene
mantener el servicio HTTP abierto o instanciar `Service` desde Python.

| Operación | Entrada principal | Resultado |
| --- | --- | --- |
| `health`, `catalog` | Consulta opcional del catálogo | Versión de red y rutas/borradores disponibles |
| `resolve` | `query.kind`: `street`, `intersection`, `stop` o `point` | Candidatos con identidad, geometría y evidencia |
| `import-existing` | `routeId` del catálogo | Borrador de los archivos actuales; respeta una definición editada publicada |
| `import` | `bundle` con `id`, `name`, `direction`, `track`, `stops` y opcionalmente `vias`, `matched`, `corrections`, `provenance` | Borrador con copia inmutable de la fuente |
| `new` | `id`, `name`, `direction`, perfil opcional | Borrador vacío |
| `build` | `request` con identidad, `anchors`, `stops`, perfil y restricciones de itinerario | Propuesta sobre segmentos OSM |
| `rebuild`, `replace` | Ruta y pasos nuevos, o intervalo de índices del recorrido | Edición completa o limitada al intervalo |
| `match`, `validate` | Ruta o identificador guardado | Ajuste explícito de la fuente, o validación sin cambiarla |
| `save`, `accept` | Ruta o identificador, `expectedRevision` | Nueva revisión; aceptar exige cero avisos |
| `export` | Ruta guardada aceptada; `preview:true` permite revisar un borrador | Paquete compatible con checksums |
| `restore` | Definición editable de un archivo exportado | Borrador que necesita nueva revisión; rechaza sobrescribir un identificador guardado |
| `propose-update`, `apply-update` | Identificador guardado y nuevo `bundle` fuente | Comparación o aplicación explícita de una actualización |

Un paso de construcción puede ser un nodo OSM (`{"node":123}`), una
fracción de un segmento (`{"edge":"123:0","fraction":0.5}`), o un cruce
(`{"intersection":["calle A","calle B"]}`). Los números de estos ejemplos
son ilustrativos: se utilizan los identificadores devueltos por `resolve`.
Un cruce con varias calzadas requiere `choice`, con el nodo elegido; la API
responde con los candidatos y estado HTTP 422 si falta esa elección.

Los paraderos de catálogo se especifican con `catalogId`; también se aceptan
nodos OSM suministrados o coordenadas verificadas con identidad y nombre.
`viaWays` fija avenidas en orden; `allowedWays` limita el conjunto de vías.
El perfil es `{"mode":"mixed"}`, o `{"mode":"brt","system":"Metropolitano"}`
o corredor con su sistema. `reservedWays` admite autorizaciones explícitas
por identificador de vía. No se deduce una autorización por proximidad.

Una lista de paraderos **no demuestra por qué avenidas circula un servicio**.
Para crear una ruta operacional hace falta indicar su itinerario y resolver
las ambigüedades. El motor puede proponer un camino entre pasos, pero siempre
queda como borrador hasta ser revisado. Esto permite que un agente construya
rutas por la API usando calles y paraderos identificados, sin inventar
geopuntos ni escribir directamente los archivos publicados.

## Revisar y publicar sin romper el pipeline

1. Importar o construir en el espacio de borradores.
2. Resolver avisos de dirección, giro, calzada, continuidad y paraderos.
3. Guardar y aceptar esa revisión; cualquier edición posterior revoca su aceptación.
4. Exportar a una carpeta nueva aislada:

   ```sh
   python3 -m pipeline.authoring export 1087-ida \
     --directory pipeline/temp/authoring/export-1087-ida
   ```

   El ejemplo requiere que ese identificador se haya guardado y aceptado.
   `--preview` produce un paquete de revisión que no puede publicarse.

5. Revisar el diff de datos en un commit propio y colocar **juntos** el
   `.osm.geojson`, los paraderos y la definición `.route.json` en la carpeta
   correspondiente. Conservar el `.geojson` original existente. Activar
   `osm:true` en el catálogo para esa dirección. Una ruta nueva necesita
   además los metadatos de catálogo existentes; el editor no inventa una
   identidad Wikiroutes ni una clasificación oficial del servicio.
6. Regenerar los índices afectados y el grafo de viajes cuando cambien
   paraderos; ejecutar las validaciones y pruebas antes del despliegue.

La definición `.route.json` aceptada pasa a ser la fuente operacional de
ese recorrido. El `.geojson` original conserva la evidencia de importación;
el mapa carga el `.osm.geojson` derivado. El regenerador antiguo reconoce
la definición nueva y la respeta incluso con `--rehacer`. Antes de modificar
archivos comprueba fuentes, paraderos, versión de red y aceptación. Si algo
cambió, se detiene para pedir una actualización explícita.

La validación estática del sitio verifica la correspondencia entre la
revisión aceptada, la geometría, los paraderos y la copia fuente sin requerir
el PBF en CI. Los recorridos antiguos sin `.route.json` siguen utilizando el
comportamiento existente. Leaflet conserva todos los vértices de los
recorridos canónicos nuevos (`smoothFactor:0`), evitando que simplifique por
separado los tramos compartidos.

## Nuevas descargas de Wikiroutes

El adaptador acepta el mismo paquete `track` + `stops` tanto para datos ya
descargados como para futuras salidas del scraper. El scraper no se modifica
en esta fase. Sus archivos nuevos deben prepararse en una carpeta de entrada
separada antes de reemplazar datos publicados; sustituir primero los archivos
operacionales evitaría la comparación y la comprobación previa lo rechazará.

Para una ruta guardada se utiliza `propose-update`. Se comparan tres estados:
la fuente importada anterior, las ediciones locales y la descarga nueva.
Los paraderos se identifican por ID y número de visita, no solo por nombre.
Se conservan cambios locales y se incorporan cambios independientes. Un
mismo campo modificado en ambos lados, una eliminación que afecte una edición,
un cambio de orden ambiguo o un trazado fuente que compita con un recorrido
editado generan conflictos explícitos.

Cada conflicto tiene una clave y se resuelve con
`choices:{"clave":"local"}` o `"incoming"`. Hay que volver a solicitar la
propuesta con esas decisiones. `apply-update` requiere `proposalHash` de
esa propuesta y `expectedRevision`; no acepta propuestas alteradas ni una
revisión guardada más reciente. La operación crea una revisión en el
historial, conserva la fuente anterior allí y revoca la aceptación.

El editor ofrece este flujo en **Revisión → Actualizar desde una nueva
fuente**: compara el archivo, muestra la descarga en naranja y permite
resolver conflictos o descartar la propuesta. Aplicarla no publica la ruta;
se revisa de nuevo antes de aceptar y exportar.

Sin un ID estable de paradero, la identidad de respaldo depende de sus
datos fuente. Un cambio puede aparecer como eliminación y alta; no se
fusiona por nombre ni cercanía a escondidas. OSM también cambia sus IDs de
segmento y topología entre versiones. Migrar a otra versión de la red es
una operación separada que requiere revisión; no se reinterpreta un ID viejo
contra un extracto nuevo.

## Verificación del piloto

```sh
python3 -m pipeline.authoring.audit
python3 -m unittest discover -s pipeline/tests
python3 pipeline/run.py validate
npm test
```

`docs/osm/authoring_pilot.json` registra seis sentidos reales importados sin
modificar datos publicados, sus paraderos preservados y los segmentos OSM
compartidos. Incluye una construcción sobre una calzada segregada real del
Metropolitano y el rechazo del mismo tramo para un bus de tránsito mixto.
Los avisos del piloto son trabajo de revisión de datos, no rutas aprobadas.
Ninguno se publica automáticamente por haber importado o ajustado su fuente.
