function validateVerification(value={}){
 if(!["none","selector","response"].includes(value.mode || "none"))throw new Error("Invalid verification mode");
 const timeoutMs=value.timeoutMs ?? 15000;
 if(!Number.isInteger(timeoutMs) || timeoutMs<1000 || timeoutMs>60000)throw new Error("Verification timeout must be 1000..60000 ms");
 if(value.mode==="selector" && (!value.selector || !value.expectedText))throw new Error("Verification needs a selector and expected success text");
 if(value.mode==="response" && (!value.urlIncludes || !value.jsonPath || !Object.hasOwn(value,"equals")))
  throw new Error("Response verification needs URL text, JSON path and expected JSON value");
 return {...value,mode:value.mode || "none",timeoutMs};
}
function jsonValue(value,jsonPath){
 return jsonPath.split(".").reduce((current,key)=>current!==null && current!==undefined && Object.hasOwn(Object(current),key)?current[key]:undefined,value);
}
async function prepareVerification(page,config){
 const rule=validateVerification(config);
 let baseline=null;
 if(rule.mode==="selector")baseline=await page.locator(rule.selector).first().textContent({timeout:1000}).catch(()=>null);
 return async function verify(click){
  if(rule.mode==="response"){
   const responsePromise=page.waitForResponse(r=>r.url().includes(rule.urlIncludes) &&
    (!rule.method || r.request().method()===rule.method),{timeout:rule.timeoutMs}).catch(()=>null);
   await click();
   const response=await responsePromise;
   if(!response)return {verified:false,reason:"No matching website response before timeout"};
   const json=await response.json().catch(()=>null);
   const accepted=response.ok() && JSON.stringify(jsonValue(json,rule.jsonPath))===JSON.stringify(rule.equals);
   return {verified:accepted,reason:accepted?"Website success response matched":"Website response did not match configured success condition",
    evidence:{kind:"response",status:response.status(),jsonPath:rule.jsonPath}};
  }
  await click();
  if(rule.mode==="none")return {verified:false,reason:"Verification is not configured"};
  const deadline=Date.now()+rule.timeoutMs;
  while(Date.now()<deadline){
   const locator=page.locator(rule.selector).first();
   const visible=await locator.isVisible().catch(()=>false);
   const text=visible?await locator.textContent({timeout:1000}).catch(()=>null):null;
   if(text!==null && text!==baseline && text.includes(rule.expectedText))
    return {verified:true,reason:"Fresh website success text matched",evidence:{kind:"selector"}};
   await new Promise(resolve=>setTimeout(resolve,250));
  }
  return {verified:false,reason:"No fresh success text before timeout"};
 };
}
module.exports={validateVerification,jsonValue,prepareVerification};
