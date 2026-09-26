// playwright.config.js
// Pruebas de humo del mapa en Chromium: npm test
import { defineConfig, devices } from '@playwright/test';

const PORT = 8765;

export default defineConfig({
  testDir: './tests',
  // Cargar Wikiroutes y cientos de capas toma su tiempo
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1600, height: 900 },
    trace: 'retain-on-failure'
  },
  // Todo se prueba en la interfaz actual y en la nueva (?beta=1, con las
  // herramientas de depuración para el filtro de color)
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } } },
    { name: 'beta', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 }, entry: '/index.html?beta=1&debug=1' } }
  ],
  // Sitio estático: basta un servidor de archivos
  webServer: {
    command: `python3 -m http.server ${PORT}`,
    url: `http://localhost:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
