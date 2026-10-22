'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const AGE = 7 * 24 * 60 * 60 * 1000;
const LIMIT = 100 * 1024 * 1024;
const queues = new Map();
const digest = data => createHash('sha256').update(data).digest('hex');
function validFile(file) {
 if (typeof file !== 'string' || !file || file.includes('\\') || file.includes(':') || file.includes('\0') || path.isAbsolute(file) || file.split('/').some(x => !x || x === '.' || x === '..' || x.toLowerCase() === '.git' || new RegExp('[. ]$').test(x) || new RegExp('^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:[.]|$)','i').test(x) || [...x].some(c=>c.charCodeAt(0)<32 || ('<>'+String.fromCharCode(34)+'|?*').includes(c)))) throw Error('无效恢复路径');
 return file;
}
async function regularPath(repo, file) {
 validFile(file); const root = await fs.realpath(repo); let target = root;
 const parts = file.split('/');
 for (let i = 0; i < parts.length; i++) {
  target = path.join(target, parts[i]);
  try { const st = await fs.lstat(target); if (st.isSymbolicLink() || (i === parts.length - 1 ? !st.isFile() : !st.isDirectory())) throw Error('恢复仅支持普通文件，禁止链接'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
 }
 return target;
}
async function state(repo, file) {
 const target = await regularPath(repo, file);
 try { const st = await fs.lstat(target); if (!st.isFile() || st.isSymbolicLink()) throw Error('恢复仅支持普通文件'); const data = await fs.readFile(target); await regularPath(repo, file); return {exists:true, mode:st.mode & 511, data:data.toString('base64')}; }
 catch (e) { if (e.code !== 'ENOENT') throw e; return {exists:false}; }
}
class RecoveryStore {
 constructor(repo, dir) { this.repo = repo; this.dir = path.resolve(dir); }
 async init() {
  await fs.mkdir(this.dir, {recursive:true, mode:448});
  if ((await fs.lstat(this.dir)).isSymbolicLink()) throw Error('恢复存储禁止链接');
  const root = await fs.realpath(this.repo); this.key = digest(process.platform === 'win32' ? root.toLowerCase() : root);
 }
 async acquire(){
 const lock=path.join(this.dir,'.lock'),name='owner-'+randomUUID()+'.json',candidate=lock+'.candidate-'+randomUUID();
 await fs.mkdir(candidate);let acquired=false;
 try{
 await fs.writeFile(path.join(candidate,name),JSON.stringify({pid:process.pid}),{flag:'wx'});
 for(let attempt=0;attempt<8;attempt++){
 try{await fs.rename(candidate,lock);acquired=true;return {dir:lock,owner:path.join(lock,name)};}catch(e){
 let st;try{st=await fs.lstat(lock);}catch(err){if(err.code==='ENOENT')continue;throw err;}
 if(!st.isDirectory()||st.isSymbolicLink())throw Error('无效恢复存储锁');
 const entries=await fs.readdir(lock);let owner,ownerFile;
 if(entries.length===1&&(entries[0]==='owner.json'||/^owner-[a-f0-9-]+[.]json$/.test(entries[0]))){
 ownerFile=path.join(lock,entries[0]);try{const ownerStat=await fs.lstat(ownerFile);if(!ownerStat.isFile()||ownerStat.isSymbolicLink())throw Error('无效恢复锁所有者');owner=JSON.parse(await fs.readFile(ownerFile,'utf8'));}catch(err){if(err.code==='ENOENT')continue;if(!(err instanceof SyntaxError))throw err;}
 }
 let stale=false;
 if(owner&&Number.isInteger(owner.pid)&&owner.pid>0){try{process.kill(owner.pid,0);}catch(err){if(err.code==='ESRCH')stale=true;else if(err.code!=='EPERM')throw err;}}
 else stale=Date.now()-st.mtimeMs>30000;
 if(!stale)throw Error('恢复存储正在使用，请稍后重试');
 if(entries.length>0&&!ownerFile)throw Error('无效恢复存储锁，请检查恢复目录');
 if(ownerFile)try{await fs.unlink(ownerFile);}catch(err){if(err.code==='ENOENT')continue;throw err;}
 try{await fs.rmdir(lock);}catch(err){if(!['ENOENT','ENOTEMPTY','EEXIST'].includes(err.code))throw err;}
 }
 }
 throw Error('恢复存储锁竞争，请重试');
 }finally{if(!acquired)await fs.rm(candidate,{recursive:true,force:true});}
 }
 async run(fn) {
 const previous=queues.get(this.dir)||Promise.resolve();let release;
 const waiting=new Promise(r=>{release=r;});const tail=previous.catch(()=>{}).then(()=>waiting);queues.set(this.dir,tail);
 await previous.catch(()=>{});let lock;
 try{await this.init();lock=await this.acquire();return await fn();}
 finally{try{if(lock){await fs.unlink(lock.owner);await fs.rmdir(lock.dir);}}finally{release();if(queues.get(this.dir)===tail)queues.delete(this.dir);}}
 }
 async records() {
  const out=[];
  for(const name of await fs.readdir(this.dir)) {
   if(!new RegExp('^[a-f0-9]{64}-[a-f0-9-]{36}\\.json$').test(name)) continue;
   const target=path.join(this.dir,name); const st=await fs.lstat(target);
   if(!st.isFile() || st.isSymbolicLink()) throw Error('恢复记录不是普通文件');
   const r=JSON.parse(await fs.readFile(target,'utf8'));
   if(name!==`${r.repo}-${r.id}.json` || !Number.isFinite(r.createdAt) || !['pending','success','failed'].includes(r.outcome)) throw Error('无效恢复记录');
   validFile(r.file);
   if(!r.state || typeof r.state.exists!=='boolean' || (r.state.exists && (typeof r.state.data!=='string' || Buffer.from(r.state.data,'base64').toString('base64')!==r.state.data || !Number.isInteger(r.state.mode) || r.state.mode<0 || r.state.mode>511)) || digest(JSON.stringify(r.state))!==r.digest) throw Error('恢复记录损坏');
   out.push({r, target, bytes:st.size});
  }
  return out.sort((a,b)=>a.r.createdAt-b.r.createdAt);
 }
 async prune(extra=0,protectedId) {
  if(extra>LIMIT) throw Error('恢复快照超过 100MiB 容量');
  let rows=await this.records(); const now=Date.now();
  for(const row of rows) if(now-row.r.createdAt>=AGE) await fs.unlink(row.target);
  rows=rows.filter(row=>now-row.r.createdAt<AGE); let total=rows.reduce((n,row)=>n+row.bytes,0);
  while(total+extra>LIMIT) {const index=rows.findIndex(row=>row.r.id!==protectedId); if(index<0) throw Error('恢复快照超过 100MiB 容量，原记录已保留'); const [row]=rows.splice(index,1); await fs.unlink(row.target); total-=row.bytes;}
  return rows;
 }
 async save(r) {
  const dest=path.join(this.dir,`${r.repo}-${r.id}.json`); const tmp=path.join(this.dir,`${randomUUID()}.tmp`);
  try { const handle=await fs.open(tmp,'wx',384); try {await handle.writeFile(JSON.stringify(r)); await handle.sync();} finally {await handle.close();} await fs.rename(tmp,dest); }
  finally {await fs.rm(tmp,{force:true});}
 }
 async capture(file, operation, protectedId) {
  const snapshot=await state(this.repo,file);
  const r={id:randomUUID(),repo:this.key,file,createdAt:Date.now(),operation,outcome:'pending',state:snapshot,digest:digest(JSON.stringify(snapshot))};
  await this.prune(Buffer.byteLength(JSON.stringify(r))+4096,protectedId); await this.save(r); return r;
 }
 async finish(r,outcome,error) { r.outcome=outcome; if(error) r.error=String(error.message||error).slice(0,1000); await this.save(r); }
 async get(id) {
  if(typeof id!=='string'||!new RegExp('^[a-f0-9-]{36}$').test(id)) throw Error('无效恢复 ID');
  const rows=await this.prune(); const row=rows.find(x=>x.r.repo===this.key&&x.r.id===id);
  if(!row) throw Error('恢复记录不存在或已过期'); return row.r;
 }
 async list() {return (await this.prune()).filter(x=>x.r.repo===this.key).reverse().map(({r})=>({id:r.id,file:r.file,createdAt:r.createdAt,operation:r.operation,outcome:r.outcome,error:r.error,exists:r.state.exists,bytes:r.state.exists?Buffer.from(r.state.data,'base64').length:0}));}
 async consume(r) {if(r.repo!==this.key||!new RegExp('^[a-f0-9-]{36}$').test(r.id)) throw Error('无效恢复记录'); await fs.unlink(path.join(this.dir,`${this.key}-${r.id}.json`));}
 async clear() {let count=0; for(const row of await this.records()) if(row.r.repo===this.key) {await fs.unlink(row.target);count++;} return {cleared:count};}
}
module.exports={RecoveryStore,regularPath,state};
