// After npm run build: node tests/names-page.browser.mjs [base path, e.g. /atlas-test]
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const base = (process.argv[2] ?? '').replace(/\/$/, '');
const origin = 'http://atlas.test';
const dist = fileURLToPath(new URL('../dist/', import.meta.url));

test('Names page: browse the rankings, explore a surname, and return to prefix search', async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin || !url.pathname.startsWith(`${base}/`)) return route.abort();
      const path = url.pathname.slice(base.length + 1);
      await route.fulfill({ path: `${dist}${path}${path.endsWith('/') ? 'index.html' : ''}` });
    });

    await page.goto(`${origin}${base}/names/`);
    await page.getByRole('link', { name: 'Explore the name tallies' }).click({ timeout: 2000 });
    assert.equal(new URL(page.url()).hash, '#name-tallies');
    const surnames = page.getByRole('region', { name: 'Most common surnames' });
    const givenNames = page.getByRole('region', { name: 'Most common first names' });
    assert.match(await surnames.getByRole('listitem').first().innerText(), /Smith\s+210/);
    assert.match(await givenNames.getByRole('listitem').first().innerText(), /John\s+815/);
    const tied = givenNames.getByRole('listitem').filter({ hasText: /Joseph|Mary/ });
    assert.deepEqual(await tied.evaluateAll((rows) => rows.map((row) => row.value)), [7, 7]);
    assert.equal(await page.getByRole('link', { name: 'Wright', exact: true }).getAttribute('href'), `${base}/tract/?id=CALA-0098931`);

    await page.getByText('Surnames that sound like the desert', { exact: true }).click();
    assert.ok(await page.getByRole('link', { name: 'Moon', exact: true }).isVisible());
    const li = page.getByRole('link', { name: 'Li', exact: true });
    await li.click();
    assert.equal(new URL(page.url()).searchParams.get('surname'), 'Li');
    const results = page.locator('#nlist .nm');
    await results.first().waitFor();
    assert.deepEqual((await results.allTextContents()).map((label) => label.split(',')[0]), ['Li']);

    const search = page.getByRole('searchbox', { name: 'Surname' });
    assert.equal(await search.inputValue(), 'Li');
    await search.fill('Lin');
    await page.waitForFunction(() => document.getElementById('nstatus').textContent.includes('beginning “Lin”'));
    assert.equal(new URL(page.url()).searchParams.get('q'), 'Lin');
    assert.ok(await results.count() > 1);
    assert.ok((await results.allTextContents()).every((name) => name.startsWith('Lin')));
    await page.getByRole('navigation', { name: 'Initial' }).getByRole('link', { name: 'Q', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('nstatus').textContent.includes('names under Q'));
    assert.equal(await search.inputValue(), '');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
