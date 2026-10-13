# Actualización diferencial de WikiRoutes

El sincronizador consulta el catálogo y las páginas de rutas como observación secundaria. Las correcciones aceptadas y los catálogos ATU/PRR conservan su precedencia. Las rutas ausentes en WikiRoutes se reportan, sin borrarlas ni cambiar su vigencia oficial.

```bash
npm ci
npx playwright install chromium
python3 pipeline/scripts/wikiroutes/wr_sync_live.py --scan --smoke
python3 pipeline/scripts/wikiroutes/wr_sync_live.py --scan --resume
python3 pipeline/scripts/wikiroutes/wr_sync_live.py --compare-cache
python3 pipeline/scripts/wikiroutes/wr_sync_live.py --apply-safe
```

La primera ejecución se limita al scan. `--apply-safe` exige un barrido completo y aplica colores reales sobre placeholders y metadatos observados bajo `wikiroutes`. Conserva nombres manuales, campos modernos y banderas `osm`. No promueve geometrías, paraderos ni rutas nuevas en esta primera fase: necesitan calibración del primer barrido y una transacción revisada que ejecute matching y derivados. No hay automatización de esa promoción.

Se puede acotar la adquisición con `--route <id>` repetible, `--only-new`, `--only-default-colors` o `--limit N`. `--resume` reutiliza únicamente snapshots íntegros con observación exitosa; fallos no reemplazan el último resultado válido. La comparación usa ambos sentidos espaciales, muestreo acumulativo de 20 m, extremos, longitudes y todos los trips. Detecta cambios de nombres, IDs, orden y coordenadas de paraderos. Los puntos del segmento cambiado se guardan separados, sin crear líneas entre componentes desconectados.

WikiRoutes sustituyó el mapa Leaflet por MapLibre y un botón “Mostrar mapa”. `wr_live_browser.mjs` reutiliza una sola sesión, pulsa ese botón, recorre sus sentidos y lee geometría, color y marcadores ya renderizados por la aplicación. Mantiene soporte de lectura de Leaflet. No reproduce tokens de acceso, no descodifica respuestas protegidas y no desactiva TLS. Si falta WebGL, el mapa no carga o hay una verificación del sitio, falla el smoke y se detiene antes del barrido. La adquisición puede ejecutarse con Chrome instalado mediante `WR_BROWSER_EXECUTABLE`; `WR_VISIBLE=1` lo muestra.

Los snapshots y el informe de scan viven en `pipeline/temp/wikiroutes_live`. Solo una aplicación segura escribe manifest, informe e histórico en `pipeline/output` y `data/history/wikiroutes`. La aplicación exige que el catálogo y los archivos fuente no hayan cambiado desde el scan; valida antes y después y revierte sus propios archivos si falla. Nunca toca los GeoJSON, vías, sidecars, stops o grafos al aplicar solo colores y metadata.

El workflow **Audit WikiRoutes live changes** verifica tres rutas con cada cambio del extractor. El barrido completo se solicita manualmente con alcance `full`; no se repiten miles de consultas por cada push. Los snapshots de smoke se guardan separados para conservar el barrido completo. El workflow no publica datos de rutas. Su tiempo corresponde a adquisición en vivo, independiente de la suite de tests y del despliegue del sitio.

`--compare-cache` vuelve a comparar los snapshots íntegros con los datos locales sin abrir el navegador ni consultar el catálogo otra vez. La clasificación de geometría permanece separada de la comparación de paraderos: coordenadas ausentes no representan un cambio mayor de trazado. El informe muestra tanto cambios reales de paraderos como capas con comparación incompleta. MapLibre 6 conserva sus marcadores en campos privados; el extractor observa los métodos públicos `Marker.addTo` y `Marker.remove` durante el render normal, conservando la identidad de cada punto y retirando los del sentido anterior. Una página con paraderos pero sin ningún punto recuperado falla la adquisición. `--resume` exige versión 2 de adquisición para no reutilizar snapshots anteriores sin coordenadas.

Los builders históricos `wr_build_catalog.py` y `wr_sync_indexes.py` quedan fuera de este flujo: saltan carpetas existentes o reconstruyen capas a partir de CSV y pueden perder colores y campos modernos. `wr_scrape.py` admite un driver compartido para usos heredados. No usar el builder histórico para refrescar toda la red.

La auditoría tiene permisos de solo lectura y no publica observaciones por sí sola. Después de revisar el reporte completo, `--apply-safe` aplica únicamente colores seguros y metadata, con comprobación de hashes y reversión si falla la validación. Los trazados, paraderos, rutas nuevas y estados oficiales permanecen protegidos.
