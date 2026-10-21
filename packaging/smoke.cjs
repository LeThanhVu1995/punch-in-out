const assert = require("node:assert/strict");
const {chromium} = require("playwright");
const path = require("node:path"),fs=require("node:fs"),os=require("node:os"),net=require("node:net");
const {once}=require("node:events");
const {startDashboard}=require("../service/dashboard");
process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve(__dirname, "../browsers");
(async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"punch-ui-smoke-"));
  fs.mkdirSync(path.join(root,"data"));
  const reserve=net.createServer();reserve.listen(0,"127.0.0.1");await once(reserve,"listening");
  const port=reserve.address().port;await new Promise(r=>reserve.close(r));
  const state={},accounts=[{username:"fixture-alpha",password:"fixture-password"},{username:"fixture-beta",password:"fixture-password"}];
  const config={timezone:"Asia/Ho_Chi_Minh",dashboard:{port}};
  const server=await startDashboard({root,state,save(){},settings:()=>({config,accounts}),stopping:()=>false,wake(){}});
  let browser;
  try {
    browser=await chromium.launch({headless:true});
    const page = await browser.newPage({viewport:{width:1366,height:900}});
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    await page.goto("http://127.0.0.1:"+port);
    await page.waitForFunction(()=>document.querySelectorAll("#rows tr").length===2);
    await page.selectOption("#mode","OUT");
    page.once("dialog",dialog=>dialog.accept());
    await page.click("#activate");
    await page.waitForFunction(()=>document.querySelector("#message").textContent.includes("Đã xếp 2"));
    assert.equal(Object.values(state).length,2);
    assert.ok(Object.values(state).every(job=>job.mode==="OUT" && job.status==="pending"));
    await page.fill("#search","fixture-beta");
    assert.equal(await page.locator("#rows tr").count(),1);
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.locator("#activate").isVisible());
    assert.deepEqual(errors,[]);
    console.log("Bundled Node, Playwright, Chromium and dashboard UI smoke tests passed.");
  } finally {
    await browser?.close();
    server.closeAllConnections();await new Promise(r=>server.close(r));
    fs.rmSync(root,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
