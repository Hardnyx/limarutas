# Pruebas del mapa

Pruebas de humo en Chromium con [Playwright](https://playwright.dev). No usan
la red: Leaflet se sirve desde `node_modules` y los tiles de CARTO se bloquean.

```bash
npm install                      # primera vez
npx playwright install chromium  # primera vez (navegador)
npm test                         # todas las pruebas, en las dos interfaces
npx playwright test tests/search.spec.js   # un archivo
npx playwright test --project=beta         # solo la nueva interfaz (?beta=1)
npm run test:ui                  # modo interactivo
```

`npm test` levanta un servidor local (`python3 -m http.server 8765`) o reutiliza
uno que ya esté corriendo en ese puerto.

Hay dos proyectos: `chromium` abre la interfaz actual y `beta` la nueva
(`/index.html?beta=1&debug=1`). Las pruebas son las mismas; para tocar las
opciones del mapa (paradas, tema), que en la nueva interfaz están en el menú ⚙,
se usa `app.setting('#chkStops')`, que lo abre si hace falta.

| Archivo | Qué cubre |
|---|---|
| `sidebar.spec.js` | Casillas de grupo, Metropolitano con Alimentadores, Desmarcar todo, encuadre, filtro de color, sentido, carrera marcar/desmarcar |
| `search.spec.js` | Código, alias, rutas antiguas (semiformal), Limpiar, paradero único y nombres repetidos por distrito |
| `map.spec.js` | Paraderos con nombre, panel "Rutas en este punto", advertencia de muchas rutas |
| `recents.spec.js` | Rutas recientes: sentido sincronizado y persistencia |
| `beta.spec.js` | Nueva interfaz: pestañas, orden y conteo de secciones, "En el mapa", filtro de listas, ajustes del mapa, `?debug=1` y `?beta=0` |
| `explore.spec.js` | Secuencias aleatorias reproducibles de todas las acciones, con invariantes (ver `docs/DECISION_MAP.md`) |
| `fixtures.js` | Fixture `app` (página lista) y utilidades para leer el estado del mapa |

En GitHub Actions corren en cada push y PR (`.github/workflows/tests.yml`), y el
despliegue a Pages (`pages.yml`) solo publica si pasan.
