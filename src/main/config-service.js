'use strict';
const {execFile}=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');
const {gitEnvironment,gitExecutable}=require('./platform');
const LIMITS=Object.freeze({key:512,value:16384,entries:4096,output:1048576,file:1048576});
const WARNING='高级 Git 配置能改变后续 Git 执行行为（alias、hooks、过滤器、凭据程序等）。UI 必须在编辑前明确警告；本服务不执行配置值。';
function fail(code,message){return Object.assign(new Error(message),{code});}
function scopeCheck(s){if(s!=='local'&&s!=='global')throw fail('INVALID_SCOPE','scope 必须为 local 或 global');}
function keyCheck(k){
 if(typeof k!=='string'||Buffer.byteLength(k)>LIMITS.key||/[\x00-\x1f\x7f]/.test(k))throw fail('INVALID_KEY','配置键非法或过长');
 const p=k.split('.');
 if(p.length<2||!/^[A-Za-z][A-Za-z0-9-]*$/.test(p[0])||!/^[A-Za-z][A-Za-z0-9-]*$/.test(p.at(-1))||p.slice(1,-1).some(s=>!s))throw fail('INVALID_KEY','需要 section[.subsection].name，禁止空段和选项');
 return [p[0].toLowerCase(),...p.slice(1,-1),p.at(-1).toLowerCase()].join('.');
}
function valueCheck(v){if(typeof v!=='string'||v.includes('\0')||Buffer.byteLength(v)>LIMITS.value)throw fail('INVALID_VALUE','值必须为不含 NUL 的字符串，最长 16 KiB');}
function same(a,b){return a.length===b.length&&a.every((v,i)=>v===b[i]);}
/**
 * list(scope) -> [{key,value,values,editable,reason,warning}].
 * set({scope,key,value,expected}) / unset({scope,key,expected}) -> {scope,key,values,warning}.
 * expected: mandatory exact ordered string[], [] for absent keys. Multivalues read-only.
 * Actual config.lock + rename serialize cooperative Git writers; byte snapshots detect
 * lock-ignoring writes, except the unavoidable final OS race with noncooperative programs.
 * Global discovery requires git var GIT_CONFIG_GLOBAL (Git >= 2.42). Locks all global
 * sources (may create parent directories), edits existing keys in their direct source; new keys use Git's preferred target.
 * No include expansion or value execution. Config symlinks read-only. Conservative keys
 * reject empty subsection segments. Caller UI MUST display WARNING before edits.
 * 512-byte keys, 16-KiB values, 4096 records, 1-MiB output and files, 10s Git timeout.
 * Independent of IPC and UI. Optional {env} supports isolated tests without process mutation.
 */
