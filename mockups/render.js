
const { chromium } = require('/opt/data/trackd/node_modules/playwright-core');
const jobs = JSON.parse(process.argv[2]);
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/hermes/.playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
  for (const j of jobs) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    await page.goto('file://' + j.html);
    await page.waitForTimeout(300);
    await page.screenshot({ path: j.png, clip: { x:0, y:0, width:1280, height:800 } });
    await page.close();
    console.log('rendered', j.png);
  }
  await browser.close();
})().catch(e=>{console.error('ERR', e.message); process.exit(1)});
