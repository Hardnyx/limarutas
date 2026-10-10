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
