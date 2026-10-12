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
acceso explícitas. Respeta sentidos para buses, restricciones de giro con
nodo intermedio y movimientos a través de una o varias vías intermedias.
Estas últimas se resuelven por topología y sentido: utilizar una vía que
participa en una prohibición no significa realizar el movimiento prohibido.
La memoria del movimiento se conserva al dividirlo con puntos del editor.
Las restricciones condicionales, incompletas o de topología ambigua siguen
bloqueando el recorrido afectado; no se descartan para permitir su aprobación.

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

El inventario reproducible de migración se genera sin modificar el sitio:

```sh
python3 -m pipeline.authoring.inventory --report docs/osm/route_migration.json
```

`legacy-osm` identifica un ajuste anterior y no equivale a `accepted`.
Los trazados propios del Metropolitano y los alimentadores se registran
aparte y se importan mediante su adaptador nativo. El Metro se excluye
de la red vial para buses.

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

### Migrar el itinerario publicado sin cambiar calles

El preparador compara las referencias antiguas con el GeoJSON OSM publicado,
incluidas sus correcciones. Exige reproducir exactamente ese itinerario y
validar sentidos, continuidad, restricciones y todos los paraderos. La nueva
geometría conserva los vértices OSM que antes se simplificaban; no elige un
desvío alternativo para hacer desaparecer una incidencia.

```sh
python3 -m pipeline.authoring.migration 1087-vuelta 206-ida \
  --directory pipeline/temp/authoring/lote-nuevo
python3 -m pipeline.authoring.migration 1087-vuelta 206-ida \
  --directory pipeline/temp/authoring/lote-nuevo --publish-staged
```

La primera operación prepara borradores aceptados y exportaciones fuera del
sitio. La segunda comprueba el lote completo antes de escribir: versión de
red, fuentes, catálogo, correcciones, geometría, revisión y paraderos.
Actualiza únicamente `.osm.geojson` y añade `.route.json`; conserva los bytes
originales de `.geojson`, `.vias.json` y de los paraderos. Si una escritura
falla, revierte las que haya realizado en ese lote. No admite publicar sobre
una definición ya aceptada: las futuras modificaciones usan el editor y su
proceso de revisión.

Con la política `bus-v5`, 802 de los 4098 sentidos Wikiroutes están
validados y publicados con definición canónica. Otros 11 conservan su
aprobación histórica, pero la nueva auditoría detecta restricciones sin
resolver y los registra como `blocked-revalidation`. Los 3285 restantes
requieren revisar incidencias de fuente, sentidos, giros o paraderos.
`docs/osm/route_migration.json` registra el estado por sentido. Las fuentes,
los paraderos y las referencias legacy conservan sus bytes originales.

La política incorpora miembros de relaciones BRT OSM para identificar
conexiones de servicio sin nombre, como el túnel de Estación Central.
La evidencia de esas relaciones queda registrada por vía; no habilita la
calzada para buses de tránsito mixto ni ignora prohibiciones explícitas de bus.
Las restricciones con vías y nodos intermedios se resuelven conjuntamente;
los movimientos ambiguos siguen bloqueados. Para revalidar la misma
geometría cuando cambia la política, sin cambiar el extracto:

```sh
python3 -m pipeline.authoring.policy
python3 -m pipeline.authoring.policy --publish
python3 -m pipeline.authoring.audit_all
python3 -m pipeline.authoring.native
```

El adaptador permite abrir los 83 sentidos nativos en el editor/API.
Los 31 sentidos del Metropolitano están validados sobre macrorrutas
compartidas; AS-04 (Villa El Salvador) tiene sus dos sentidos reconstruidos
y validados sobre conexiones dirigidas. Los otros 50 sentidos de alimentadores conservan sus trazados fuente y requieren
revisión de geometría y restricciones. `docs/osm/native_bus_audit.json`
registra sus incidencias. Esta validación no certifica la vigencia comercial
de los servicios.

### Macrorrutas del Metropolitano

El generador construye cuatro trazados continuos OSM: A/B en ambos sentidos.
Cada servicio regular o expreso es un recorte de ese trazado común; omitir
estaciones no omite curvas ni crea rectas entre paraderos. La rama se elige
por sentido: B por defecto, A si hay paradas en Ramón Castilla, Tacna,
Jirón de la Unión o Colmena, o una definición explícita de itinerario.
Las estaciones se proyectan para obtener índices y distancias, pero no
arrastran la calzada hacia sus marcadores. Esto evita las diagonales
artificiales alrededor de Estación Central. El mapa y el planificador
conservan todos los vértices del trazado, sin simplificación de Leaflet.

