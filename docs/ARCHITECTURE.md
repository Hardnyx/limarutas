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
