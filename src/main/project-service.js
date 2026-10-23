'use strict';
const fs=require('node:fs/promises');
const {constants}=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {createHash,randomUUID}=require('node:crypto');
const {TextDecoder}=require('node:util');
const {execFile}=require('node:child_process');
const {GitService}=require('./git-service');
const {gitEnvironment,gitExecutable}=require('./platform');
const MAX_BYTES=2*1024*1024, MAX_FILES=10000;
const hash=raw=>createHash('sha256').update(raw).digest('hex');
function decode(raw){if(raw.includes(0))throw Error('二进制文件不能编辑');try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);}catch{throw Error('文件不是有效 UTF-8 文本');}}
function same(a,b){return a.dev===b.dev&&a.ino===b.ino;}
class ProjectService {
 constructor(repo){this.repo=path.resolve(repo);this.service=new GitService(this.repo);this.saving=false;}
 git(args){return this.service.git(args);}
 // Buffer output is required for blob bytes; unlike GitService.git, retain exit codes.
 async run(args,allowed=[]){return new Promise((resolve,reject)=>execFile(gitExecutable(),['-c','core.quotepath=false','-c','color.ui=false',...args],{cwd:this.repo,encoding:'buffer',maxBuffer:24*1024*1024,timeout:120000,windowsHide:true,env:{...gitEnvironment(),GIT_TERMINAL_PROMPT:'0'}},(err,stdout,stderr)=>{if(err&&!allowed.includes(err.code))reject(Error((stderr||'').toString().trim()||err.message));else resolve({raw:stdout,code:err?err.code:0});}));}
 async checked(file){
  if(typeof file!=='string'||!file||file.includes('\0')||path.posix.isAbsolute(file)||path.win32.isAbsolute(file))throw Error('无效文件路径');
  const parts=file.split(/[\\/]/);
  if(parts.some(p=>!p||p==='.'||p==='..'||p.toLowerCase()==='.git'||/[<>:"|?*\x00-\x1f]/.test(p)||/[. ]$/.test(p)))throw Error('不允许访问仓库外部或 Git 内部文件');
  const root=await fs.realpath(this.repo);let target=root;
  for(let i=0;i<parts.length;i++){
   target=path.join(target,parts[i]);const stat=await fs.lstat(target);
   if(stat.isSymbolicLink())throw Error('禁止访问符号链接');
   if(i<parts.length-1&&!stat.isDirectory())throw Error('无效父目录');
   if(i===parts.length-1){if(!stat.isFile())throw Error('只能编辑普通文件');return {target,stat,file:parts.join('/')};}
  }
 }
 async load(file){
  const entry=await this.checked(file);const handle=await fs.open(entry.target,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  try{
   const stat=await handle.stat();if(!stat.isFile()||!same(stat,entry.stat))throw Error('文件已变化，请刷新');
   if(stat.size>MAX_BYTES)throw Error('文件超过 2MB');
   const raw=Buffer.alloc(MAX_BYTES+1);let size=0;
   while(size<raw.length){const result=await handle.read(raw,size,raw.length-size,size);if(!result.bytesRead)break;size+=result.bytesRead;}
   if(size>MAX_BYTES)throw Error('文件超过 2MB');
   const bytes=raw.subarray(0,size);const text=decode(bytes);
   const again=await this.checked(file);if(!same(again.stat,stat))throw Error('文件已变化，请刷新');
   return {...entry,raw:bytes,text,token:hash(bytes)};
  }finally{await handle.close();}
 }
 async tree(){
  const names=[...new Set((await this.git(['ls-files','-z','--cached','--others','--exclude-standard'])).split('\0').filter(Boolean))];
  if(names.length>MAX_FILES)throw Error('项目文件列表超过 10000 项');
  const files=[];
  for(const file of names){try{await this.checked(file);files.push(file);}catch(e){if(!['ENOENT','ENOTDIR'].includes(e.code)&&!/(符号链接|只能编辑普通文件|无效父目录|不允许访问|无效文件路径)/.test(e.message))throw e;}}
  return files;
 }
 async read(file){const result=await this.load(file);return {file:result.file,text:result.text,token:result.token};}
 async save({file,text,token}){
  if(this.saving)throw Error('另一个保存正在执行');
  if(typeof text!=='string'||typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw Error('无效文本或版本 token');
  if(Buffer.byteLength(text,'utf8')>MAX_BYTES)throw Error('文件超过 2MB');
  const raw=Buffer.from(text,'utf8');if(decode(raw)!==text)throw Error('文本不是有效 UTF-8');
  this.saving=true;let temporary;
  try{
   const current=await this.load(file);if(current.token!==token)throw Error('文件已被外部修改，请刷新');
   temporary=path.join(path.dirname(current.target),`.project-save-${randomUUID()}`);
   const handle=await fs.open(temporary,'wx',current.stat.mode&0o777);
   try{await handle.writeFile(raw);await handle.sync();}finally{await handle.close();}
   const latest=await this.load(file);
   if(latest.token!==token||!same(current.stat,latest.stat))throw Error('文件已被外部修改，请刷新');
   // Atomic replacement avoids partial writes and modifying other hard-link names.
   // Portable filesystems cannot offer a cross-process compare-and-swap rename.
   await fs.rename(temporary,current.target);temporary=undefined;
   return {file:current.file,text,token:hash(raw)};
  }finally{try{if(temporary)await fs.rm(temporary,{force:true});}finally{this.saving=false;}}
 }
 // Resolve literal branch names; never interpret user input as a revision.
 async diffCommit(base){
  if(typeof base!=='string'||!base||base.includes('\0')||base.startsWith('-'))throw Error('无效 base：只能是 HEAD、index 或已存在的本地/远程分支');
  if(base==='index')return null;
  if(base==='HEAD'){
   const head=await this.run(['rev-parse','--verify','--quiet','--end-of-options','HEAD^{commit}'],[1]);
   if(head.code===0)return head.raw.toString('utf8').trim();
   // A missing local symbolic target is unborn; other Git errors must surface.
   const symbolic=await this.run(['symbolic-ref','--quiet','HEAD'],[1]);
   const ref=symbolic.raw.toString('utf8').trim();
   if(symbolic.code===0&&ref.startsWith('refs/heads/')){
    const exists=await this.run(['show-ref','--verify','--quiet',ref],[1]);
    if(exists.code===1)return null;
   }
   throw Error('无法解析 HEAD commit');
  }
  const refs=(await this.git(['for-each-ref','--format=%(refname)%00%(objectname)%00%(objecttype)','refs/heads/','refs/remotes/'])).split('\n').filter(Boolean).map(row=>row.trim().split('\0'));
  const candidates=base.startsWith('refs/')?[base]:[`refs/heads/${base}`,`refs/remotes/${base}`];
  for(const name of candidates){
   const ref=refs.find(row=>row[0]===name);
   if(ref){if(ref[2]!=='commit'||!/^[a-f0-9]{40,64}$/.test(ref[1]))throw Error('无效 base：分支未指向 commit');return ref[1];}
  }
  throw Error('无效 base：本地/远程分支不存在');
 }
 async diff({file,base='HEAD'}){
  const commit=await this.diffCommit(base);
  const current=await this.load(file);let oid;
  if(base!=='index'){
   if(commit){const rows=(await this.git(['ls-tree','-z',commit,'--',`:(literal)${current.file}`])).split('\0').filter(Boolean);
    if(rows.length){const match=/^(100644|100755) blob ([a-f0-9]+)\t/.exec(rows[0]);if(!match)throw Error(`${base} 基准不是普通文件`);oid=match[2];}}
  }else{
   const rows=(await this.git(['ls-files','--stage','-z','--',`:(literal)${current.file}`])).split('\0').filter(Boolean);
   if(rows.length){const match=/^(100644|100755) ([a-f0-9]+) 0\t/.exec(rows[0]);if(rows.length!==1||!match)throw Error('index 基准不是已解决的普通文件');oid=match[2];}
  }
  const before=oid?(await this.run(['cat-file','blob',oid])).raw:Buffer.alloc(0);
  let directory;
  try{
   directory=await fs.mkdtemp(path.join(os.tmpdir(),'project-diff-'));
   const a=path.join(directory,'base'),b=path.join(directory,'worktree');
   await fs.writeFile(a,before);await fs.writeFile(b,current.raw);
   const result=await this.run(['diff','--no-index','--no-ext-diff','--no-textconv','--',a,b],[1]);
   return result.raw.toString('utf8');
  }finally{if(directory)await fs.rm(directory,{recursive:true,force:true});}
 }
}
module.exports={ProjectService};