```sh
python3 pipeline/scripts/metropolitano/build_met_paths.py
# Revisar y publicar los dos JSON preparados en pipeline/temp/authoring/met-macros.
python3 pipeline/scripts/trips/build_trip_graph.py --met-only
```

`metropolitano_backbones.json` conserva referencias OSM, geometría y hashes;
`metropolitano_paths.json` identifica el recorte exacto usado por cada sentido.
`docs/osm/metropolitano_macros.json` registra la cobertura de los 31 sentidos.
Las guías GeoJSON anteriores siguen siendo fuentes y no se dibujan como
respaldo de una calzada. Los pines de estación mantienen su estilo anterior,
rojo con centro blanco, comprobado en claro y oscuro.

### Accesos de terminal de los alimentadores

`pipeline.authoring.terminals` identifica el recinto y el andén de cada
servicio por su nombre OSM, independientemente de códigos que hayan cambiado.
Permite únicamente los segmentos de acceso utilizados: no habilita toda la
troncal BRT para el perfil mixto. El circuito conserva los sentidos y las
restricciones de giro. La unión al dibujo anterior exige una calzada compatible
y evita desvíos externos causados por haber pasado la puerta de entrada.

En Naranjal se corrigieron los 18 sentidos de nueve servicios con andén
interno. Los Alisos, Los Olivos, Antúnez de Mayolo e Izaguirre tienen plataformas
externas: la capa de embarques posterior corrige también sus cuatro salidas públicas. Sus llegadas conservan el trazado anterior. El punto compartido `met:naranjal` permanece
como identidad de estación; `terminalAccess.boardingPoint` identifica el andén
físico. El marcador de salida se ubica en el embarque y la línea conserva su calzada, sin arrastrarse hacia el punto común de estación.

La geometría externa conservada, los paraderos y el punto de vuelta mantienen
su identidad. Se actualizan los índices y distancias del acceso y las
indicaciones, dejando explícitos los tramos sin correspondencia única OSM.
`terminalAccess` guarda referencias dirigidas, el recorte y hashes separados
del cuerpo conservado. El importador verifica esos datos antes de reabrir el
recorrido; este permiso no certifica el resto de la ruta. La auditoría nativa
sigue registrando 33 sentidos completos válidos y 50 pendientes.

```sh
python3 -m pipeline.authoring.terminals naranjal
# Revisar el contrato preparado en pipeline/temp/authoring/terminal-access.
python3 pipeline/scripts/trips/build_trip_graph.py --alim-only AN-01 AN-05 AN-06 AN-07 AN-08 AN-12 AN-13 AN-14 AN-18 --preserve-stop-positions
```

`docs/osm/naranjal_terminal_access.json` registra la procedencia y los 18
accesos publicados. La sincronización de distancias conserva las posiciones
actuales de los paraderos del planificador.

### Tema de la interfaz

La opción «Tema de interfaz y mapa» ofrece Claro y Oscuro. Cambia los paneles,
formularios, controles y mapa; el editor tiene los mismos botones en su
cabecera. La elección se guarda en el navegador, se aplica antes de cargar los
estilos y se comparte entre pestañas del mismo sitio. Sin almacenamiento
disponible, los botones siguen funcionando durante la visita.

## Embarques y corredores de fuente dirigida

`python3 -m pipeline.authoring.boarding naranjal` vincula la capa de embarques a los servicios por nombre normalizado y verifica el nodo OSM y sus coordenadas. Los 13 embarques publicados proceden de `data/raw/metropolitano/naranjal_boarding_platforms.geojson`. Se conserva el punto exacto del archivo, su SHA y número. Esta capa certifica salidas; no se usa para modificar las llegadas. Los IDs internos se mantienen: AN-18 se muestra como AN-02 y AN-19 como AN-18 según los códigos de la capa. La autoridad del código operativo AN-02 queda indicada en sus metadatos. El grafo agrega un punto de abordaje físico y conserva la estación lógica del troncal.

`python3 -m pipeline.authoring.itineraries AD-C-ida AD-C-vuelta AD-N-ida AD-N-vuelta AD-S-ida AD-S-vuelta` reconstruye esos servicios en un corredor descubierto desde sus fuentes. Aplica proyecciones conjuntas, sentidos de calle, restricciones de giro, continuidad y límites por longitud de la guía. Descubre los segmentos de avenidas y enlaces omitidos por dibujos generalizados; excluye pasillos de estacionamiento sin evidencia de recorrido de bus. Los accesos privados requieren pertenencia a una relación de bus OSM y permisos explícitos de segmentos utilizados. No hay coordenadas de Quilca o del aeropuerto fijadas en el algoritmo, ni excepciones por código de servicio.

