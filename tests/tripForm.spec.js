import { test, expect } from './fixtures.js';

test.use({ startTab: 'default' });
test.beforeEach(async ({ app }) => {
  test.skip(!(await app.isBeta()), 'A/B planner belongs to the current interface');
});

test('A/B form keeps search, swap and options functional', async ({ page }) => {
  const search = page.getByRole('button', { name: 'Buscar viaje', exact: true });
  await expect(search).toBeDisabled();
  await expect(page.locator('#tripOptions')).toBeHidden();
  await page.click('#tripOptionsToggle');
  await expect(page.locator('#tripOptionsToggle')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#tripOld').check();
  await page.locator('#tripOld').press('Escape');
  await expect(page.locator('#tripOptions')).toBeHidden();
  await expect(page.locator('#tripOld')).toBeChecked();

  // Identical endpoints are a valid walking journey, including after swap.
  await page.evaluate(async () => {
    const { setTripEnds } = await import('/assets/js/tripUi.js');
    await setTripEnds({ lat: -12.046, lon: -77.043, label: 'Inicio' },
      { lat: -12.046, lon: -77.043, label: 'Destino' });
  });
  await expect(search).toBeEnabled();
  await search.click();
  await expect(page.locator('.trip-empty')).toContainText('te conviene caminar');
  await page.click('#tripSwap');
  await expect(page.locator('#tripFrom')).toHaveValue('Destino');
  await expect(page.locator('#tripTo')).toHaveValue('Inicio');
  await page.getByRole('button', { name: 'Borrar destino', exact: true }).click();
  await expect(search).toBeDisabled();
  await expect(page.locator('#tripResults')).toBeEmpty();
});

test('keyboard suggestions expose the selected point and accept Enter', async ({ page }) => {
  const input = page.locator('#tripFrom');
  await input.fill('javier prado brasil');
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#tripSuggest-from [aria-selected="true"]')).toContainText('Javier Prado con Brasil');
  await input.press('Enter');
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await expect(input).toHaveValue(/Javier Prado con Brasil/);
  await expect(page.locator('#tripTo')).toBeFocused();
});

test('shared WikiRoutes coordinates produce usable options and preserve preferences in a link', async ({ page }) => {
  await page.goto('/index.html?desde=-12.023427,-77.050329&hasta=-12.217521,-76.926885');
  await expect(page.locator('.trip-card').first()).toBeVisible();
  await expect(page.locator('.trip-pin-from')).toHaveCount(1);
  await expect(page.locator('.trip-pin-to')).toHaveCount(1);
  await page.click('#tripOptionsToggle');
  await page.locator('#tripPreferMetro').check();
  await page.getByLabel('Menos traslados', { exact: true }).check();
  await page.selectOption('#tripDay', '1');
  await page.locator('#tripTime').fill('08:00');
  await page.locator('#tripTime').dispatchEvent('change');
  await expect(page.locator('.trip-card').first()).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('orden')).toBe('transfers');
  await expect.poll(() => new URL(page.url()).searchParams.get('preferir')).toBe('metro');
  const shared = page.url();
  await page.goto(shared);
  await expect(page.locator('.trip-card').first()).toBeVisible();
  await expect(page.locator('#tripPreferMetro')).toBeChecked();
  await expect(page.getByLabel('Menos traslados', { exact: true })).toBeChecked();
  await expect(page.locator('#tripDay')).toHaveValue('1');
  await expect(page.locator('#tripTime')).toHaveValue('08:00');

  // Filtering must affect computed rides and their alternatives, not just labels.
  await page.locator('.trip-filters button[data-mode="bus"]').click();
  await expect(page.locator('.trip-card').first()).toBeVisible();
  await expect(page.locator('.trip-step .ico-subway')).toHaveCount(0);
  await expect(page.locator('.trip-filters button[data-mode="bus"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => new URL(page.url()).searchParams.get('transporte')).toBe('bus');
  await page.locator('.trip-card.selected .trip-step-place').first().click();
  await expect(page.locator('.trip-card.selected')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('.trip-card.selected .trip-fit').click();
  await page.locator('.trip-card.selected').click();
  await expect(page.locator('.trip-card.selected')).toHaveAttribute('aria-expanded', 'false');
});

test('sidebar can be hidden and restored without discarding A/B', async ({ page }) => {
  await page.locator('#sidebarToggle').click();
  await expect(page.locator('#sidebar')).toBeHidden();
  await expect(page.locator('#sidebarToggle')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#sidebarToggle').click();
  await expect(page.locator('#tripFrom')).toBeVisible();
});
