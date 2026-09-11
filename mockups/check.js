
const { chromium } = require('/opt/data/trackd/node_modules/playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/hermes/.playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
  const files = ['shot_dashboard.html','shot_settings.html','shot_review.html'];
  for (const f of files) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto('file:///opt/data/trackd/mockups/' + f);
    await page.waitForTimeout(150);
    const info = await page.evaluate(() => {
      const shell = document.querySelector('.popup-shell');
      const frame = document.querySelector('.popup-frame');
      const r = frame.getBoundingClientRect();
      const bodyOverflow = document.body.scrollWidth > 1280 || document.body.scrollHeight > 800;
      return {
        shellScaleBox: shell.getBoundingClientRect().width,
        frameBox: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        fitsInViewport: r.x >= 0 && r.y >= 0 && r.right <= 1280 && r.bottom <= 800,
        bodyOverflow,
        docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight
      };
    });
    console.log(f, JSON.stringify(info));
    await page.close();
  }
  await browser.close();
})().catch(e=>{console.error('ERR', e.message); process.exit(1)});
