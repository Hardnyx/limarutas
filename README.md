# LimaRutas

Mapa estático de transporte de Lima y Callao, con catálogo de rutas y cálculo
de viajes. [Abrir el sitio](https://hardnyx.github.io/limarutas/).

```bash
npm ci
npx playwright install chromium
python3 -m http.server 8765
```

Abrir `http://localhost:8765`. La interfaz principal incluye «Cómo llegar» y
«Rutas»; `?beta=0` conserva la interfaz anterior y `?beta=1` vuelve a la actual.

```bash
npm run test:unit
python3 -m unittest discover -s pipeline/tests
python3 pipeline/run.py validate
npm test
```

`npm test` ejecuta dominio y Playwright en ambas interfaces, incluyendo móvil.
Las pruebas interceptan Leaflet y los tiles para funcionar sin servicios de
mapas externos. `npm run test:data` valida los datos estáticos.

- [Arquitectura y límites entre módulos](docs/ARCHITECTURE.md)
- [Pipeline, dependencias y procedencia de datos](docs/PIPELINE.md)
- [Pruebas y utilidades](tests/README.md)

El planificador conserva las estimaciones existentes: la red peatonal se usa
para dibujar el tramo elegido; el cálculo usa distancia aproximada. Los
horarios se evalúan a la salida. Esos algoritmos se pueden cambiar después
con casos de referencia propios.
