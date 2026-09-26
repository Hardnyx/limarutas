// tests/fixtures.js
// Fixture "app": abre el mapa listo para usar, sin depender de la red
// (Leaflet desde node_modules, tiles de CARTO bloqueados) y falla la prueba
// si la página tira errores de JavaScript.
import { test as base, expect } from '@playwright/test';
import path from 'node:path';

const LEAFLET_DIST = path.resolve('node_modules/leaflet/dist');

export const test = base.extend({
  app: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

    await page.route('https://unpkg.com/**', route => {
      const file = route.request().url().endsWith('.css') ? 'leaflet.css' : 'leaflet.js';
      route.fulfill({ path: path.join(LEAFLET_DIST, file) });
    });
    await page.route('https://*.basemaps.cartocdn.com/**', route => route.fulfill({ status: 204 }));

    await page.goto('/index.html');
    await expect(page.locator('#status')).toHaveText('Listo', { timeout: 90_000 });
    // Corredores se reconstruye al cargar sus tipos
    await page.waitForTimeout(1500);

    await use(new App(page));
    expect(errors, 'errores de JavaScript en la página').toEqual([]);
  }
});

export { expect };

// Utilidades para leer el estado del mapa desde las pruebas
export class App {
  constructor(page){ this.page = page; }

  // Evalúa fn(state) con el estado global de la app (config.js)
  state(fn, arg){
    return this.page.evaluate(async ([src, a]) => {
      const { state } = await import('/assets/js/config.js');
      return (0, eval)(src)(state, a);
    }, [fn.toString(), arg]);
  }

  // Ids de las subcapas Wikiroutes dibujadas
  visibleWr(){
    return this.state(state => {
      const ids = [];
      state.systems.wr.layers.forEach((g, id) => { if (state.map.hasLayer(g)) ids.push(id); });
      return ids.sort();
    });
  }

  // Espera a que dejen de cargarse capas Wikiroutes
  async settle(){
    let last = '';
    let same = 0;
    while (same < 3){
      await this.page.waitForTimeout(400);
      const now = await this.state(state => {
        let n = 0;
        state.systems.wr.layers.forEach(g => { if (state.map.hasLayer(g)) n++; });
        return `${n}:${state.systems.wr.layers.size}`;
      });
      same = now === last ? same + 1 : 0;
      last = now;
    }
  }

  setView(lat, lon, zoom){
    return this.state((state, [a, b, z]) => { state.map.setView([a, b], z, { animate: false }); }, [lat, lon, zoom]);
  }

  view(){
    return this.state(state => {
      const c = state.map.getCenter();
      return { lat: +c.lat.toFixed(5), lng: +c.lng.toFixed(5), zoom: state.map.getZoom() };
    });
  }

  // Punto en pantalla de una coordenada
  screenPoint(lat, lon){
    return this.state((state, [a, b]) => {
      const r = state.map.getContainer().getBoundingClientRect();
      const p = state.map.latLngToContainerPoint([a, b]);
      return { x: r.left + p.x, y: r.top + p.y };
    }, [lat, lon]);
  }

  async search(text){
    await this.page.fill('#searchInput', text);
    await expect(this.page.locator('.suggest-item').first()).toBeVisible();
    return this.page.locator('.suggest-item');
  }

  leaf(system, id){
    return this.page.locator(`#panels .item .item-head input[data-system="${system}"][data-id="${id}"]`);
  }
}