class ConfigService {
 constructor(repo,{env=process.env}={}){
  if(typeof repo!=='string'||!repo||repo.includes('\0'))throw fail('INVALID_REPO','无效仓库路径');
  this.repo=path.resolve(repo);this.env=gitEnvironment({...env});
  for(const k of Object.keys(this.env))if(/^GIT_(?:DIR|WORK_TREE|COMMON_DIR|NAMESPACE|CONFIG|CONFIG_COUNT|CONFIG_PARAMETERS|CONFIG_KEY_\d+|CONFIG_VALUE_\d+)$/i.test(k))delete this.env[k];
  this.env.GIT_CONFIG_NOSYSTEM='1';this.env.GIT_TERMINAL_PROMPT='0';
 }
 async git(args){return new Promise((resolve,reject)=>execFile(gitExecutable(this.env),args,{cwd:this.repo,env:this.env,shell:false,windowsHide:true,encoding:'utf8',maxBuffer:LIMITS.output,timeout:10000},(err,out)=>err?reject(fail('GIT_ERROR',`Git 配置失败（${err.code||'unknown'}）；请检查格式、权限、输出上限或锁状态`)):resolve(out)));}
 async list(scope){
  scopeCheck(scope);let raw='';
  if(scope==='global'){
   for(const file of await this.paths(scope)){
    try{await fs.stat(file);}catch(e){if(e.code==='ENOENT')continue;throw e;}
    raw+=await this.git(['config','--file',file,'--no-includes','--null','--list']);
    if(Buffer.byteLength(raw)>LIMITS.output)throw fail('LIMIT','配置输出超过 1 MiB');
   }
  }else raw=await this.git(['config','--local','--no-includes','--null','--list']);
  const records=raw.split('\0');if(records.at(-1)==='')records.pop();
  if(records.length>LIMITS.entries)throw fail('LIMIT','配置项超过 4096 条');const entries=new Map();
  for(const r of records){const i=r.indexOf('\n');const key=i<0?r:r.slice(0,i);const value=i<0?'':r.slice(i+1);
   if(Buffer.byteLength(key)>LIMITS.key||Buffer.byteLength(value)>LIMITS.value)throw fail('LIMIT','配置键或值超过安全上限');
   if(!entries.has(key))entries.set(key,{key,values:[]});entries.get(key).values.push(value);
  }
  return [...entries.values()].map(e=>({...e,value:e.values.at(-1),editable:e.values.length===1,reason:e.values.length>1?'多值仅展示，拒绝覆盖或删除，请用专门的多值编辑工具处理':null,warning:WARNING}));
 }
 async paths(scope){
  if(scope==='local')return [(await this.git(['rev-parse','--path-format=absolute','--git-path','config'])).trimEnd()];
  const files=(await this.git(['var','GIT_CONFIG_GLOBAL'])).trimEnd().split(/\r?\n/).filter(Boolean).map(p=>path.resolve(this.repo,p));
  if(!files.length||files.length>2)throw fail('UNSUPPORTED','无法安全确定全局文件（需要 Git >= 2.42）');return [...new Set(files)];
 }
 async snapshot(file){try{const st=await fs.lstat(file);
  if(!st.isFile()||st.isSymbolicLink())throw fail('UNSAFE_FILE','配置不是普通文件或为符号链接，拒绝写入');
  if(st.size>LIMITS.file)throw fail('LIMIT','配置文件超过 1 MiB');const data=await fs.readFile(file);
  if(data.length>LIMITS.file)throw fail('LIMIT','配置文件超过 1 MiB');return {data,mode:st.mode};
 }catch(e){if(e.code==='ENOENT')return null;throw e;}}
 set(input){return this.change(input,false);}
 unset(input){return this.change(input,true);}
 async change(input,remove){
  if(!input||typeof input!=='object')throw fail('INVALID_INPUT','需要参数对象');
  const {scope,expected}=input;scopeCheck(scope);const key=keyCheck(input.key);
  if(!Object.hasOwn(input,'expected')||!Array.isArray(expected)||expected.length>LIMITS.entries)throw fail('EXPECTED_REQUIRED','必须显式提供 expected 字符串数组；缺项用 []');
  const wanted=Array.from(expected);wanted.forEach(valueCheck);if(!remove)valueCheck(input.value);const value=input.value;
  const files=await this.paths(scope);const locks=[];
  try{
   for(const f of [...files].sort()){await fs.mkdir(path.dirname(f),{recursive:true});const lock=f+'.lock';let h;
    try{h=await fs.open(lock,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw fail('CONFIG_BUSY','配置已被锁定，请刷新后重试');throw e;}
    locks.push(lock);await h.close();
   }
   const snapshots=await Promise.all(files.map(f=>this.snapshot(f)));
   const current=(await this.list(scope)).find(e=>e.key===key)?.values||[];
   if(!same(current,wanted))throw fail('CAS_MISMATCH','配置已被外部更新；请刷新 expected');
   if(current.length>1)throw fail('MULTI_VALUE','多值配置仅展示，拒绝覆盖或删除（包括相同重复值）');
   if(remove&&!current.length)return {scope,key,values:[],warning:WARNING};
   let index=files.length-1;if(!snapshots[index]){const existing=snapshots.findIndex(Boolean);if(existing>=0)index=existing;}
   if(current.length&&files.length>1){
    for(let i=0;i<files.length;i++)if(snapshots[i]){
     const raw=await this.git(['config','--file',files[i],'--no-includes','--null','--list']);
     if(raw.split('\0').some(r=>r===key||r.startsWith(key+'\n'))){index=i;break;}
    }
   }
   const target=files[index],lock=target+'.lock',original=snapshots[index];
   await fs.writeFile(lock,original?.data||Buffer.alloc(0));if(original)await fs.chmod(lock,original.mode);
   await this.git(['config','--file',lock,'--no-includes',remove?'--unset-all':'--replace-all','--',key,...(remove?[]:[value])]);
   if((await fs.stat(lock)).size>LIMITS.file)throw fail('LIMIT','写入结果超过 1 MiB');
   for(let i=0;i<files.length;i++){const now=await this.snapshot(files[i]),before=snapshots[i];if(Boolean(now)!==Boolean(before)||(now&&!now.data.equals(before.data)))throw fail('CAS_MISMATCH','外部文件变化，写入取消');}
   const h=await fs.open(lock,'r+');try{await h.sync();}finally{await h.close();}
   await fs.rename(lock,target);locks.splice(locks.indexOf(lock),1);return {scope,key,values:remove?[]:[value],warning:WARNING};
  }finally{for(const lock of locks)await fs.rm(lock,{force:true});}
 }
}
module.exports={ConfigService,LIMITS,WARNING};