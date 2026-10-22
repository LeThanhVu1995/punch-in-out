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
  const config={timezone:"Asia/Ho_Chi_Minh",dashboard:{port},weekdays:[1,2,3,4,5],windows:{IN:{from:"07:20",to:"08:30"},OUT:{from:"17:40",to:"18:35"}},accountsFile:"accounts.json",offDaysFile:"off.json",pollSeconds:15,jobTimeoutSeconds:300,environment:{LOGIN_URL:"http://127.0.0.1:9",TARGET_URL:"http://127.0.0.1:9/attendance",USERNAME_SELECTOR:"#u",PASSWORD_SELECTOR:"#p",SUBMIT_SELECTOR:"#s",BUTTON_IN_SELECTOR:"#in",BUTTON_OUT_SELECTOR:"#out"}};
  fs.writeFileSync(path.join(root,"config.json"),JSON.stringify(config));fs.writeFileSync(path.join(root,"accounts.json"),JSON.stringify(accounts));fs.writeFileSync(path.join(root,"off.json"),JSON.stringify({global:[],users:{}}));
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
    await page.click("#tab-settings");
    await page.waitForSelector("#edit-timezone");
    await page.fill("#edit-maxRetries","2");await page.click("#save-config");
    await page.waitForFunction(()=>document.querySelector("#message").textContent.includes("Đã lưu cấu hình"));
    assert.equal(JSON.parse(fs.readFileSync(path.join(root,"config.json"),"utf8")).maxRetries,2);

    const today=new Intl.DateTimeFormat("en-CA",{timeZone:config.timezone}).format(new Date());
    const dayPlus=(date,n)=>new Date(Date.parse(date+"T00:00:00Z")+n*86400000).toISOString().slice(0,10);
    await page.click("#tab-leave");
    await page.waitForSelector(".calendar-day");
    await page.click("#new-leave");
    await page.fill("#leave-from",dayPlus(today,2));await page.fill("#leave-to",dayPlus(today,4));
    await page.fill("#leave-note","Nghỉ chung theo kế hoạch");
    await page.click("#leave-save");
    await page.waitForFunction(()=>document.querySelector("#message").textContent.includes("Đã đăng ký nghỉ"));
    assert.ok(JSON.parse(fs.readFileSync(path.join(root,"off.json"),"utf8")).global.includes(dayPlus(today,3)));
    await page.click("#new-leave");
    await page.fill("#leave-from",dayPlus(today,5));await page.fill("#leave-to",dayPlus(today,7));
    await page.selectOption("#leave-scope","users");
    await page.locator('#leave-user-options input[value="fixture-alpha"]').check();
    await page.fill("#leave-note","Nghỉ phép gia đình");
    await page.click("#leave-save");
    await page.waitForFunction(()=>document.querySelectorAll(".leave-card").length===2);
    const personal=page.locator(".leave-card").filter({hasText:"Nghỉ phép gia đình"});
    await personal.getByRole("button",{name:"Sửa",exact:true}).click();
    await page.fill("#leave-note","Nghỉ phép đã cập nhật");await page.click("#leave-save");
    await page.waitForFunction(()=>document.querySelector("#leave-list").textContent.includes("Nghỉ phép đã cập nhật"));
    const qa=process.env.PUNCH_QA_DIR;
    if(qa){fs.mkdirSync(qa,{recursive:true});await page.screenshot({path:path.join(qa,"01-ngay-nghi.png"),fullPage:true});}
    const current=JSON.parse(fs.readFileSync(path.join(root,"off.json"),"utf8"));
    assert.equal(current.registrations.find(r=>r.scope==="users").note,"Nghỉ phép đã cập nhật");
    page.once("dialog",dialog=>dialog.accept());
    await page.locator(".leave-card").filter({hasText:"Nghỉ phép đã cập nhật"}).getByRole("button",{name:"Xóa",exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll(".leave-card").length===1);
    assert.ok(JSON.parse(fs.readFileSync(path.join(root,"off.json"),"utf8")).global.includes(dayPlus(today,3)));

    const records=[];
    for(const [index,account]of accounts.entries())for(const mode of ["IN","OUT"]){
      const job={date:today,username:account.username,mode,due:mode==="IN"?27000:64200,attempts:mode==="IN"?2:1,
       status:mode==="IN"?(index?"clicked":"success"):(index?"pending":"failed"),
       startedAt:today+(mode==="IN"?"T00:31:00Z":"T10:51:00Z"),finishedAt:today+(mode==="IN"?"T00:31:10Z":"T10:51:10Z")};
      state[JSON.stringify([today,account.username,mode])]=job;
      records.push({id:[today,account.username,mode,job.attempts].join("|"),...job,attempt:job.attempts,reason:job.status==="failed"?"Kết nối website bị gián đoạn":undefined});
    }
    fs.writeFileSync(path.join(root,"data/history.jsonl"),records.map(r=>JSON.stringify(r)).join("\n")+"\n");
    await page.click("#tab-history");await page.waitForSelector("#history:not([hidden])");
    await page.waitForFunction(()=>document.querySelectorAll("#historyrows tr").length===2);
    await page.click("#history-week");
    await page.waitForFunction(()=>document.querySelector("#history-from").value!==document.querySelector("#history-to").value);
    await page.waitForFunction(()=>document.querySelector("#historyrows").textContent.includes("fixture-alpha"));
    if(qa)await page.screenshot({path:path.join(qa,"02-lich-su.png"),fullPage:true});
    await page.locator("#historyrows tr").filter({hasText:"fixture-alpha"}).getByRole("button",{name:"Chi tiết"}).click();
    await page.waitForSelector("#attempts-dialog[open]");
    assert.ok((await page.locator("#attempts-list").textContent()).includes("OUT"));
    if(qa)await page.screenshot({path:path.join(qa,"03-chi-tiet.png"),fullPage:true});
    await page.click("#attempts-close");
    await page.fill("#history-search","fixture-beta");assert.equal(await page.locator("#historyrows tr").count(),1);
    await page.setViewportSize({width:390,height:844});
    if(qa)await page.screenshot({path:path.join(qa,"04-mobile.png"),fullPage:true});
    await page.click("#tab-monitor");assert.ok(await page.locator("#activate").isVisible());
    const {prepareVerification}=require("../service/verification");
    const proofPage=await browser.newPage();
    await proofPage.setContent('<div id="proof">old status</div><button id="submit" onclick="document.querySelector(\'#proof\').textContent=\'Accepted today\'">Punch</button>');
    const verify=await prepareVerification(proofPage,{mode:"selector",selector:"#proof",expectedText:"Accepted",timeoutMs:1500});
    assert.equal((await verify(()=>proofPage.click("#submit"))).verified,true);
    assert.deepEqual(errors,[]);
    console.log("Bundled Node, Playwright, Chromium and dashboard UI smoke tests passed.");
  } finally {
    await browser?.close();
    server.closeAllConnections();await new Promise(r=>server.close(r));
    fs.rmSync(root,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
