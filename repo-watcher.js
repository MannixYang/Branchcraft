 'use strict';
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {GitService}=require('./git-service');
class RepositoryWatcher {
 constructor(repo,{onChange,ignore=[],interval=15000,debounce=250,watch=fs.watch}={}){
 this.repo=repo;this.onChange=onChange;this.ignore=ignore.map(p=>path.resolve(p));this.delay=debounce;this.watch=watch;this.handles=[];this.closed=false;this.running=false;this.pending=false;this.service=new GitService(repo);
 this.ready=this.start();this.poll=setInterval(()=>this.schedule(),interval);this.poll.unref?.();
 }
 ignored(file){const target=path.resolve(file);return this.ignore.some(dir=>target===dir||target.startsWith(dir+path.sep));}
 async fingerprint(){
 const exclusions=this.ignore.map(dir=>path.relative(this.repo,dir)).filter(rel=>rel&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel)).map(rel=>':(exclude,literal)'+rel.split(path.sep).join('/'));
 const git=args=>this.service.git(args);const scoped=args=>git([...args,'--','.',...exclusions]);
 const [status,head,refs,work,index]=await Promise.all([scoped(['status','--porcelain=v1','-z','--untracked-files=all']),this.service.git(['rev-parse','--verify','HEAD'],true),git(['show-ref','--head']).catch(()=>''),scoped(['diff','--no-ext-diff','--no-textconv','--binary']),scoped(['diff','--cached','--no-ext-diff','--no-textconv','--binary'])]);
 const hash=createHash('sha256').update(head).update(refs).update(work).update(index);
 const parts=status.split('\0');
 for(let i=0;i<parts.length;i++){const row=parts[i];if(!row)continue;const file=row.slice(3);if(/[RC]/.test(row.slice(0,2)))i++;if(this.ignored(path.join(this.repo,file)))continue;hash.update(row);const st=await fsp.lstat(path.join(this.repo,file)).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(st)hash.update(JSON.stringify([st.size,st.mtimeMs,st.mode]));}
 return hash.digest('hex');
 }
 async start(){
 try{
 const dirs=new Set([this.repo]);
 for(const flag of ['--absolute-git-dir','--git-common-dir']){const dir=(await this.service.git(['rev-parse',flag])).trim();dirs.add(path.resolve(this.repo,dir));}
 if(this.closed)return;
 for(const dir of dirs){try{const handle=this.watch(dir,{recursive:true},(_type,name)=>{if(!name||!this.ignored(path.join(dir,String(name))))this.schedule();});handle.on('error',()=>{handle.close();this.schedule();});this.handles.push(handle);}catch{}}
 this.last=await this.fingerprint();
 }catch{}finally{if(this.pending&&!this.closed)this.schedule();}
 }
 schedule(){if(this.closed)return;this.pending=true;clearTimeout(this.timer);this.timer=setTimeout(()=>this.check(),this.delay);this.timer.unref?.();}
 async check(){
 if(this.closed||this.running)return;this.running=true;this.pending=false;await this.ready;if(this.closed){this.running=false;return;}
 try{const next=await this.fingerprint();if(!this.closed){const changed=this.last!==undefined&&next!==this.last;this.last=next;if(changed)this.onChange?.({repo:this.repo});}}catch{}finally{this.running=false;if(this.pending&&!this.closed)this.schedule();}
 }
 async close(){this.closed=true;clearInterval(this.poll);clearTimeout(this.timer);for(const h of this.handles)h.close();this.handles=[];await this.ready;while(this.running)await new Promise(resolve=>setTimeout(resolve,10));}
}
module.exports={RepositoryWatcher};
