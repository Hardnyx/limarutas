// tests/recents.spec.js
// Rutas recientes: se agregan al marcar una ruta, reflejan el menú principal
// (incluido Ida/Vuelta) y se recuerdan al recargar.
import { test, expect } from './fixtures.js';

test('una ruta buscada aparece en recientes con sus controles de sentido', async ({ app, page }) => {
  await app.search('1240');
  await page.keyboard.press('Enter');
  const row = page.locator('#p-recent-list .recent-item').first();
  await expect(row).toContainText('1240');
  await expect(row.locator('.recent-row input')).toBeChecked();
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

  // Desmarcar desde recientes quita la ruta
  await row.locator('.recent-row input').uncheck();
  await expect(app.leaf('wr', '1240')).not.toBeChecked();
});

test('recientes se recuerdan al recargar, desmarcadas', async ({ app, page }) => {
  await app.search('1255');
  await page.keyboard.press('Enter');
  await expect(page.locator('#p-recent-list .recent-item')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Listo', { timeout: 90_000 });
  const row = page.locator('#p-recent-list .recent-item').first();
  await expect(row).toContainText('1255');
  await expect(row.locator('.recent-row input')).not.toBeChecked();
});

test('× quita la fila y también la ruta del mapa', async ({ app, page }) => {
  await app.search('1240');
  await page.keyboard.press('Enter');
  await expect(app.leaf('wr', '1240')).toBeChecked();
  await page.locator('#p-recent-list .recent-item', { hasText: '1240' }).locator('.recent-remove').click();
  await expect(app.leaf('wr', '1240')).not.toBeChecked();
  await expect(page.locator('#p-recent-list .recent-item', { hasText: '1240' })).toHaveCount(0);
  await app.settle();
  expect(await app.visibleWr()).toEqual([]);
});

test('Limpiar borra el historial pero deja las rutas que están en el mapa', async ({ app, page }) => {
  await app.search('1240');
  await page.keyboard.press('Enter');
  await app.search('1255');
  await page.keyboard.press('Enter');
  // Con todas en el mapa, no hay historial que limpiar
  await expect(page.locator('#btnClearRecents')).toBeHidden();

  await page.locator('#p-recent-list .recent-item', { hasText: '1255' }).locator('.recent-row input').uncheck();
  await expect(page.locator('#btnClearRecents')).toBeVisible();
  await page.click('#btnClearRecents');
  const rows = page.locator('#p-recent-list .recent-item');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('1240');
  await expect(app.leaf('wr', '1240')).toBeChecked();
});
