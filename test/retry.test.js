const {test} = require("node:test");
const assert = require("node:assert/strict");
const {complete, outcome, retryConfig} = require("../service/retry");
const {plan} = require("../service/schedule");
test("initial attempt plus three retries, then failed",()=>{
  const job={};
  for(let attempt=1;attempt<=4;attempt++){
    job.attempts=attempt;
    complete(job,{phase:"before_click"},{},new Date("2026-10-21T00:30:00Z"));
    assert.equal(job.status,attempt<4?"pending":"failed");
    if(attempt<4) assert.equal(job.nextRetryAt,"2026-10-21T00:31:00.000Z");
  }
});
test("never retries a click that may already have reached the server",()=>{
  for(const phase of ["click_started",undefined]) {
    const job={attempts:1};complete(job,{phase},{});
    assert.equal(job.status,"unknown");assert.equal(job.nextRetryAt,undefined);
  }
  const job={attempts:2};complete(job,{phase:"clicked"},{});
  assert.equal(job.status,"clicked");
  assert.equal(outcome({phase:"before_click"}),"retryable");
});
test("retry policy defaults work for existing config and rejects invalid values",()=>{
  assert.deepEqual(retryConfig({}),{maxRetries:3,retryDelaySeconds:60});
  assert.throws(()=>retryConfig({maxRetries:4}));
  assert.throws(()=>retryConfig({retryDelaySeconds:0}));
  const job={attempts:1};complete(job,{phase:"before_click"},{maxRetries:0});
  assert.equal(job.status,"failed");
});
test("retry time persists and expired window prevents further attempts",()=>{
  const config={timezone:"Asia/Ho_Chi_Minh",weekdays:[1,2,3,4,5],
    windows:{IN:{from:"07:20",to:"08:30"},OUT:{from:"17:40",to:"18:35"}}};
  const key=JSON.stringify(["2026-10-21","fake","IN"]);
  const state={[key]:{date:"2026-10-21",username:"fake",mode:"IN",due:0,attempts:1,status:"running"}};
  complete(state[key],{phase:"before_click"},{},new Date("2026-10-21T00:30:00Z"));
  const restored=JSON.parse(JSON.stringify(state));
  const accounts=[{username:"fake",password:"placeholder"}];
  assert.equal(plan(config,{},accounts,restored,new Date("2026-10-21T00:30:59Z")).jobs.length,0);
  assert.equal(plan(config,{},accounts,restored,new Date("2026-10-21T00:31:00Z")).jobs.length,1);
  plan(config,{},accounts,restored,new Date("2026-10-21T01:30:01Z"));
  assert.equal(restored[key].status,"missed");
});

test("worker retries failing account independently, persists evidence and recovers on restart", {timeout:20000}, async()=>{
  const fs=require("node:fs"), os=require("node:os"), path=require("node:path");
  const {spawn}=require("node:child_process");
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),"punch-retry-"));
  fs.mkdirSync(path.join(folder,"service"));
  for(const name of ["worker.js","schedule.js","retry.js","manual.js","dashboard.js"])
    fs.copyFileSync(path.join(__dirname,"../service",name),path.join(folder,"service",name));
  // Stub the browser runner: this test cannot contact the attendance website.
  fs.writeFileSync(path.join(folder,"run.js"), [
    'const fs=require("fs");',
    'if(process.env.ACCOUNT_USERNAME==="good") fs.writeFileSync(process.env.ATTEMPT_PROGRESS_FILE,JSON.stringify({phase:"clicked"}));',
    'else if(process.env.ACCOUNT_USERNAME==="ambiguous") fs.writeFileSync(process.env.ATTEMPT_PROGRESS_FILE,JSON.stringify({phase:"click_started"}));',
    'process.exit(process.env.ACCOUNT_USERNAME==="good"?0:1);'
  ].join("\n"));
  const now=new Date(), date=now.toISOString().slice(0,10);
  const config={dashboard:{enabled:false},timezone:"UTC",weekdays:[0,1,2,3,4,5,6],
    windows:{IN:{from:"00:00",to:"23:59"},OUT:{from:"00:00",to:"23:59"}},
    accountsFile:"accounts.json",offDaysFile:"off.json",pollSeconds:1,jobTimeoutSeconds:5,retryDelaySeconds:1,
    environment:Object.fromEntries(["LOGIN_URL","TARGET_URL","USERNAME_SELECTOR","PASSWORD_SELECTOR","SUBMIT_SELECTOR","BUTTON_IN_SELECTOR","BUTTON_OUT_SELECTOR"].map(k=>[k,"unused"]))};
  fs.writeFileSync(path.join(folder,"config.json"),JSON.stringify(config));
  fs.writeFileSync(path.join(folder,"accounts.json"),JSON.stringify(["bad","good","ambiguous"].map(username=>({username,password:"placeholder"}))));
  fs.writeFileSync(path.join(folder,"off.json"),JSON.stringify({skipWeekends:false}));
  fs.mkdirSync(path.join(folder,"data"));
  const state={};
  for(const username of ["bad","good","ambiguous"]) for(const mode of ["IN","OUT"])
    state[JSON.stringify([date,username,mode])]={date,username,mode,due:0,status:mode==="IN"?"pending":"clicked"};
  const stateFile=path.join(folder,"data/state.json");
  fs.writeFileSync(stateFile,JSON.stringify(state));
  let child;
  function start(){child=spawn(process.execPath,[path.join(folder,"service/worker.js")],{stdio:"ignore"});}
  async function waitFor(predicate){
    for(let n=0;n<100;n++){
      const current=JSON.parse(fs.readFileSync(stateFile,"utf8"));
      if(predicate(current))return current;
      if(child.exitCode!==null)throw new Error("worker stopped unexpectedly");
      await new Promise(r=>setTimeout(r,100));
    }
    throw new Error("worker did not reach expected state");
  }
  async function stop(){const done=new Promise(r=>child.once("exit",r));child.kill();await done;}
  try{
    start();
    await waitFor(s=>s[JSON.stringify([date,"bad","IN"])].attempts>=2);
    await stop();
    start();
    const final=await waitFor(s=>s[JSON.stringify([date,"bad","IN"])].status==="failed");
    assert.equal(final[JSON.stringify([date,"bad","IN"])].attempts,4);
    assert.equal(final[JSON.stringify([date,"good","IN"])].status,"clicked");
    assert.equal(final[JSON.stringify([date,"good","IN"])].attempts,1);
    assert.equal(final[JSON.stringify([date,"ambiguous","IN"])].status,"unknown");
    assert.equal(final[JSON.stringify([date,"ambiguous","IN"])].attempts,1);
    assert.ok(fs.existsSync(path.join(folder,"data/runs",date,Buffer.from("bad").toString("hex")+"-IN","attempt-4","progress.json")));
  }finally{
    if(child && child.exitCode===null)await stop();
    fs.rmSync(folder,{recursive:true,force:true});
  }
});
