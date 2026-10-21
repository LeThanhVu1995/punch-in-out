const http=require("http"),https=require("https");
function checkUrl(value,timeoutMs=5000){
 return new Promise(resolve=>{
  let url;
  try{url=new URL(value);if(!["http:","https:"].includes(url.protocol) || url.username || url.password)throw Error();}
  catch{return resolve({ok:false,error:"Invalid HTTP/HTTPS URL"});}
  const request=(url.protocol==="https:"?https:http).get(url,{headers:{"User-Agent":"PunchService-connectivity-check"}},response=>{
   const status=response.statusCode;response.resume();request.destroy();
   resolve({ok:status<500,status,error:status>=500?"Website returned HTTP "+status:undefined,host:url.host});
  });
  const timer=setTimeout(()=>request.destroy(new Error("Connection timeout")),timeoutMs);
  request.once("close",()=>clearTimeout(timer));
  request.once("error",error=>resolve({ok:false,host:url.host,error:error.code || error.message}));
 });
}
async function checkConnectivity(config){
 const started=Date.now(),timeoutMs=config.preflight?.timeoutMs ?? 5000;
 const results=await Promise.all(["LOGIN_URL","TARGET_URL"].map(async name=>({name,...await checkUrl(config.environment?.[name] || process.env[name],timeoutMs)})));
 return {checkedAt:new Date().toISOString(),ok:results.every(r=>r.ok),durationMs:Date.now()-started,results};
}
module.exports={checkUrl,checkConnectivity};
