# Pruebas del mapa

Pruebas de humo en Chromium con [Playwright](https://playwright.dev). No usan
la red: Leaflet se sirve desde `node_modules` y los tiles de CARTO se bloquean.

```bash
npm ci                           # primera vez
npx playwright install chromium  # primera vez (navegador)
npm test                         # todas las pruebas, en las dos interfaces
npx playwright test tests/search.spec.js   # un archivo
npx playwright test --project=beta         # solo la nueva interfaz (?beta=1)
npm run test:ui                  # modo interactivo
```

`npm test` levanta un servidor local (`python3 -m http.server 8765`) o reutiliza
uno que ya esté corriendo en ese puerto.

Hay dos proyectos: `chromium` abre la interfaz anterior (`/index.html?beta=0`)
y `beta` la nueva, que es la de todos (`/index.html?beta=1&debug=1`). La nueva
abre en "Cómo llegar"; el fixture pasa a la pestaña Rutas salvo con
`test.use({ startTab: 'default' })`. Las pruebas son las mismas; para tocar las
opciones del mapa (paradas, tema), que en la nueva interfaz están en el menú ⚙,
se usa `app.setting('#chkStops')`, que lo abre si hace falta.

La página corre con el reloj fijo en martes 10:30 de Lima (`clockAt` en
`fixtures.js`), porque el Metropolitano tiene horarios; `test.use({ clockAt: … })`
lo cambia.

| Archivo | Qué cubre |
|---|---|
| `sidebar.spec.js` | Casillas de grupo, Metropolitano con Alimentadores, Desmarcar todo, encuadre, filtro de color, sentido, carrera marcar/desmarcar, recorrido y horario del Metropolitano |
| `search.spec.js` | Código, alias, rutas antiguas (semiformal), Limpiar, paradero único y nombres repetidos por distrito |
| `map.spec.js` | Paraderos con nombre, panel "Rutas en este punto", advertencia de muchas rutas |
| `recents.spec.js` | Rutas recientes: sentido sincronizado y persistencia |
| `beta.spec.js` | Nueva interfaz: pestañas, orden y conteo de secciones, "En el mapa", filtro de listas, ajustes del mapa, `?debug=1` y `?beta=0` |
| `mobile.spec.js` | Celular (390×844): hoja inferior de la nueva interfaz (alturas, manija, buscador, encuadre, paradero) y que la actual no se salga de la pantalla |
| `trips.spec.js` | Datos para "Cómo llegar": orden de paraderos por ruta y sentido, rutas del sidebar con su grupo, rutas antiguas verificadas, vía auxiliar unida por caminata, paraderos cercanos, typos de nombres corregidos |
| `tripPlanner.spec.js` | Cómo llegar: opciones directas y con transbordo (orden, sentido, cerca de A y B), caminar si está cerca, rutas antiguas; la pestaña (paraderos, 📍 en el mapa, Esc, invertir, borrar) |
| `explore.spec.js` | Secuencias aleatorias reproducibles de todas las acciones, con invariantes (ver `docs/DECISION_MAP.md`) |
| `fixtures.js` | Fixture `app` (página lista) y utilidades para leer el estado del mapa |

En GitHub Actions corren en cada push y PR (`.github/workflows/tests.yml`), y el
despliegue a Pages (`pages.yml`) solo publica si pasan.

## Contratos de arquitectura y datos

- `npm run test:unit`: catálogo, identidad entre sentidos, estado con suscripción,
  grafo espacial, cálculo sin navegador y límites de imports de dominio.
- `npm run test:data`: rechaza referencias rotas, valores no finitos y segmentos
  inconsistentes; valida los archivos estáticos que consume el sitio.
- `architecture.spec.js`: compara el catálogo con las dos interfaces,
  reconstruye el grafo sin sidebar y comprueba selección y «Quitar todas».
- `style-contract.spec.js`: referencias de estilos computados en dos anchos y
  ambos temas. Actualizar snapshots únicamente ante cambios visuales previstos.
