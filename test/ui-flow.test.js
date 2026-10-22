const {test}=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),net=require("node:net"),{once}=require("node:events");
const {leaveSnapshot,updateLeave,legacyEntries,datesBetween}=require("../service/leave");
const {revision}=require("../service/configuration"),{historyReport}=require("../service/history-report"),{startDashboard}=require("../service/dashboard");
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"punch-leave-flow-")),file=path.join(root,"off.json");
 fs.mkdirSync(path.join(root,"data"));
 fs.writeFileSync(file,JSON.stringify({timezone:"UTC",skipWeekends:true,global:["2026-12-24","2026-12-25"],users:{alpha:["2026-12-25"]},startDelayMinSec:60}));
 return {root,file,config:{timezone:"UTC",offDaysFile:"off.json"},accounts:[{username:"alpha",password:"fixture-private"},{username:"beta",password:"fixture-private"}]};
}
test("legacy dates become editable ranges without mutating the file on read",()=>{
 const fixtureData=fixture(),{root,file,config,accounts}=fixtureData;
 try{
  const original=fs.readFileSync(file,"utf8"),snapshot=leaveSnapshot(root,config,accounts);
  assert.equal(snapshot.registrations.length,2);
  assert.equal(snapshot.registrations.find(e=>e.scope==="all").from,"2026-12-24");
  assert.equal(snapshot.registrations.find(e=>e.scope==="all").to,"2026-12-25");
  assert.equal(fs.readFileSync(file,"utf8"),original);
  assert.ok(!JSON.stringify(snapshot).includes("fixture-private"));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test("create/edit/delete leave recomputes unions and preserves overlapping registrations",()=>{
 const {root,file,config,accounts}=fixture();
 try{
  const entry={id:"registration-test-001",scope:"users",usernames:["alpha","beta"],from:"2026-12-25",to:"2026-12-27",note:"Family leave"};
  updateLeave(root,config,accounts,{action:"create",revision:revision(file),entry});
  let saved=JSON.parse(fs.readFileSync(file,"utf8"));
  assert.deepEqual(saved.users.beta,["2026-12-25","2026-12-26","2026-12-27"]);
  assert.equal(saved.startDelayMinSec,60);
  updateLeave(root,config,accounts,{action:"update",revision:revision(file),entry:{...entry,usernames:["beta"],from:"2026-12-26",to:"2026-12-27",note:"Updated"}});
  saved=JSON.parse(fs.readFileSync(file,"utf8"));
  assert.deepEqual(saved.users.alpha,["2026-12-25"]);assert.equal(saved.registrations.find(e=>e.id===entry.id).note,"Updated");
  updateLeave(root,config,accounts,{action:"delete",revision:revision(file),id:entry.id});
  saved=JSON.parse(fs.readFileSync(file,"utf8"));
  assert.equal(saved.users.beta,undefined);assert.deepEqual(saved.global,["2026-12-24","2026-12-25"]);
  assert.deepEqual(saved.users.alpha,["2026-12-25"]);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test("duplicate creates are idempotent, stale edits and invalid ranges are rejected",()=>{
 const {root,file,config,accounts}=fixture();
 try{
  const rev=revision(file),entry={id:"registration-test-002",scope:"all",usernames:[],from:"2026-12-31",to:"2027-01-01",note:"New year"};
  updateLeave(root,config,accounts,{action:"create",revision:rev,entry});
  assert.equal(updateLeave(root,config,accounts,{action:"create",revision:rev,entry}).duplicate,true);
  assert.throws(()=>updateLeave(root,config,accounts,{action:"delete",revision:rev,id:entry.id}),/thay đổi/);
  assert.throws(()=>datesBetween("2026-02-30","2026-03-01"));
  assert.throws(()=>datesBetween("2026-12-31","2026-12-30"));
  assert.throws(()=>datesBetween("2026-01-01","2028-01-01"));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test("history groups IN/OUT by day and user, retains expected times and all attempts",()=>{
 const {root}=fixture();
 try{
  const rows=[
   {id:"2026-10-21|alpha|IN|1",date:"2026-10-21",username:"alpha",mode:"IN",attempt:1,status:"pending",startedAt:"2026-10-21T00:30:00Z",reason:"network"},
   {id:"2026-10-21|alpha|IN|2",date:"2026-10-21",username:"alpha",mode:"IN",attempt:2,status:"success",startedAt:"2026-10-21T00:31:00Z"},
   {id:"2026-10-21|alpha|OUT|1",date:"2026-10-21",username:"alpha",mode:"OUT",attempt:1,status:"failed",startedAt:"2026-10-21T10:45:00Z"}
  ];
  fs.writeFileSync(path.join(root,"data/history.jsonl"),rows.map(row=>JSON.stringify(row)).join("\n")+"\n");
  const state={in:{date:"2026-10-21",username:"alpha",mode:"IN",status:"success",due:27000,attempts:2,startedAt:"2026-10-21T00:31:00Z"},
   pending:{date:"2026-10-22",username:"beta",mode:"IN",status:"pending",due:28000,attempts:0}};
  const report=historyReport(root,state,"2026-10-21","2026-10-22");
  assert.equal(report.groups.length,2);
  const alpha=report.groups.find(g=>g.username==="alpha");assert.equal(alpha.IN.due,27000);assert.equal(alpha.OUT.status,"failed");assert.equal(alpha.recordsCount,3);
  assert.equal(report.rows.filter(r=>!r.legacy).length,3);
  assert.throws(()=>historyReport(root,state,"2026-09-01","2026-10-22"));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test("leave and range history APIs keep origin protection and do not expose passwords",async()=>{
 const data=fixture(),reserve=net.createServer();reserve.listen(0,"127.0.0.1");await once(reserve,"listening");
 const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const config={...data.config,dashboard:{port}},server=await startDashboard({root:data.root,state:{},save(){},settings:()=>({config,accounts:data.accounts}),stopping:()=>false,wake(){}});
 const base="http://127.0.0.1:"+port;
 try{
  const status=await (await fetch(base+"/api/status")).json();
  const leave=await (await fetch(base+"/api/leave")).json();assert.ok(!JSON.stringify(leave).includes("fixture-private"));
  const body=JSON.stringify({action:"create",revision:leave.revision,entry:{id:"registration-test-003",scope:"all",usernames:[],from:"2026-12-30",to:"2026-12-31",note:"Fixture"}});
  const headers={"Content-Type":"application/json","X-Punch-Token":status.token,Origin:"https://not-local.example"};
  assert.equal((await fetch(base+"/api/leave",{method:"POST",headers,body})).status,403);
  headers.Origin=base;assert.equal((await fetch(base+"/api/leave",{method:"POST",headers,body})).status,200);
  const history=await (await fetch(base+"/api/history?from=2026-10-21&to=2026-10-22")).json();assert.equal(history.from,"2026-10-21");assert.ok(Array.isArray(history.groups));
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(data.root,{recursive:true,force:true});}
});
