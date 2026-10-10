# Arquitectura de LimaRutas

El sitio sigue siendo estático: datos preparados en Python, módulos de
JavaScript y Leaflet. El refactor se organiza en commits que se pueden revisar
y revertir por separado.

## Secuencia

1. Referencias de comportamiento y documentación de límites.
2. Repositorio de paraderos independiente del buscador; sin ciclos de imports.
3. Catálogo de servicios: identidad, clasificación, nombres y sentidos, sin DOM.
4. Grafo y planificador: datos puros; la interfaz resuelve sus controles por id.
5. Estado de selección y dirección con suscripción; controles como adaptadores.
6. Separación de presentación, formulario y dibujo de viajes.
7. Montaje explícito de la interfaz principal y adaptación de la anterior.
8. CSS por componentes, preservando ambas interfaces.
9. Claridad y contraste de resultados.
10. Validación y entrada documentada del pipeline; dependencias y fuentes.

## Límites

- Dominio: servicios, grafo, distancias, horarios y cálculo. No importa DOM,
  Leaflet, localStorage ni módulos de interfaz.
- Aplicación: carga de datos, estado y coordinación de tareas.
- Interfaz: formulario, listas, resultados, eventos y preferencias visuales.
- Mapa: geometrías y capas de Leaflet; consume datos y selección.
- Pipeline: produce y valida archivos estáticos. No requiere abrir el sitio.

La interfaz antigua se conserva durante la migración. Los algoritmos de
caminata, horarios de abordaje y estimación de tiempos son cambios de
comportamiento posteriores, con sus propias pruebas; no se mezclan con
extracciones mecánicas.

## Verificación

Las pruebas existentes cubren las dos interfaces y el celular. Las nuevas
pruebas de dominio deben poder ejecutarse en Node sin navegador. Cada
extracción conserva grupos, ids, sentidos y opciones de viaje.

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
