import { test, expect } from './fixtures.js';
import path from 'node:path';

test('theme covers the interface, persists, and follows into the editor', async ({ app, page, context }) => {
  await (await app.setting('#btnUiDark')).click();
  await expect(page.locator('html')).toHaveClass(/theme-dark/);
  await expect(page.locator('#btnUiDark')).toHaveAttribute('aria-pressed', 'true');
  const styles = await page.evaluate(() => {
    const css = selector => getComputedStyle(document.querySelector(selector));
    return { panel: css('#sidebar').backgroundColor, input: css('#searchInput').color,
      scheme: css('html').colorScheme };
  });
  expect(styles.panel).toBe('rgb(31, 34, 38)');
  expect(styles.input).toBe('rgb(232, 234, 237)');
  expect(styles.scheme).toBe('dark');
  expect(await app.state(state => state.currentBase)).toBe('light');
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Listo');
  await expect(page.locator('#btnUiDark')).toHaveAttribute('aria-pressed', 'true');
  expect(await app.state(state => state.currentBase)).toBe('light');

  // Same origin, including the static editor without a running editing engine.
  const editor = await context.newPage();
  await editor.route('https://unpkg.com/**', route => route.fulfill({ path: path.resolve('node_modules/leaflet/dist', route.request().url().endsWith('.css') ? 'leaflet.css' : 'leaflet.js') }));
  await editor.route('https://*.basemaps.cartocdn.com/**', route => route.fulfill({status:204}));
  await editor.goto('/editor.html');
  await expect(editor.locator('#editorThemeDark')).toHaveAttribute('aria-pressed', 'true');
  expect(await editor.locator('.editor-panel').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(31, 34, 38)');
  await editor.locator('#editorThemeLight').click();
  await expect(editor.locator('html')).not.toHaveClass(/theme-dark/);
  // Interface changes in another tab leave the independently saved map unchanged.
  await expect(page.locator('#btnUiLight')).toHaveAttribute('aria-pressed', 'true');
  expect(await app.state(state => state.currentBase)).toBe('light');
  await editor.locator('#editorMapDark').click();
  await expect(page.locator('#btnDark')).toHaveAttribute('aria-pressed','true');
  expect(await app.state(state => state.currentBase)).toBe('dark');
  await expect(page.locator('html')).not.toHaveClass(/theme-dark/);
  await editor.close();
});

test('editor themes cover forms, toolbar, legend and map controls on a phone', async ({ page }) => {
  await page.route('https://unpkg.com/**', route => route.fulfill({ path: path.resolve('node_modules/leaflet/dist', route.request().url().endsWith('.css') ? 'leaflet.css' : 'leaflet.js') }));
  await page.route('https://*.basemaps.cartocdn.com/**', route => route.fulfill({status:204}));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:8777/editor.html');
  await expect(page.locator('#connection')).toHaveText('Motor conectado');
  await page.locator('#editorThemeDark').click();
  await expect(page.locator('#editorMapLight')).toHaveAttribute('aria-pressed','true');
  for (const selector of ['.editor-panel', '.editor-toolbar', '.map-legend', '#routeQuery', '.leaflet-control-zoom-in']) {
    expect(await page.locator(selector).evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(31, 34, 38)');
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(page.locator('#editorThemeDark')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#editorThemeLight').click();
  expect(await page.locator('#routeQuery').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
  await page.screenshot({ path: 'pipeline/temp/authoring/editor-theme-light.png' });
});

test('theme changes still work when browser storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Unavailable', 'SecurityError'); } });
  });
  await page.route('https://unpkg.com/**', route => route.fulfill({ path: path.resolve('node_modules/leaflet/dist', route.request().url().endsWith('.css') ? 'leaflet.css' : 'leaflet.js') }));
  await page.route('https://*.basemaps.cartocdn.com/**', route => route.fulfill({status:204}));
  await page.goto('http://127.0.0.1:8777/editor.html');
  await page.locator('#editorThemeDark').click();
  await expect(page.locator('html')).toHaveClass(/theme-dark/);
  await page.locator('#editorThemeLight').click();
  await expect(page.locator('html')).not.toHaveClass(/theme-dark/);
});


test('interface and map support all four combinations and preserve them on reload',async({app,page})=>{
  for(const ui of ['light','dark']){
    for(const map of ['light','dark']){
      await (await app.setting(ui==='dark'?'#btnUiDark':'#btnUiLight')).click();
      await (await app.setting(map==='dark'?'#btnDark':'#btnLight')).click();
      expect(await page.locator('html').evaluate(el=>el.classList.contains('theme-dark'))).toBe(ui==='dark');
      expect(await app.state(state=>state.currentBase)).toBe(map);
      await page.reload();await expect(page.locator('#status')).toHaveText('Listo');
      expect(await page.locator('html').evaluate(el=>el.classList.contains('theme-dark'))).toBe(ui==='dark');
      expect(await app.state(state=>state.currentBase)).toBe(map);
    }
  }
});
