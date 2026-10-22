const {test}=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),http=require("node:http");
const {once}=require("node:events");
const {protectedAccounts,loadAccounts,rawAccounts}=require("../service/accounts");
const {checkUrl,checkConnectivity}=require("../service/connectivity");
const {validateConfig,validateHolidays,revision,editorSnapshot,updateConfig}=require("../service/configuration");
const {record,readHistory}=require("../service/history");
const {prepareVerification,validateVerification,jsonValue}=require("../service/verification");
const {complete}=require("../service/retry");
test("account protection never serializes plaintext usernames or passwords and retains sealed passwords",()=>{
 const result=protectedAccounts([{username:"one",password:"fixture password"},{username:"two",passwordProtected:"already-sealed"}],value=>"sealed:"+Buffer.from(value).toString("base64"));
 assert.ok(!JSON.stringify(result).includes("fixture password"));
 assert.equal(result[1].passwordProtected,"already-sealed");
 assert.ok(result.every(a=>!Object.hasOwn(a,"username") && !Object.hasOwn(a,"password")));
 assert.equal(result[0].usernameProtected,"sealed:"+Buffer.from("one").toString("base64"));
});
test("Windows DPAPI helper roundtrip, access controls and encrypted account read", {skip:process.platform!=="win32" || !process.env.PUNCH_HELPER_EXE},()=>{
 const {helper,writeAccounts}=require("../service/accounts");
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"punch-dpapi-")),file=path.join(root,"accounts.json");
 try{
  const pass="fixture trailing space ";
  const sealed=helper("credential-protect",pass);assert.notEqual(sealed,pass);
  assert.equal(helper("credential-unprotect",sealed),pass);
  writeAccounts(file,[{username:"one",password:pass}]);
  assert.ok(!fs.readFileSync(file,"utf8").includes(pass));
  assert.equal(loadAccounts(file)[0].password,pass);
  assert.equal(loadAccounts(file)[0].username,"one");
  let saved=JSON.parse(fs.readFileSync(file,"utf8"));
  assert.ok(saved.every(a=>!Object.hasOwn(a,"username") && !Object.hasOwn(a,"password")));
  fs.writeFileSync(file,JSON.stringify([{username:"legacy-fixture",passwordProtected:sealed},saved[0]]));
  writeAccounts(file,rawAccounts(file));
  assert.deepEqual(loadAccounts(file).map(a=>a.username),["legacy-fixture","one"]);
  assert.equal(loadAccounts(file)[0].password,pass);
  const configPath=path.join(root,"config.json");
  fs.writeFileSync(configPath,JSON.stringify({accountsFile:"accounts.json"}));
  const {updateAccounts}=require("../service/configuration");
  updateAccounts(root,configPath,{revision:revision(file),accounts:[{username:"one",enabled:false,password:""},{username:"new-user",password:"new-fixture"}]});
  assert.deepEqual(loadAccounts(file).map(a=>[a.username,a.enabled]),[["one",false],["new-user",true]]);
  assert.equal(loadAccounts(file)[0].password,pass);
  assert.equal(loadAccounts(file)[1].password,"new-fixture");
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test("connectivity detects HTTP failures without sending credentials or attendance",async()=>{
 const server=http.createServer((req,res)=>{res.statusCode=req.url==="/bad"?503:200;res.end("fixture");});
 server.listen(0,"127.0.0.1");await once(server,"listening");const url="http://127.0.0.1:"+server.address().port;
 try{
  assert.equal((await checkUrl(url)).ok,true);assert.equal((await checkUrl(url+"/bad")).ok,false);
  assert.equal((await checkUrl("ftp://example")).ok,false);
  assert.equal((await checkConnectivity({environment:{LOGIN_URL:url,TARGET_URL:url+"/bad"},preflight:{timeoutMs:1000}})).ok,false);
 }finally{await new Promise(r=>server.close(r));}
});
test("settings validation and optimistic revision preserve file paths and reject stale edits",()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"punch-settings-"));
 const config={timezone:"Asia/Ho_Chi_Minh",weekdays:[1,2,3,4,5],windows:{IN:{from:"07:20",to:"08:30"},OUT:{from:"17:40",to:"18:35"}},
  accountsFile:"accounts.json",offDaysFile:"off.json",pollSeconds:15,jobTimeoutSeconds:300,
  environment:{LOGIN_URL:"https://example.test",TARGET_URL:"https://example.test/attendance",USERNAME_SELECTOR:"#user",PASSWORD_SELECTOR:"#pass",SUBMIT_SELECTOR:"#submit",BUTTON_IN_SELECTOR:"#in",BUTTON_OUT_SELECTOR:"#out"}};
 const file=path.join(root,"config.json");fs.writeFileSync(file,JSON.stringify(config));
 fs.writeFileSync(path.join(root,"accounts.json"),JSON.stringify([{username:"one",password:"fixture-private"}]));
 fs.writeFileSync(path.join(root,"off.json"),JSON.stringify({global:[],users:{}}));
 try{
  assert.equal(validateConfig(config),config);
  assert.throws(()=>validateConfig({...config,windows:{...config.windows,IN:{from:"09:00",to:"08:00"}}}));
  assert.throws(()=>validateHolidays({global:["2026-02-30"],users:{}}));
  const edit=editorSnapshot(root,file);assert.ok(!JSON.stringify(edit).includes("fixture-private"));
  const rev=revision(file);
  updateConfig(root,file,{revision:rev,config:{maxRetries:2,accountsFile:"do-not-change.json"}});
  assert.equal(JSON.parse(fs.readFileSync(file,"utf8")).accountsFile,"accounts.json");
  assert.throws(()=>updateConfig(root,file,{revision:rev,config:{maxRetries:1}}),/changed/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test("history retains separate attempts, dates and verification evidence",()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"punch-history-"));fs.mkdirSync(path.join(root,"data"));
 const job={date:"2026-10-21",username:"one",mode:"IN",attempts:1,status:"pending",startedAt:"2026-10-21T00:20:00Z",finishedAt:"2026-10-21T00:20:01Z"};
 try{
  record(root,job,{phase:"before_click",reason:"network failed"});
  record(root,{...job,attempts:2,status:"success"},{phase:"verified",verification:{verified:true}});
  assert.equal(readHistory(root,{},"2026-10-21").length,2);
  assert.equal(readHistory(root,{},"2026-10-20").length,0);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test("verification requires configured business evidence, fresh text and matching JSON",async()=>{
 assert.equal(jsonValue({data:{accepted:true}},"data.accepted"),true);
 assert.throws(()=>validateVerification({mode:"response"}));
 let text="previous",clicked=false;
 const page={locator:()=>({first(){return this;},textContent:async()=>text,isVisible:async()=>true})};
 const verify=await prepareVerification(page,{mode:"selector",selector:"#status",expectedText:"Accepted",timeoutMs:1000});
 const result=await verify(async()=>{clicked=true;text="Accepted today";});
 assert.equal(clicked,true);assert.equal(result.verified,true);
 const stale=await prepareVerification(page,{mode:"selector",selector:"#status",expectedText:"Accepted",timeoutMs:1000});
 assert.equal((await stale(async()=>{})).verified,false);
 const response={url:()=>"https://example.test/punch",request:()=>({method:()=>"POST"}),ok:()=>true,status:()=>200,json:async()=>({data:{accepted:false}})};
 const verifyResponse=await prepareVerification({waitForResponse:async predicate=>{assert.ok(predicate(response));return response;}},{mode:"response",urlIncludes:"/punch",jsonPath:"data.accepted",equals:true,timeoutMs:1000});
 assert.equal((await verifyResponse(async()=>{})).verified,false);
 const verified={attempts:1};complete(verified,{phase:"verified",verification:{verified:true}},{});assert.equal(verified.status,"success");
});

test("mixed legacy and sealed usernames decode before validation and settings edits",()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"punch-usernames-")),file=path.join(root,"accounts.json");
 try{
  fs.writeFileSync(file,JSON.stringify([{username:"legacy",password:"fixture"},{usernameProtected:"sealed-user",passwordProtected:"sealed-pass"}]));
  const rows=rawAccounts(file,value=>value==="sealed-user"?"protected-user":value);
  assert.deepEqual(rows.map(a=>a.username),["legacy","protected-user"]);
  fs.writeFileSync(file,JSON.stringify([{username:"duplicate",password:"fixture"},{usernameProtected:"sealed-user",passwordProtected:"sealed-pass"}]));
  assert.throws(()=>rawAccounts(file,()=>"duplicate"),/unique/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
