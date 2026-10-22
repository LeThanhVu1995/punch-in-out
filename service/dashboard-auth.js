const crypto=require("crypto"),os=require("os"),net=require("net");
function dashboardAccess(dashboard,port){
 const host=dashboard.host??"127.0.0.1";
 if(host!=="localhost" && net.isIP(host)!==4)throw new Error("Dashboard host must be localhost or an IPv4 address");
 const loopback=host==="localhost" || host.startsWith("127."),auth=dashboard.auth;
 if(!loopback && !auth)throw new Error("Configure dashboard login using WFMicros.exe dashboard-lan before enabling LAN access");
 if(auth && (auth.username!=="admin" || !/^[a-f0-9]{32}$/.test(auth.salt??"") || !/^[a-f0-9]{64}$/.test(auth.passwordHash??"") || auth.iterations!==210000))
  throw new Error("Invalid dashboard login configuration; run dashboard-lan again");
 const hosts=new Set(["127.0.0.1:"+port,"localhost:"+port,os.hostname().toLowerCase()+":"+port]);
 if(host!=="0.0.0.0")hosts.add(host+":"+port);
 if(!loopback){
  let interfaces={};try{interfaces=os.networkInterfaces();}catch{}
  for(const entries of Object.values(interfaces))for(const entry of entries??[])
   if(entry.family==="IPv4")hosts.add(entry.address+":"+port);
 }
 const failures=new Map();
 function authorized(req,res){
  if(!auth)return true;
  const key=req.socket.remoteAddress,now=Date.now();
  for(const [ip,value]of failures)if(now-value.since>60000)failures.delete(ip);
  const fail=failures.get(key);
  if(fail?.count>=5 || failures.size>=1000){res.writeHead(429,{"Retry-After":"60","Cache-Control":"no-store"});res.end("Too many login attempts. Try again later.");return false;}
  const header=req.headers.authorization??"";let valid=false;
  if(header.startsWith("Basic ") && header.length<4096){
   const value=Buffer.from(header.slice(6),"base64").toString("utf8"),colon=value.indexOf(":");
   if(colon>=0){
    const hash=crypto.pbkdf2Sync(value.slice(colon+1),Buffer.from(auth.salt,"hex"),auth.iterations,32,"sha256");
    valid=crypto.timingSafeEqual(hash,Buffer.from(auth.passwordHash,"hex")) && value.slice(0,colon)===auth.username;
   }
  }
  if(valid){failures.delete(key);return true;}
  if(header)failures.set(key,{since:fail?.since??now,count:(fail?.count??0)+1});
  res.writeHead(401,{"WWW-Authenticate":'Basic realm="WFMicros", charset="UTF-8"',"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
  res.end("Dashboard login required");return false;
 }
 return {host,hosts,authorized};
}
module.exports={dashboardAccess};
