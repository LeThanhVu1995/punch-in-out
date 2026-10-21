let snapshot,initialized=false,busy=false;
const $=id=>document.getElementById(id);
const labels={pending:"Đang chờ",running:"Đang chạy",clicked:"Đã bấm",failed:"Thất bại",unknown:"Chưa rõ kết quả",missed:"Quá giờ",not_scheduled:"Không có lịch"};
const time=value=>value?new Intl.DateTimeFormat("vi-VN",{timeZone:snapshot.timezone,hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).format(new Date(value)):"—";
const due=value=>value===null?"—":[Math.floor(value/3600),Math.floor(value%3600/60),value%60].map(n=>String(n).padStart(2,"0")).join(":");
function cell(row,text){const td=document.createElement("td");td.textContent=text;row.append(td);return td;}
function render(){
 if(!snapshot)return;
 const mode=$("mode").value,search=$("search").value.toLowerCase(),filter=$("filter").value;
 const jobs=snapshot.jobs.filter(j=>j.mode===mode);
 $("subtitle").textContent=snapshot.date+" · "+snapshot.timezone+" · Dashboard trên máy này";
 $("users").textContent=jobs.length;
 $("clicked").textContent=jobs.filter(j=>j.status==="clicked").length;
 $("errors").textContent=jobs.filter(j=>["failed","unknown","missed"].includes(j.status)).length;
 $("waiting").textContent=jobs.filter(j=>["pending","running"].includes(j.status)).length;
 $("policy").textContent="Tự cập nhật 3 giây · Tối đa "+snapshot.maxRetries+" lần thử lại · Cách nhau "+snapshot.retryDelaySeconds+" giây";
 $("rows").replaceChildren();
 for(const job of jobs.filter(j=>j.username.toLowerCase().includes(search) &&
   (filter==="all" || (filter==="errors"?["failed","unknown","missed"].includes(j.status):j.status===filter))).sort((a,b)=>(a.due ?? 999999)-(b.due ?? 999999))){
   const row=document.createElement("tr");
   cell(row,job.username);
   cell(row,job.manualRequestedAt?"Chạy ngay":due(job.due));
   const status=cell(row,""),badge=document.createElement("span");
   badge.className="badge "+job.status;badge.textContent=labels[job.status] || job.status;status.append(badge);
   if(job.nextRetryAt){const next=document.createElement("div");next.className="small";next.textContent="Thử lại "+time(job.nextRetryAt);status.append(next);}
   cell(row,job.attemptsInCycle+" / "+(snapshot.maxRetries+1)+" · tổng "+job.attempts);
   cell(row,time(job.startedAt)+" → "+time(job.finishedAt));
   const actions=cell(row,""),run=document.createElement("button"),log=document.createElement("button");
   run.textContent="Chạy ngay";run.disabled=busy || job.status==="running";run.onclick=()=>execute("user",job.username);
   log.textContent="Log";log.style.marginLeft="6px";log.onclick=()=>showLog(job);
   actions.append(run,log);$("rows").append(row);
 }
 if(!$("rows").children.length){const row=document.createElement("tr"),td=cell(row,"Không có tài khoản phù hợp");td.colSpan=6;$("rows").append(row);}
}
async function refresh(){
 try{
   const response=await fetch("/api/status",{cache:"no-store"});
   if(!response.ok)throw new Error("HTTP "+response.status);
   snapshot=await response.json();
   if(!initialized){$("mode").value=snapshot.recommendedMode;initialized=true;}
   $("connection").textContent="● Service online";$("connection").style.background="#dff6ec";
   $("updated").textContent="Cập nhật "+time(snapshot.serverTime);render();
 }catch(error){$("connection").textContent="Service offline";$("connection").style.background="#feeae6";$("message").textContent="Không kết nối được service: "+error.message;}
}
async function execute(scope,username){
 if(busy || !snapshot)return;
 const mode=$("mode").value;
 const targets=snapshot.jobs.filter(j=>j.mode===mode && (scope!=="user" || j.username===username) &&
   (scope!=="failed" || ["failed","unknown","missed"].includes(j.status)));
 if(!targets.length){$("message").textContent="Không có lượt lỗi để chạy lại.";return;}
 const risky=targets.some(j=>["clicked","unknown"].includes(j.status));
 const prompt="Chạy "+mode+" ngay cho "+(scope==="user"?username:targets.length+" tài khoản")+"? Bỏ qua giờ hẹn và ngày nghỉ hôm nay."+
   (risky?" Có lượt đã bấm hoặc chưa rõ kết quả. Chỉ tiếp tục khi bạn đã kiểm tra và chấp nhận bấm lại.":"");
 if(!window.confirm(prompt))return;
 busy=true;for(const id of ["activate","failed"])$(id).disabled=true;render();
 try{
   const response=await fetch("/api/run",{method:"POST",headers:{"Content-Type":"application/json","X-Punch-Token":snapshot.token},
     body:JSON.stringify({requestId:crypto.randomUUID(),mode,scope,username,confirmRepeat:risky})});
   const result=await response.json();
   if(!response.ok)throw new Error(result.error);
   $("message").textContent="Đã xếp "+result.queued+" tài khoản chạy ngay; bỏ qua "+result.skipped+" lượt đang chạy hoặc yêu cầu trùng.";
 }catch(error){$("message").textContent="Không xếp được lượt: "+error.message;}
 finally{busy=false;for(const id of ["activate","failed"])$(id).disabled=false;await refresh();}
}
async function showLog(job){
 $("logtitle").textContent=job.username+" · "+job.mode+" · lượt thử gần nhất";$("logtext").textContent="Đang tải…";$("logs").showModal();
 try{
   const response=await fetch("/api/log?"+new URLSearchParams({username:job.username,mode:job.mode}));
   const data=await response.json();$("logtext").textContent=data.text || data.error;
 }catch(error){$("logtext").textContent=error.message;}
}
$("mode").onchange=render;$("search").oninput=render;$("filter").onchange=render;
$("refresh").onclick=refresh;$("activate").onclick=()=>execute("all");$("failed").onclick=()=>execute("failed");
$("closeLogs").onclick=()=>$("logs").close();
refresh();setInterval(refresh,3000);
