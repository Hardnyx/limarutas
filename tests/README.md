# Pruebas del mapa

Pruebas de humo en Chromium con [Playwright](https://playwright.dev). No usan
la red: Leaflet se sirve desde `node_modules` y los tiles de CARTO se bloquean.

```bash
npm install                      # primera vez
npx playwright install chromium  # primera vez (navegador)
npm test                         # todas las pruebas (~3 min)
npx playwright test tests/search.spec.js   # un archivo
npm run test:ui                  # modo interactivo
```

`npm test` levanta un servidor local (`python3 -m http.server 8765`) o reutiliza
uno que ya esté corriendo en ese puerto.

| Archivo | Qué cubre |
|---|---|
| `sidebar.spec.js` | Casillas de grupo, Metropolitano con Alimentadores, Desmarcar todo, encuadre, filtro de color, sentido, carrera marcar/desmarcar |
| `search.spec.js` | Código, alias, semiformal, Limpiar, paradero único y nombres repetidos por distrito |
| `map.spec.js` | Paraderos con nombre, panel "Rutas en este punto", advertencia de muchas rutas |
| `recents.spec.js` | Rutas recientes: sentido sincronizado y persistencia |
| `fixtures.js` | Fixture `app` (página lista) y utilidades para leer el estado del mapa |

En GitHub Actions corren en cada push y PR (`.github/workflows/tests.yml`), y el
despliegue a Pages (`pages.yml`) solo publica si pasan.
