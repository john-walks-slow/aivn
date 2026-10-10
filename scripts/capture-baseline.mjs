import { withPage } from '../e2e/lib/browser.mjs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:59793';
const OUT = 'docs/screenshots/baseline';

console.log('Capturing baseline screenshots from', BASE);

await withPage(async (page) => {
  await page.setViewportSize({ width: 1280, height: 720 });

  const capture = async (path, name) => {
    console.log(`Navigating to ${path}...`);
    await page.goto(`${BASE}/${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log(`Saved ${OUT}/${name}.png`);
  };

  await capture('#/', '01-library');
  await capture('#/settings', '02-global-settings');
  await capture('#/play/stub', '03-title-screen');
  await capture('#/play/stub/saves', '04-saves-view');
  await capture('#/play/stub/stage', '05-stage-theater');
  await capture('#/play/stub/stage?view=transcript', '06-stage-transcript');
  await capture('#/play/stub/stage?view=tree', '07-stage-route-tree');
  await capture('#/play/stub/stage?view=cg', '08-stage-cg');
  await capture('#/play/stub/stage?view=workshop&workshop=1&tab=chat', '09-workshop-chat');
  await capture('#/play/stub/stage?view=workshop&workshop=1&tab=play', '10-workshop-play');
  await capture('#/play/stub/stage?view=workshop&workshop=1&tab=character', '11-workshop-character');
  await capture('#/play/stub/stage?view=workshop&workshop=1&tab=memory', '12-workshop-memory');
  await capture('#/play/stub/stage?view=workshop&workshop=1&tab=assets', '13-workshop-assets');
  await capture('#/play/stub/stage?view=workshop&workshop=1&tab=files', '14-workshop-files');
  await capture('#/play/stub/stage?view=workshop&workshop=1&tab=agents', '15-workshop-agents');
  await capture('#/play/stub/stage?view=workshop&workshop=1&tab=settings', '16-workshop-settings');
});

console.log('Done capturing all baseline screenshots!');
