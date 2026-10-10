import { withPage } from '../e2e/lib/browser.mjs';

const BASE = 'http://127.0.0.1:37394';
await withPage(async (page) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-ui-theme', 'dark');
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'docs/screenshots/r5/01-library-dark.png' });
  console.log('Saved 01-library-dark.png');

  await page.goto(`${BASE}/#/play/320000/stage?view=workshop&workshop=1&tab=chat`, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-ui-theme', 'dark');
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'docs/screenshots/r5/09-ws-chat-dark.png' });
  console.log('Saved 09-ws-chat-dark.png');
});
