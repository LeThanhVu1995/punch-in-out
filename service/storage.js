const fs=require("fs"),{helper}=require("./accounts");
function readState(file){
 if(!fs.existsSync(file))return {};
 const value=JSON.parse(fs.readFileSync(file,"utf8"));
 return value.stateProtected?JSON.parse(helper("credential-unprotect",value.stateProtected)):value;
}
function stateWriter(file){
 let previous;
 return state=>{
  const plain=JSON.stringify(state);
  if(plain===previous)return;
  const value=process.platform==="win32" && process.env.PUNCH_HELPER_EXE
   ?JSON.stringify({stateProtected:helper("credential-protect",plain)}):plain;
  fs.writeFileSync(file+".tmp",value,{mode:0o600});fs.renameSync(file+".tmp",file);
  previous=plain;
 };
}
function purgeDiagnostics(root){
 const path=require("path");
 for(const relative of ["data/history.jsonl","data/manual-actions.jsonl","data/runs"]){
  fs.rmSync(path.join(root,relative),{recursive:true,force:true});
 }
}
module.exports={readState,stateWriter,purgeDiagnostics};
