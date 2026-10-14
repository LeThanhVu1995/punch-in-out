
const assert = require("node:assert/strict");
const {chromium} = require("playwright");
const path = require("node:path");
process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve(__dirname, "../browsers");
(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    await page.setContent("<title>packaged-runtime-ok</title>");
    assert.equal(await page.title(), "packaged-runtime-ok");
    console.log("Bundled Node, Playwright and Chromium smoke test passed.");
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
