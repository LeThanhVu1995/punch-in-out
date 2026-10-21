const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),net=require("node:net");
const {once}=require("node:events");
const {enqueue,dueJobs}=require("../service/manual");
const {complete}=require("../service/retry");
const {startDashboard}=require("../service/dashboard");
const now=new Date("2026-10-21T15:00:00Z"),date="2026-10-21";
const config={timezone:"UTC",weekdays:[1,2,3,4,5],windows:{IN:{from:"07:20",to:"08:30"},OUT:{from:"17:40",to:"18:35"}}};
const accounts=[{username:"alpha",password:"fixture-private"},{username:"beta",password:"other-private"}];
const key=(user,mode="OUT")=>JSON.stringify([date,user,mode]);
test("manual runs bypass time and holiday but only for today's selected mode",()=>{
 const state={};const request={requestId:"test-request-0001",scope:"all",mode:"OUT"};
 assert.equal(enqueue(config,accounts,state,request,now).queued,2);
 assert.equal(dueJobs(config,{global:[date]},accounts,state,now).length,2);
 assert.ok(Object.values(state).every(j=>j.mode==="OUT"));
 assert.equal(enqueue(config,accounts,state,request,now).queued,0);
 assert.equal(dueJobs(config,{},accounts,state,new Date("2026-10-22T01:00:00Z")).some(j=>j.job.manualRequestedAt),false);
 assert.equal(state[key("alpha")].status,"missed");
});
test("repeating ambiguous/completed jobs requires explicit confirmation and running jobs are skipped",()=>{
 const state={
 [key("alpha")]:{date,username:"alpha",mode:"OUT",status:"clicked",attempts:4},
 [key("beta")]:{date,username:"beta",mode:"OUT",status:"running",attempts:1}
 };
 const req={requestId:"test-request-0002",scope:"all",mode:"OUT"};
 assert.throws(()=>enqueue(config,accounts,state,req,now),/explicitly confirm/);
 assert.equal(state[key("alpha")].status,"clicked");
 assert.deepEqual(enqueue(config,accounts,state,{...req,confirmRepeat:true},now),{queued:1,skipped:1,date,mode:"OUT"});
 assert.equal(state[key("alpha")].attempts,4);
 assert.equal(state[key("alpha")].attemptsInCycle,0);
 const restored=JSON.parse(JSON.stringify(state));
 restored[key("alpha")].status="clicked";
 assert.equal(enqueue(config,accounts,restored,req,now).queued,0);
 const job=restored[key("alpha")];job.attempts++;job.attemptsInCycle++;
 complete(job,{phase:"before_click"},{},now);
 assert.equal(job.status,"pending");
});
test("failed scope does not replay completed or pending accounts",()=>{
 const state={
 [key("alpha")]:{date,username:"alpha",mode:"OUT",status:"failed"},
 [key("beta")]:{date,username:"beta",mode:"OUT",status:"clicked"}
 };
 assert.equal(enqueue(config,accounts,state,{requestId:"test-request-0003",scope:"failed",mode:"OUT"},now).queued,1);
 assert.equal(state[key("beta")].status,"clicked");
 assert.throws(()=>enqueue(config,accounts,state,{requestId:"test-request-0004",scope:"all",mode:"BOTH"},now));
});
async function freePort(){
 const server=net.createServer();server.listen(0,"127.0.0.1");await once(server,"listening");
 const port=server.address().port;await new Promise(r=>server.close(r));return port;
}
test("dashboard exposes no credentials, rejects cross-origin commands, redacts logs and persists commands",async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"punch-dashboard-"));
 fs.mkdirSync(path.join(root,"data"));
 const port=await freePort(),state={};
 const service=await startDashboard({root,state,save(){},settings:()=>({config:{...config,dashboard:{port}},accounts}),stopping:()=>false,wake(){}});
 const url="http://127.0.0.1:"+port;
 try{
  const response=await fetch(url+"/api/status"),status=await response.json();
  assert.equal(response.status,200);assert.equal(status.jobs.length,4);
  assert.ok(!JSON.stringify(status).includes("fixture-private"));
  assert.ok(!JSON.stringify(status).includes("password"));
  const html=await (await fetch(url)).text();assert.ok(html.includes("Punch Control"));
  const body=JSON.stringify({requestId:"test-request-0005",scope:"all",mode:"OUT"});
  const headers={"Content-Type":"application/json","X-Punch-Token":status.token,Origin:"https://other.example"};
  assert.equal((await fetch(url+"/api/run",{method:"POST",headers,body})).status,403);
  headers.Origin=url;headers["X-Punch-Token"]="invalid";
  assert.equal((await fetch(url+"/api/run",{method:"POST",headers,body})).status,403);
  headers["X-Punch-Token"]=status.token;
  const result=await fetch(url+"/api/run",{method:"POST",headers,body});assert.equal(result.status,200);
  assert.equal((await result.json()).queued,2);
  const currentDate=(await (await fetch(url+"/api/status")).json()).date;
  const job=state[JSON.stringify([currentDate,"alpha","OUT"])];
  const dir=path.join("data","runs","fixture");fs.mkdirSync(path.join(root,dir),{recursive:true});
  job.progressFile=path.join(dir,"progress.json");
  fs.writeFileSync(path.join(root,dir,"run.log"),"failure fixture-private");
  const log=await (await fetch(url+"/api/log?username=alpha&mode=OUT")).json();
  assert.equal(log.text,"failure [REDACTED]");
  assert.ok(!fs.readFileSync(path.join(root,"data/manual-actions.jsonl"),"utf8").includes("fixture-private"));
 }finally{
  service.closeAllConnections();await new Promise(r=>service.close(r));
  fs.rmSync(root,{recursive:true,force:true});
 }
});
test("live worker handles dashboard manual command without live browser or duplicate clicks", {timeout:20000},async()=>{
 const {spawn}=require("node:child_process");
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"punch-dashboard-worker-"));
 fs.mkdirSync(path.join(root,"service"));
 for(const name of ["worker.js","schedule.js","retry.js","manual.js","dashboard.js"])
  fs.copyFileSync(path.join(__dirname,"../service",name),path.join(root,"service",name));
 fs.writeFileSync(path.join(root,"run.js"),'const fs=require("fs");console.log("stub attempt");fs.writeFileSync(process.env.ATTEMPT_PROGRESS_FILE,JSON.stringify({phase:"clicked"}));');
 const port=await freePort(),url="http://127.0.0.1:"+port;
 const cfg={...config,accountsFile:"accounts.json",offDaysFile:"off.json",dashboard:{port},pollSeconds:1,jobTimeoutSeconds:5,
  environment:Object.fromEntries(["LOGIN_URL","TARGET_URL","USERNAME_SELECTOR","PASSWORD_SELECTOR","SUBMIT_SELECTOR","BUTTON_IN_SELECTOR","BUTTON_OUT_SELECTOR"].map(k=>[k,"unused"]))};
 fs.writeFileSync(path.join(root,"config.json"),JSON.stringify(cfg));
 fs.writeFileSync(path.join(root,"accounts.json"),JSON.stringify(accounts));
 const dateNow=new Date().toISOString().slice(0,10);
 fs.writeFileSync(path.join(root,"off.json"),JSON.stringify({global:[dateNow]}));
 const child=spawn(process.execPath,[path.join(root,"service/worker.js")],{stdio:"ignore"});
 try{
  let status;
  for(let i=0;i<80;i++){
   try{status=await (await fetch(url+"/api/status")).json();break;}catch{await new Promise(r=>setTimeout(r,100));}
  }
  assert.ok(status,"dashboard should start");
  const body=JSON.stringify({requestId:"integration-request-01",mode:"OUT",scope:"all"});
  const options={method:"POST",headers:{"Content-Type":"application/json","X-Punch-Token":status.token,Origin:url},body};
  assert.equal((await fetch(url+"/api/run",options)).status,200);
  assert.equal((await fetch(url+"/api/run",options)).status,200);
  for(let i=0;i<80;i++){
    status=await (await fetch(url+"/api/status")).json();
    if(status.jobs.filter(j=>j.mode==="OUT").every(j=>j.status==="clicked"))break;
    await new Promise(r=>setTimeout(r,100));
  }
  const out=status.jobs.filter(j=>j.mode==="OUT");
  assert.ok(out.every(j=>j.status==="clicked" && j.attempts===1));
  assert.ok(status.jobs.filter(j=>j.mode==="IN").every(j=>j.attempts===0));
 }finally{
  if(child.exitCode===null){const exited=once(child,"exit");child.kill();await exited;}
  fs.rmSync(root,{recursive:true,force:true});
 }
});