La reconstrucción termina solo si los seis sentidos validan y los tres accesos compartidos al aeropuerto coinciden en referencias y fracciones. Centro y Sur comparten el retorno de Quilca; Norte llega desde la otra dirección y conserva su entrada distinta. `docs/osm/aerodirecto_itineraries.json` conserva la evidencia y las referencias compartidas. Los originales y paraderos Wikiroutes se mantienen exactos; se publican `.osm.geojson` y `.route.json` aceptados. Las distancias del planificador se actualizan desde las posiciones verificadas sobre ese recorrido.

La operación API `match` de una ruta con evidencia `directed-source-corridor` reutiliza esta reconstrucción y devuelve un borrador que requiere aceptación. `replace` conserva los límites del corredor y el historial de giros. La revisión de inventario OSM 2 es aditiva dentro de `bus-v5`: recupera accesos de servicio acreditados por relaciones de buses sin cambiar los segmentos y restricciones previamente disponibles. Regenerar una caché anterior con `python3 -m pipeline.authoring.network` antes de iniciar el servidor. La auditoría nativa sigue indicando 33 sentidos completamente validados; corregir un acceso de Naranjal no certifica el resto de su recorrido histórico.

La red ATU proyectada usa geometría oficial externa al modelo de calles de buses y al planificador. Véase `docs/ATU_PROYECTADAS.md`.

## Referencias ferroviarias oficiales

La misma API permite importar, guardar, validar, aceptar y exportar los
paquetes ferroviarios del informe `Informe_Instrucciones_Metro_PMU_Limarutas.md`.
El paquete requiere `publisher=ATU`, `sourceKind=official_plan`,
`transportMode=rail`, `geometryPolicy=preserve`, `plannerEligible=false`,
`sourceUrl`, `sourceCrs`, `sourceFileSha256`, `sourceObjectId` y
`sourceGeometrySha256`. La fuente completa debe existir en
`data/raw/atu_geovisor/pmu_sit.geojson`. Si el hash ya cambió, revisar las
solicitudes contra el snapshot vigente, sin eliminar el control.

Puede usarse sin cargar una red OSM:

```sh
python3 -m pipeline.authoring --reference-only serve
python3 -m pipeline.authoring --reference-only call --request solicitudes_api/01_l2_pendiente.json
```

`health.capabilities.officialRailReference` identifica el soporte. Con
`--reference-only`, las operaciones viales requieren otro arranque con OSM.
GitHub Pages sigue sin ejecutar Python ni ofrecer una API pública.

El recorrido lleva `source.kind=official-reference`,
`profile.mode=reference`, `scope=cartographic-reference` y referencias de
parte `path.type=reference`. La fuente conserva propiedades, CRS declarado,
estado/horizonte, hashes y geometría. `geometry()` devuelve su objeto GeoJSON
íntegro; no convierte las partes en una cadena de puntos de bus. Las
coordenadas del paquete están agrupadas por parte; `segments` identifica
cada una para el editor. No se exigen paraderos ni se inventan puntos:
la capa PMU disponible no publica estaciones.

El editor dibuja cada parte por separado y deshabilita el ajuste a calles,
los pasos viales y la edición de paraderos. Revisión, notas, guardado,
historial y exportación conservan el contrato de revisiones existente.
`match`, `rebuild` y `replace` no se admiten para una referencia preservada.

Tras importar, comparar fuente y geometría; usar `save` con
`expectedRevision=0`, después `accept` con la revisión devuelta y finalmente
`export` sobre la revisión guardada. El paquete contiene `project.geojson`
y `project.reference.json`, con checksums. No genera `.osm.geojson`,
`osm:true`, un servicio Wikiroutes ni una entrada en el grafo operativo.
La aceptación tiene alcance exclusivamente cartográfico.

Las actualizaciones usan `propose-update` y `apply-update` con
`proposalHash` y `expectedRevision`. Cambiar la fuente revoca la aceptación
y conserva la anterior en el historial. Una etiqueta local que compita con
un nuevo nombre remoto exige elegir `local` o `incoming`. El eje fuente
permanece exacto; una corrección de ingeniería requiere una fuente revisada,
no mover puntos de la referencia. Restaurar una exportación vuelve a exigir
revisión, igual que en buses.
