const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const {readFile} = require('node:fs/promises');

const base = new URL(process.env.SIGMARK_QA_URL).origin;
const token = process.env.SIGMARK_QA_TOKEN;
const reportId = process.env.SIGMARK_QA_REPORT;

async function run() {
  assert(token && reportId);
  const options = process.env.SIGMARK_QA_BROWSER ? {channel: process.env.SIGMARK_QA_BROWSER} : {};
  const browser = await chromium.launch({headless: true, ...options});
  try {
    const page = await browser.newPage({viewport: {width: 360, height: 780}, serviceWorkers: 'block'});
    page.setDefaultTimeout(8000);
    await page.route('**/*', async route => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.origin !== base || req.method() !== 'GET') return route.abort();
      if (!url.pathname.startsWith('/api/admin/')) return route.continue();
      const response = await route.fetch({headers: {...req.headers(), authorization: 'Bearer ' + token}, maxRedirects: 0});
      return route.fulfill({response});
    });
    await page.goto(base + '/#reports?report=' + reportId);
    const search = page.getByRole('searchbox', {name: '搜索本报告参数'});
    for (const key of ['battery.cycleCount', 'cellular.dataSubscriptionService', 'cellular.carrierBandwidths']) {
      await search.fill(key);
      const field = page.locator('.field-evidence');
      await field.locator('summary').click();
      await field.getByText(key, {exact: true}).waitFor();
    }
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByText('更多报告操作', {exact: true}).click();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', {name: '下载 JSON', exact: true}).click();
    const data = JSON.parse(await readFile(await (await pending).path(), 'utf8'));
    assert.equal(data.id, reportId);
    assert.equal(data.report.fieldSetVersion, 20);
    for (const key of ['battery.present', 'battery.cycleCount', 'cellular.dataSubscriptionService', 'cellular.carrierBandwidths']) {
      const reading = data.report.parameters.find(p => p.group + '.' + p.key === key);
      assert(reading && reading.source);
      assert.equal(reading.status === 'AVAILABLE', reading.value !== null);
    }
    console.log('PASS v20 phone report: 360px search, field evidence and JSON download.');
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exit(1); });
