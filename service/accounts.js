const fs=require("fs"),path=require("path"),{spawnSync}=require("child_process");
function helper(command,input="",file){
 const exe=process.env.PUNCH_HELPER_EXE;
 if(process.platform!=="win32" || !exe)throw new Error("Password protection requires the Windows EXE. Run install/upgrade first.");
 const result=spawnSync(exe,[command,...(file?[file]:[])],{input,encoding:"utf8",windowsHide:true,maxBuffer:1024*1024,timeout:20000});
 if(result.error || result.status!==0)throw new Error("Windows credential operation failed; check service account and file permissions.");
 return command==="credential-unprotect"?result.stdout:result.stdout.trimEnd();
}
function rawAccounts(file,unprotect=value=>helper("credential-unprotect",value)){
 const data=JSON.parse(fs.readFileSync(file,"utf8"));
 if(!Array.isArray(data))throw new Error("Accounts file must be a JSON array");
 const names=new Set();
 for(const a of data){
  if(a.usernameProtected)a.username=unprotect(a.usernameProtected);
  if(typeof a.username!=="string" || !a.username.trim() || a.username.length>120 || names.has(a.username))
   throw new Error("Account usernames must be unique, non-empty strings");
  names.add(a.username);
  if(!(typeof a.password==="string" && a.password) && !(typeof a.passwordProtected==="string" && a.passwordProtected))
   throw new Error("Account needs a password: "+a.username);
 }
 return data;
}
let cache;
function loadAccounts(file){
 const stat=fs.statSync(file),key=file+":"+stat.mtimeMs+":"+stat.ctimeMs+":"+stat.ino+":"+stat.size;
 if(cache?.key===key)return cache.accounts;
 const accounts=rawAccounts(file).map(a=>({...a,password:a.passwordProtected?helper("credential-unprotect",a.passwordProtected):a.password}));
 cache={key,accounts};return accounts;
}
function protectedAccounts(accounts,protect=value=>helper("credential-protect",value)){
 return accounts.map(a=>({usernameProtected:protect(a.username),enabled:a.enabled!==false,passwordProtected:
  a.passwordProtected && !a.password?a.passwordProtected:protect(a.password)}));
}
function writeAccounts(file,accounts){
 const protectedRows=protectedAccounts(accounts);
 const temporary=file+".tmp";
 fs.writeFileSync(temporary,JSON.stringify(protectedRows,null,2),{mode:0o600});
 try{helper("credential-lock","",temporary);fs.renameSync(temporary,file);}
 catch(error){try{fs.unlinkSync(temporary);}catch{}throw error;}
 cache=undefined;
}
module.exports={helper,rawAccounts,loadAccounts,protectedAccounts,writeAccounts};
