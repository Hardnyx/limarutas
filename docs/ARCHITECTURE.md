# Arquitectura de LimaRutas

El sitio es estático: datos preparados en Python, módulos de JavaScript y
Leaflet. Catálogo, grafo y cálculo funcionan sin DOM; la interfaz y el mapa
consumen sus datos y el estado de selección.

## Límites

- Dominio: servicios, grafo, distancias, horarios y cálculo. No importa DOM,
  Leaflet, localStorage ni módulos de interfaz.
- Aplicación: carga de datos, estado y coordinación de tareas.
- Interfaz: formulario, listas, resultados, eventos y preferencias visuales.
- Mapa: geometrías y capas de Leaflet; consume datos y selección.
- Pipeline: produce y valida archivos estáticos. No requiere abrir el sitio.

Se mantienen la interfaz principal y la anterior. El cálculo usa distancias
aproximadas y evalúa los horarios a la salida; la red peatonal se utiliza
para dibujar la caminata elegida.

## Verificación

Las pruebas cubren las dos interfaces y el celular. Las pruebas de dominio
se ejecutan en Node sin navegador y verifican grupos, ids, sentidos y
opciones de viaje.

## Módulos actuales

| Responsabilidad | Módulos | Dependencias permitidas |
|---|---|---|
| Catálogo e identidad | `serviceCatalog`, `routePolicy`, `corridorPolicy`, `wrTexts` | Objetos de datos y funciones puras |
| Grafo y cálculo | `tripGraph`, `geo`, `metSchedule`, `tripPlanner`, `tripRecommendation` | Catálogo explícito, ids de servicio; sin casillas |
| Estado de rutas | `selectionState` | Sin navegador; suscripción a cambios |
| Carga | `catalogRepository`, `stopRepository`, `tripData` | Fetch, fuentes preparadas y estado de aplicación |
| Adaptación de selección | `routeControls`, `leafToggle` | Proyecta estado en controles y mapa; conserva eventos de recientes y grupos |
| Viajes | `tripUi`, `tripForm`, `tripResults`, `tripMapRenderer`, `tripPresentation` | Modelo de viaje y callbacks entre controlador y vistas |
| Montaje | `layout`, `mainLayout`, `legacyLayout` | Raíces compartidas de `index.html`; una interfaz se monta antes de cargar datos |

`serviceId` identifica el servicio, por ejemplo `met:A`; `key` identifica un
recorrido, por ejemplo `met:A:ns`. Ida y vuelta comparten servicio. Ni el
grafo ni el planificador retienen referencias a elementos DOM. El catálogo
resuelve una capa de Wikiroutes con la misma prioridad anterior: pares de
Corredores primero; después Transporte público, Corredores, AeroDirecto,
Otros y Rutas antiguas por código.

`tripData.loadTripGraph({ force: true })` reconstruye el catálogo desde las
fuentes cargadas y aplica cambios de configuración. `routeSelection` conserva
selección y sentido; las casillas alimentan ese estado, y los comandos usan
`routeControls.setRouteSelected(system, id, selected)`.

El montaje principal conserva los ids y las listas compartidas de rutas,
y construye su shell de pestañas explícitamente. El adaptador anterior deja
los controles en sus contenedores originales. `betaLayout` conserva exports
de compatibilidad; no dirige el arranque. Las listas de Corredores esperan
sus tipos antes de renderizarse; no se reemplazan después de «Listo».

Los CSS se cargan en el orden indicado por `styles.css`: tokens, controles
compartidos y compatibilidad, layout, viajes, fotos y componentes actuales.
Se eliminaron declaraciones sobrescritas conservando especificidad y orden
de cascada. Las referencias de estilos cubren ambas interfaces y temas en
escritorio y móvil.

## Límites que permanecen

El estado de Leaflet y las fuentes cargadas siguen en `config.state`; no se
reescribió todo el renderer de rutas. La jerarquía visual de grupos y los
recientes aún usan controles DOM como adaptadores. La caché de selección se
mantiene durante una sesión; la persistencia existente de recientes conserva
su comportamiento. La reconstrucción completa del pipeline necesita fuentes
raw externas. Estos límites son explícitos para evitar introducir nuevas
abstracciones sin consumidores o cambios de comportamiento ocultos.
