const fs=require("fs"),path=require("path"),crypto=require("crypto");
const {clock}=require("./schedule"),{retryConfig}=require("./retry"),{validateVerification}=require("./verification");
const {rawAccounts,writeAccounts}=require("./accounts");
const envKeys=["LOGIN_URL","TARGET_URL","USERNAME_SELECTOR","PASSWORD_SELECTOR","SUBMIT_SELECTOR","BUTTON_IN_SELECTOR","BUTTON_OUT_SELECTOR"];
const revision=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function checkRevision(file,expected){if(expected!==revision(file)){const e=new Error("This file changed. Reload the editor before saving.");e.status=409;throw e;}}
function atomic(file,value){fs.writeFileSync(file+".tmp",JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(file+".tmp",file);}
function validateConfig(config){
 new Intl.DateTimeFormat("en",{timeZone:config.timezone}).format();
 if(!Array.isArray(config.weekdays) || !config.weekdays.length || !config.weekdays.every(n=>Number.isInteger(n)&&n>=0&&n<=6))throw new Error("Choose valid weekdays 0..6");
 for(const mode of ["IN","OUT"]){const w=config.windows?.[mode];if(!w || clock(w.from)>clock(w.to))throw new Error("Invalid "+mode+" time window");}
 for(const name of envKeys){if(typeof config.environment?.[name]!=="string" || !config.environment[name])throw new Error("Missing "+name);}
 for(const name of ["LOGIN_URL","TARGET_URL"]){const url=new URL(config.environment[name]);if(!["http:","https:"].includes(url.protocol) || url.username || url.password)throw new Error("Use HTTP/HTTPS URLs without embedded credentials");}
 retryConfig(config);validateVerification(config.verification);
 if(!Number.isFinite(config.pollSeconds) || config.pollSeconds<1 || config.pollSeconds>300)throw new Error("pollSeconds must be 1..300");
 if(!Number.isFinite(config.jobTimeoutSeconds) || config.jobTimeoutSeconds<30 || config.jobTimeoutSeconds>1200)throw new Error("jobTimeoutSeconds must be 30..1200");
 if(config.preflight && (!Number.isInteger(config.preflight.timeoutMs) || config.preflight.timeoutMs<1000 || config.preflight.timeoutMs>30000))throw new Error("Connectivity timeout must be 1000..30000");
 return config;
}
function validDate(value){return typeof value==="string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;}
function validateHolidays(value){
 if(!value || !Array.isArray(value.global) || !value.global.every(validDate) || !value.users || Array.isArray(value.users) || typeof value.users!=="object")throw new Error("Invalid holiday configuration");
 for(const [name,dates] of Object.entries(value.users))if(!name || !Array.isArray(dates) || !dates.every(validDate))throw new Error("Invalid dates for "+name);
 return value;
}
function editorSnapshot(root,configPath){
 const config=JSON.parse(fs.readFileSync(configPath,"utf8")),accountsFile=path.resolve(root,config.accountsFile),offFile=path.resolve(root,config.offDaysFile);
 const accounts=rawAccounts(accountsFile);
 return {configRevision:revision(configPath),accountsRevision:revision(accountsFile),holidaysRevision:revision(offFile),
  config:{timezone:config.timezone,weekdays:config.weekdays,windows:config.windows,maxRetries:config.maxRetries??3,
   retryDelaySeconds:config.retryDelaySeconds??60,pollSeconds:config.pollSeconds,jobTimeoutSeconds:config.jobTimeoutSeconds,
   environment:Object.fromEntries(envKeys.map(k=>[k,config.environment?.[k] || ""])),
   verification:config.verification || {mode:"none",timeoutMs:15000},preflight:config.preflight || {enabled:true,timeoutMs:5000}},
  accounts:accounts.map(a=>({username:a.username,enabled:a.enabled!==false,protected:!!a.passwordProtected})),
  holidays:JSON.parse(fs.readFileSync(offFile,"utf8")),protectionAvailable:process.platform==="win32" && !!process.env.PUNCH_HELPER_EXE};
}
function updateConfig(root,configPath,body){
 checkRevision(configPath,body.revision);
 const existing=JSON.parse(fs.readFileSync(configPath,"utf8"));
 const allowed=["timezone","weekdays","windows","maxRetries","retryDelaySeconds","pollSeconds","jobTimeoutSeconds","environment","verification","preflight"];
 const next={...existing};
 for(const key of allowed)if(Object.hasOwn(body.config || {},key))next[key]=body.config[key];
 validateConfig(next);atomic(configPath,next);return {saved:true};
}
function updateHolidays(root,configPath,body){
 const config=JSON.parse(fs.readFileSync(configPath,"utf8")),file=path.resolve(root,config.offDaysFile);
 checkRevision(file,body.revision);validateHolidays(body.holidays);atomic(file,body.holidays);return {saved:true};
}
function updateAccounts(root,configPath,body){
 const config=JSON.parse(fs.readFileSync(configPath,"utf8")),file=path.resolve(root,config.accountsFile);
 checkRevision(file,body.revision);
 if(!Array.isArray(body.accounts) || !body.accounts.length)throw new Error("Add at least one account");
 const previous=rawAccounts(file),names=new Set();
 const next=body.accounts.map(a=>{
  if(typeof a.username!=="string" || !a.username.trim() || a.username.length>120 || names.has(a.username))throw new Error("Invalid or duplicate username");
  names.add(a.username);
  const old=previous.find(p=>p.username===a.username);
  if(a.password!==undefined && typeof a.password!=="string")throw new Error("Password must be text");
  if(a.password)return {username:a.username,password:a.password,enabled:a.enabled!==false};
  if(!old)throw new Error("New account needs a password");
  return {...old,enabled:a.enabled!==false};
 });
 writeAccounts(file,next);return {saved:true,protected:true};
}
module.exports={revision,validateConfig,validDate,validateHolidays,editorSnapshot,updateConfig,updateHolidays,updateAccounts};
