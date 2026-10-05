// tests/recents.spec.js
// Rutas recientes: se agregan al marcar una ruta, reflejan el menú principal
// (incluido Ida/Vuelta) y se recuerdan al recargar.
import { test, expect } from './fixtures.js';

// En la nueva interfaz las rutas que están en el mapa se listan en "En el
// mapa" (sin casilla: × las quita) y Recientes es el historial
const onMapRow = (page, beta) => page.locator(beta ? '#onMapList .recent-item' : '#p-recent-list .recent-item');

test('una ruta buscada aparece en recientes con sus controles de sentido', async ({ app, page }) => {
  const beta = await app.isBeta();
  await app.search('1240');
  await page.keyboard.press('Enter');
  const row = onMapRow(page, beta).first();
  await expect(row).toContainText('1240');
  if (!beta) await expect(row.locator('.recent-row input')).toBeChecked();
  await expect(row.locator('.dir-mini .segbtn-mini')).toHaveText(['Ida', 'Vuelta']);

  // Vuelta desde recientes cambia la ruta real, sincroniza el menú y no mueve la vista
  await app.settle();
  await app.setView(-12.0, -77.05, 14);
  const before = await app.view();
  await row.locator('.segbtn-mini[data-dir="vuelta"]').click();
  await app.settle();
  expect(await app.visibleWr()).toEqual(['1240-vuelta']);
  expect(await app.view()).toEqual(before);
  const mainActive = await page.$eval('#p-wr input[data-id="1240"]', c =>
    c.closest('.item').querySelector('.segbtn-mini.active').dataset.dir);
  expect(mainActive).toBe('vuelta');

  // Desmarcar desde recientes (× en "En el mapa") quita la ruta
  if (beta) await row.locator('.recent-remove').click();
  else await row.locator('.recent-row input').uncheck();
  await expect(app.leaf('wr', '1240')).not.toBeChecked();
  // ...y en la nueva interfaz pasa al historial
  if (beta) await expect(page.locator('#p-recent-list .recent-item', { hasText: '1240' })).toHaveCount(1);
});

test('recientes se recuerdan al recargar, desmarcadas', async ({ app, page }) => {
  await app.search('1255');
  await page.keyboard.press('Enter');
  await expect(onMapRow(page, await app.isBeta())).toHaveCount(1);
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Listo', { timeout: 90_000 });
  const row = page.locator('#p-recent-list .recent-item').first();
  await expect(row).toContainText('1255');
  await expect(row.locator('.recent-row input')).not.toBeChecked();
});

test('× quita la fila y también la ruta del mapa', async ({ app, page }) => {
  const beta = await app.isBeta();
  await app.search('1240');
  await page.keyboard.press('Enter');
  await expect(app.leaf('wr', '1240')).toBeChecked();
  await onMapRow(page, beta).filter({ hasText: '1240' }).locator('.recent-remove').click();
  await expect(app.leaf('wr', '1240')).not.toBeChecked();
  await expect(onMapRow(page, beta).filter({ hasText: '1240' })).toHaveCount(0);
  await app.settle();
  expect(await app.visibleWr()).toEqual([]);
  if (beta){
    // Sale del mapa pero queda en el historial; su × la borra de ahí
    const hist = page.locator('#p-recent-list .recent-item', { hasText: '1240' });
    await expect(hist).toHaveCount(1);
    await hist.locator('.recent-remove').click();
    await expect(hist).toHaveCount(0);
  }
});

test('Limpiar borra el historial pero deja las rutas que están en el mapa', async ({ app, page }) => {
  await app.search('1240');
  await page.keyboard.press('Enter');
  await app.search('1255');
  await page.keyboard.press('Enter');
  // Con todas en el mapa, no hay historial que limpiar
  await expect(page.locator('#btnClearRecents')).toBeHidden();

  const beta = await app.isBeta();
  if (beta) await onMapRow(page, beta).filter({ hasText: '1255' }).locator('.recent-remove').click();
  else await page.locator('#p-recent-list .recent-item', { hasText: '1255' }).locator('.recent-row input').uncheck();
  await expect(page.locator('#btnClearRecents')).toBeVisible();
  await page.click('#btnClearRecents');
  // Queda solo la que está en el mapa (en la nueva interfaz, en "En el mapa")
  const rows = beta ? page.locator('#onMapList .recent-item') : page.locator('#p-recent-list .recent-item');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('1240');
  if (beta) await expect(page.locator('#p-recent')).toBeHidden();
  await expect(app.leaf('wr', '1240')).toBeChecked();
});
