'use strict';
const {execFile}=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createHash,randomUUID}=require('node:crypto');
const {gitEnvironment,gitExecutable}=require('./platform');
const {RecoveryStore,regularPath,state:recoveryState}=require('./recovery-store');
class GitService {
 constructor(repo,options={}){this.repo=repo;this.busy=false;this.recovery=options.recoveryDir?new RecoveryStore(repo,options.recoveryDir):null;}
 async git(args,allowFailure=false){return new Promise((resolve,reject)=>execFile(gitExecutable(),['-c','core.quotepath=false','-c','color.ui=false',...args],{cwd:this.repo,encoding:'utf8',maxBuffer:24*1024*1024,timeout:120000,windowsHide:true,env:{...gitEnvironment(),GIT_TERMINAL_PROMPT:'0',GIT_MERGE_AUTOEDIT:'no',GIT_OPTIONAL_LOCKS:'0'}},(err,stdout,stderr)=>{if(err&&!allowFailure)reject(new Error(err.code==='ENOENT'?'未找到 Git。请安装系统 Git，或设置 BRANCHCRAFT_GIT 为绝对路径。':(stderr||stdout||err.message).trim()));else resolve(stdout);}));}
 async filePath(name){if(typeof name!=='string'||!name||name.includes('\0'))throw Error('无效文件路径');const target=path.resolve(this.repo,name);const rel=path.relative(this.repo,target);if((rel==='..'||rel.startsWith('..'+path.sep))||path.isAbsolute(rel)||rel.split(/[\\/]/).some(x=>x.toLowerCase()==='.git'))throw Error('不允许访问仓库外部或 Git 内部文件');const root=await fs.realpath(this.repo);let ancestor=target;let actual;for(;;){try{actual=await fs.realpath(ancestor);break;}catch(e){if(!['ENOENT','ENOTDIR'].includes(e.code))throw e;const parent=path.dirname(ancestor);if(parent===ancestor)throw e;ancestor=parent;}}const relative=path.relative(root,actual);if((relative==='..'||relative.startsWith('..'+path.sep))||path.isAbsolute(relative))throw Error('禁止通过链接访问仓库外部文件');return target;}
 async snapshot(){
 const raw=await this.git(['status','--porcelain=v1','-z','--untracked-files=all']);const parts=raw.split('\0');const files=[];
 for(let i=0;i<parts.length;i++){const s=parts[i];if(!s)continue;const item={x:s[0],y:s[1],path:s.slice(3)};if(/[RC]/.test(item.x+item.y))item.oldPath=parts[++i];item.conflict=['DD','AU','UD','UA','DU','AA','UU'].includes(item.x+item.y);files.push(item);}
 const head=await this.git(['rev-parse','--verify','--quiet','HEAD^{commit}'],true);
 const [branch,branches,logs,stashRaw,remotes,counts,gitDir]=await Promise.all([
 this.git(['symbolic-ref','--short','HEAD'],true),this.git(['for-each-ref','--format=%(refname:short)%09%(HEAD)%09%(upstream:short)%09%(refname)','refs/heads','refs/remotes']),head.trim()?this.git(['log','HEAD','--date-order','-180','--format=%H%x1f%P%x1f%an%x1f%aI%x1f%s%x1f%D%x1e']):Promise.resolve(''),this.git(['stash','list','--format=%gd%x1f%gs%x1f%ci']),this.git(['remote','-v']),this.git(['rev-list','--left-right','--count','HEAD...@{upstream}'],true),this.git(['rev-parse','--absolute-git-dir'])]);
 const gd=gitDir.trim();const merging=await fs.access(path.join(gd,'MERGE_HEAD')).then(()=>true,()=>false);
 return {repo:this.repo,branch:branch.trim()||'(分离 HEAD / 未提交)',files,branches:branches.trim().split('\n').filter(Boolean).map(l=>{const [name,current,upstream,ref]=l.split('\t');return {name,current:current==='*',upstream,remote:ref.startsWith('refs/remotes/')};}),commits:logs.split('\x1e').map(s=>s.trim()).filter(Boolean).map(l=>{const [hash,parents,author,date,subject,refs]=l.split('\x1f');return {hash,parents:parents?parents.split(' '):[],author,date,subject,refs};}),stashes:stashRaw.trim().split('\n').filter(Boolean).map(l=>{const [ref,subject,date]=l.split('\x1f');return {ref,subject,date};}),remotes:remotes.trim(),counts:counts.trim(),merging};
 }
 async commitIdentity(){
 const [head,ref,index,gitDir]=await Promise.all([this.git(['rev-parse','--verify','HEAD'],true),this.git(['symbolic-ref','-q','HEAD'],true),this.git(['ls-files','--stage','-z']),this.git(['rev-parse','--absolute-git-dir'])]);
 const merge=await fs.readFile(path.join(gitDir.trim(),'MERGE_HEAD'),'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;});
 return JSON.stringify({repo:this.repo,head,ref,index,merge});
 }
 async commitPreview(){
 const before=await this.commitIdentity();
 const diff=await this.git(['diff','--cached','--no-ext-diff','--no-textconv','--binary','--no-renames']);
 const files=(await this.snapshot()).files.filter(f=>f.x!==' '&&f.x!=='?');
 if(before!==await this.commitIdentity())throw Error('暂存区或 HEAD 已变化，请重新审阅提交');
 return {token:createHash('sha256').update(before).update(diff).digest('hex'),files,diff};
 }
 async diff({file,staged=false,commit,stash,hunks=false}){
 if(hunks&&!commit&&!stash){const p=await this.hunkPreview(file,staged);return {diff:p.diff,hunkToken:p.token,hunks:p.hunks.map(({label},index)=>({index,label}))};}
 if(commit){if(!/^[a-f0-9]{40}$/.test(commit))throw Error('无效提交');return this.git(['show','--no-ext-diff','--no-textconv','--format=fuller','--stat','--patch',commit,...(file?['--',':(literal)'+file]:[])]);}
 if(stash){this.checkStash(stash);return this.git(['stash','show','--no-ext-diff','--no-textconv','--include-untracked','--stat','--patch',stash]);}
 await this.filePath(file);const status=await this.git(['status','--porcelain=v1','--',':(literal)'+file]);if(status.startsWith('??')){const stat=await fs.stat(await this.filePath(file));if(stat.size>2*1024*1024)return '文件超过 2MB，暂不预览。';const data=await fs.readFile(await this.filePath(file));return data.includes(0)?'二进制文件':data.toString('utf8').split('\n').map(x=>'+'+x).join('\n');}
 return this.git(['diff',...(staged?['--cached']:[]),'--no-ext-diff','--no-textconv','--',':(literal)'+file]);
 }
 checkStash(ref){if(!/^stash@\{\d+\}$/.test(ref))throw Error('无效 Stash 引用');}
 async mutate(action,p={}){if(this.busy)throw Error('另一个 Git 操作正在执行，请稍候');this.busy=true;try{
 switch(action){
 case 'stageHunk':case 'unstageHunk':return await this.applyIndexHunk(action,p);
 case 'stage': case 'unstage':{if(!Array.isArray(p.files)||!p.files.length)throw Error('请选择文件');const status=await this.snapshot();const files=action==='stage'?p.files:[...new Set(p.files.flatMap(f=>{const item=status.files.find(i=>i.path===f);return item?.oldPath?[f,item.oldPath]:[f];}))];for(const f of files)await this.filePath(f);if(action==='stage')return await this.git(['add','--',...files.map(f=>':(literal)'+f)]);const hasHead=(await this.git(['rev-parse','--verify','HEAD'],true)).trim();return await this.git(hasHead?['restore','--staged','--',...files.map(f=>':(literal)'+f)]:['rm','--cached','--',...files.map(f=>':(literal)'+f)]);}
 case 'commit':if(!p.message?.trim())throw Error('请输入提交说明');if(typeof p.token!=='string'||p.token!==(await this.commitPreview()).token)throw Error('暂存区或 HEAD 已变化，请重新审阅提交');return await this.git(['commit','-m',p.message]);
 case 'createBranch':if(!p.name||p.name.startsWith('-'))throw Error('请输入有效分支名');await this.git(['check-ref-format','--branch',p.name]);return await this.git(['switch','-c',p.name]);
 case 'track':{if(!p.name||p.name.startsWith('-')||p.name.endsWith('/HEAD'))throw Error('无效远程分支');const ref='refs/remotes/'+p.name;await this.git(['show-ref','--verify',ref]);const local=p.name.slice(p.name.indexOf('/')+1);await this.git(['check-ref-format','--branch',local]);return await this.git(['switch','--track','-c',local,ref]);}
 case 'switch':if(!p.name||p.name.startsWith('-'))throw Error('无效分支名');return await this.git(['switch',p.name]);
 case 'fetch':return await this.git(['fetch','--all']);
 case 'pull':return await this.git(['pull','--ff-only']);
 case 'push':return await this.git(['push']);
 case 'merge':return await this.mergeConfirmed(p);
 case 'abortMerge':return await this.git(['merge','--abort']);
 case 'stashSave':return await this.git(['stash','push',...(p.includeUntracked?['--include-untracked']:[]),'-m',p.message?.trim()||'Branchcraft 保存的修改']);
 case 'stashApply':case 'stashPop':case 'stashDrop':this.checkStash(p.ref);if(p.hash){const actual=(await this.git(['rev-parse',p.ref])).trim();if(actual!==p.hash)throw Error('Stash 列表已变化，请刷新后重试');}return await this.git(['stash',({stashApply:'apply',stashPop:'pop',stashDrop:'drop'})[action],p.ref]);
 default:throw Error('不支持的操作');
 }
 }finally{this.busy=false;}}

 splitHunks(diff){
 const lines=diff.split('\n');const starts=[];lines.forEach((line,i)=>{if(/^@@ /.test(line))starts.push(i);});
 const hunks=starts.map((start,i)=>({label:lines[start],patch:lines.slice(0,starts[0]).join('\n')+'\n'+lines.slice(start,starts[i+1]??lines.length).join('\n').replace(/\n?$/,'\n')}));
 return hunks;
 }

 async hunkPreview(file,staged=false){
 const target=await this.filePath(file);
 if(path.isAbsolute(file)||file!==path.relative(this.repo,target).split(path.sep).join('/'))throw Error('代码块仅支持仓库相对文件路径');
 const status=(await this.snapshot()).files.find(f=>f.path===file);
 if(!status||status.conflict||status.oldPath||/[RCAD?UT]/.test(status.x+status.y))throw Error('代码块不支持重命名、冲突、新增、删除或非普通文件状态，请刷新');
 const st=await fs.lstat(target);
 if(!st.isFile()||st.isSymbolicLink())throw Error('代码块仅支持普通文件');
 if(st.size>2*1024*1024)throw Error('文件超过 2MB，不支持代码块操作');
 const data=await fs.readFile(target);const spec=':(literal)'+file;
 const index=await this.git(['ls-files','--stage','-z','--',spec]);
 if(!/^100(?:644|755) [a-f0-9]+ 0\t[^\0]+\0$/.test(index))throw Error('代码块仅支持单个已跟踪普通文件');
 const size=Number((await this.git(['cat-file','-s',':'+file])).trim());
 if(!Number.isSafeInteger(size)||size>2*1024*1024)throw Error('暂存文件超过 2MB，不支持代码块操作');
 const head=staged?(await this.git(['rev-parse','--verify','HEAD'])).trim():'';
 const diff=await this.git(['diff',...(staged?['--cached']:[]),'--no-ext-diff','--no-textconv','--binary','--no-renames','--no-color','--src-prefix=a/','--dst-prefix=b/','--unified=3','--inter-hunk-context=0','--',spec]);
 if(Buffer.byteLength(diff)>2*1024*1024)throw Error('差异超过 2MB，不支持代码块操作');
 if(data.includes(0)||diff.includes('\ufffd')||/^(GIT binary patch|Binary files )/m.test(diff))throw Error('二进制或非 UTF-8 文件不支持代码块操作');
 if(/^(old mode|new mode|new file mode|deleted file mode|rename |copy )/m.test(diff))throw Error('代码块不支持文件模式、新增、删除或重命名变化');
 const hunks=this.splitHunks(diff);if(!hunks.length)throw Error('没有可操作的代码块，请刷新');
 const token=createHash('sha256').update(JSON.stringify({repo:this.repo,file,staged:!!staged,status,head})).update(data).update(diff).update(index).digest('hex');
 return {file,token,diff,hunks};
 }
 async applyIndexHunk(action,{file,token,hunk}){
 if(typeof token!=='string'||!Number.isInteger(hunk)||hunk<0)throw Error('无效代码块或预览 token');
 const staged=action==='unstageHunk';let temp;
 try{
 const current=await this.hunkPreview(file,staged);
 if(token!==current.token)throw Error('文件或暂存区已变化，请重新查看差异');
 if(!current.hunks[hunk])throw Error('无效代码块');
 temp=await fs.mkdtemp(path.join(os.tmpdir(),'branchcraft-index-patch-'));
 const patch=path.join(temp,'hunk.patch');await fs.writeFile(patch,current.hunks[hunk].patch,'utf8');
 const args=['apply','--cached',...(staged?['--reverse']:[]),'--whitespace=nowarn'];
 await this.git([...args,'--check','--',patch]);
 if((await this.hunkPreview(file,staged)).token!==token)throw Error('文件或暂存区已变化，请重新查看差异');
 await this.git([...args,'--',patch]);
 return staged?'已取消暂存选中代码块，工作区保持不变':'已暂存选中代码块，工作区保持不变';
 }finally{if(temp)await fs.rm(temp,{recursive:true,force:true});}
 }

 async rollbackPreview(file){
 const target=await this.filePath(file);let data=Buffer.alloc(0);try{const st=await fs.lstat(target);if(!st.isFile()||st.isSymbolicLink())throw Error('仅支持普通文件回退');if(st.size>2*1024*1024)throw Error('文件超过 2MB，请使用外部工具');data=await fs.readFile(target);}catch(e){if(e.code!=='ENOENT')throw e;}
 const status=(await this.snapshot()).files.find(f=>f.path===file);if(!status||status.conflict)throw Error('文件状态已变化，或存在冲突，请刷新');
 const diff=await this.git(['diff','--no-ext-diff','--no-textconv','--binary','--no-renames','--no-color','--src-prefix=a/','--dst-prefix=b/','--unified=3','--inter-hunk-context=0','--',':(literal)'+file]);
 const index=await this.git(['ls-files','--stage','--',':(literal)'+file]);
 const token=createHash('sha256').update(JSON.stringify(status)).update(data).update(diff).update(index).digest('hex');
 const hunks=this.splitHunks(diff);
 return {file,token,diff,hunks,untracked:status.x==='?',status};
 }
 async recoveryList(){return this.recovery?this.recovery.run(()=>this.recovery.list()):[];}
 async recoveryClear(){if(!this.recovery)return {cleared:0};if(this.busy)throw Error('另一个操作正在执行');this.busy=true;try{return await this.recovery.run(()=>this.recovery.clear());}finally{this.busy=false;}}
 async recoveryBinding(record){
 const current=await recoveryState(this.repo,record.file);
 const status=await this.snapshot();if(status.files.some(f=>f.path===record.file&&f.conflict))throw Error('文件存在冲突，请先解决冲突');
 const index=await this.git(['ls-files','--stage','-z']);
 const entries=(await this.git(['ls-files','--stage','-z','--',':(literal)'+record.file])).split('\0').filter(Boolean);
 if(entries.some(x=>!new RegExp('^100(?:644|755) [a-f0-9]+ 0\\t').test(x)))throw Error('恢复仅支持普通文件，禁止冲突或链接');
 return createHash('sha256').update(JSON.stringify({id:record.id,digest:record.digest,current,index})).digest('hex');
 }
 async recoveryPreview(id){
 if(!this.recovery)throw Error('未启用恢复安全网');
 return this.recovery.run(async()=>{const r=await this.recovery.get(id);const token=await this.recoveryBinding(r);return {id:r.id,file:r.file,createdAt:r.createdAt,outcome:r.outcome,exists:r.state.exists,encoding:'base64',content:r.state.exists?r.state.data:null,token};});
 }
 async recoveryRestore({id,token}){
 if(!this.recovery)throw Error('未启用恢复安全网');if(this.busy)throw Error('另一个操作正在执行');this.busy=true;
 try{return await this.recovery.run(async()=>{
 const r=await this.recovery.get(id);if(typeof token!=='string'||token!==await this.recoveryBinding(r))throw Error('文件或暂存区已变化，请重新预览');
 const backup=await this.recovery.capture(r.file,'undo',r.id);
 try{
 if(token!==await this.recoveryBinding(r))throw Error('文件或暂存区已变化，请重新预览');
 let target=await regularPath(this.repo,r.file);
 if(r.state.exists){
 await fs.mkdir(path.dirname(target),{recursive:true});target=await regularPath(this.repo,r.file);
 const temp=path.join(path.dirname(target),'.branchcraft-'+require('node:crypto').randomUUID());
 try{await fs.writeFile(temp,Buffer.from(r.state.data,'base64'),{flag:'wx',mode:r.state.mode});if(token!==await this.recoveryBinding(r))throw Error('文件或暂存区已变化，请重新预览');await regularPath(this.repo,r.file);await fs.rename(temp,target);}finally{await fs.rm(temp,{force:true});}
 }else{if(token!==await this.recoveryBinding(r))throw Error('文件或暂存区已变化，请重新预览');target=await regularPath(this.repo,r.file);try{await fs.unlink(target);}catch(e){if(e.code!=='ENOENT')throw e;}}
 await this.recovery.finish(backup,'success');
 }catch(e){await this.recovery.finish(backup,'failed',e);throw e;}
 try{await this.recovery.consume(r);}catch(e){return {message:'已恢复工作区，但旧记录清理失败，已保留两份记录：'+e.message,backupId:backup.id,cleanupWarning:true};}
 return {message:'已恢复工作区，旧记录已移除；恢复前备份已保留，暂存区保持不变',backupId:backup.id};

 });}finally{this.busy=false;}
 }
 async rollback({file,token,hunk}){
 if(this.busy)throw Error('另一个操作正在执行');this.busy=true;
 const perform=async()=>{
 let temp,backup;
 try{const current=await this.rollbackPreview(file);if(current.token!==token)throw Error('文件或暂存区已变化，请重新查看差异后回退');
 let patch;
 if(hunk!==undefined){if(!Number.isInteger(hunk)||!current.hunks[hunk])throw Error('无效代码块');temp=await fs.mkdtemp(path.join(os.tmpdir(),'branchcraft-patch-'));patch=path.join(temp,'reverse.patch');await fs.writeFile(patch,current.hunks[hunk].patch);await this.git(['apply','--reverse','--check','--',patch]);}
 if(this.recovery){await this.recoveryBinding({file,id:'rollback',digest:''});backup=await this.recovery.capture(file,hunk===undefined?'whole':'hunk');}
 if((await this.rollbackPreview(file)).token!==token)throw Error('文件或暂存区已变化，请重新查看差异后回退');
 if(this.recovery)await regularPath(this.repo,file);
 if(hunk!==undefined)await this.git(['apply','--reverse','--',patch]);
 else if(current.untracked)await fs.unlink(await this.filePath(file));
 else await this.git(['restore','--worktree','--',':(literal)'+file]);
 if(backup)await this.recovery.finish(backup,'success');
 return '已回退未暂存修改，暂存区保持不变';
 }catch(e){if(backup)await this.recovery.finish(backup,'failed',e);throw e;}
 finally{if(temp)await fs.rm(temp,{recursive:true,force:true});}
 };
 try{return await (this.recovery?this.recovery.run(perform):perform());}finally{this.busy=false;}
 }
 async stashHash(ref){this.checkStash(ref);return (await this.git(['rev-parse',ref])).trim();}
 async mergeState(name){
 if(typeof name!=='string'||!name||name.startsWith('-')||name.includes('\0')||name.length>1024)throw Error('无效分支名');
 let ref;for(const prefix of ['refs/heads/','refs/remotes/']){const candidate=prefix+name;const hash=(await this.git(['show-ref','--verify','--hash',candidate],true)).trim();if(/^[a-f0-9]{40,64}$/.test(hash)){ref=candidate;break;}}
 if(!ref)throw Error('分支不存在，请刷新');
 const head=(await this.git(['rev-parse','--verify','HEAD^{commit}'])).trim();
 const branch=(await this.git(['symbolic-ref','-q','HEAD'],true)).trim();
 const target=(await this.git(['rev-parse','--verify',ref+'^{commit}'])).trim();
 const status=await this.git(['status','--porcelain=v1','-z','--untracked-files=all']);
 if(status)throw Error('合并预览要求干净工作区和暂存区，请先提交或储藏修改（包括未跟踪文件）');
 const mergeHead=(await this.git(['rev-parse','--verify','-q','MERGE_HEAD'],true)).trim();if(mergeHead)throw Error('请先完成或中止当前合并');
 const base=(await this.git(['merge-base',head,target])).trim();
 return {repo:this.repo,name,ref,head,branch,target,base};
 }
 async mergePreview(name){
 const before=await this.mergeState(name);
 const [diff,summary]=await Promise.all([this.git(['diff','--no-ext-diff','--no-textconv','--find-renames',before.base,before.target,'--']),this.git(['diff','--stat','--no-ext-diff','--no-textconv',before.base,before.target,'--'])]);
 if(JSON.stringify(before)!==JSON.stringify(await this.mergeState(name)))throw Error('分支已变化，请重新预览');
 const token=randomUUID();this.mergePreviews??=new Map();this.mergePreviews.set(token,before);while(this.mergePreviews.size>20)this.mergePreviews.delete(this.mergePreviews.keys().next().value);
 return {...before,diff,summary,token};
 }
 async mergeConfirmed({name,token}){
 const preview=this.mergePreviews?.get(token);if(!preview||preview.name!==name)throw Error('缺少合并预览或预览已过期，请重新预览');
 if(JSON.stringify(preview)!==JSON.stringify(await this.mergeState(name)))throw Error('HEAD 或目标分支已变化，请重新预览合并');
 this.mergePreviews.delete(token);
 // Merge the reviewed immutable commit, never a moving branch reference.
 return this.git(['merge','--no-edit','--',preview.target]);
 }
 async conflictState(file){
 const index=await this.git(['ls-files','--unmerged','--stage','-z','--',':(literal)'+file]);
 const target=await regularPath(this.repo,file);const stat=await fs.lstat(target);
 if(!stat.isFile()||stat.isSymbolicLink())throw Error('冲突仅支持普通文件，禁止链接');
 if(stat.size>2*1024*1024)throw Error('文件超过 2MB，请用外部编辑器处理');
 const raw=await fs.readFile(target);if(raw.includes(0))throw Error('二进制冲突请用外部工具处理');
 if(!index)throw Error('该文件已不处于冲突状态，请刷新');
 if(index.split('\0').filter(Boolean).some(e=>!/^100(?:644|755) [a-f0-9]+ [123]\t/.test(e)))throw Error('冲突仅支持普通文件，禁止链接');
 const token=createHash('sha256').update(JSON.stringify({repo:this.repo,file,mode:stat.mode,index})).update(raw).digest('hex');
 return {target,stat,raw,token};
 }
 async conflict(file){
 const current=await this.conflictState(file);
 const [base,ours,theirs]=await Promise.all([1,2,3].map(n=>this.git(['show',`:${n}:${file}`],true)));
 if((await this.conflictState(file)).token!==current.token)throw Error('文件或暂存区已变化，请重新预览冲突');
 return {file,base,ours,theirs,content:current.raw.toString('utf8'),token:current.token};
 }
 async resolve({file,content,token}){
 if(this.busy)throw Error('另一个 Git 操作正在执行，请稍候');this.busy=true;let temp;
 try{
 const current=await this.conflictState(file);
 if(typeof token!=='string'||token!==current.token)throw Error('文件或暂存区已变化或缺少预览 token，请重新预览冲突');
 if(typeof content!=='string')throw Error('无效内容');
 if(/^(<<<<<<< |=======\r?$|>>>>>>> )/m.test(content))throw Error('内容仍含冲突标记，请先清理');
 temp=path.join(path.dirname(current.target),'.branchcraft-conflict-'+randomUUID()+'.tmp');
 const handle=await fs.open(temp,'wx',current.stat.mode&0o777);
 try{await handle.writeFile(content,'utf8');await handle.chmod(current.stat.mode&0o777);}finally{await handle.close();}
 if((await this.conflictState(file)).token!==token)throw Error('文件或暂存区已变化，请重新预览冲突');
 await fs.rename(temp,current.target);
 await this.git(['add','--',':(literal)'+file]);return '已保存并暂存解决结果';
 }finally{try{if(temp)await fs.rm(temp,{force:true});}finally{this.busy=false;}}
 }
}
module.exports={GitService};
