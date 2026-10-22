'use strict';
const {execFile}=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createHash}=require('node:crypto');
const {gitEnvironment,gitExecutable}=require('./platform');
class GitService {
 constructor(repo){this.repo=repo;this.busy=false;}
 async git(args,allowFailure=false){return new Promise((resolve,reject)=>execFile(gitExecutable(),['-c','core.quotepath=false','-c','color.ui=false',...args],{cwd:this.repo,encoding:'utf8',maxBuffer:24*1024*1024,timeout:120000,windowsHide:true,env:{...gitEnvironment(),GIT_TERMINAL_PROMPT:'0',GIT_MERGE_AUTOEDIT:'no'}},(err,stdout,stderr)=>{if(err&&!allowFailure)reject(new Error(err.code==='ENOENT'?'未找到 Git。请安装系统 Git，或设置 BRANCHCRAFT_GIT 为绝对路径。':(stderr||stdout||err.message).trim()));else resolve(stdout);}));}
 async filePath(name){if(typeof name!=='string'||!name||name.includes('\0'))throw Error('无效文件路径');const target=path.resolve(this.repo,name);const rel=path.relative(this.repo,target);if((rel==='..'||rel.startsWith('..'+path.sep))||path.isAbsolute(rel)||rel.split(/[\\/]/).some(x=>x.toLowerCase()==='.git'))throw Error('不允许访问仓库外部或 Git 内部文件');const root=await fs.realpath(this.repo);let ancestor=target;let actual;for(;;){try{actual=await fs.realpath(ancestor);break;}catch(e){if(!['ENOENT','ENOTDIR'].includes(e.code))throw e;const parent=path.dirname(ancestor);if(parent===ancestor)throw e;ancestor=parent;}}const relative=path.relative(root,actual);if((relative==='..'||relative.startsWith('..'+path.sep))||path.isAbsolute(relative))throw Error('禁止通过链接访问仓库外部文件');return target;}
 async snapshot(){
 const raw=await this.git(['status','--porcelain=v1','-z','--untracked-files=all']);const parts=raw.split('\0');const files=[];
 for(let i=0;i<parts.length;i++){const s=parts[i];if(!s)continue;const item={x:s[0],y:s[1],path:s.slice(3)};if(/[RC]/.test(item.x+item.y))item.oldPath=parts[++i];item.conflict=['DD','AU','UD','UA','DU','AA','UU'].includes(item.x+item.y);files.push(item);}
 const [branch,branches,logs,stashRaw,remotes,counts,gitDir]=await Promise.all([
 this.git(['symbolic-ref','--short','HEAD'],true),this.git(['for-each-ref','--format=%(refname:short)%09%(HEAD)%09%(upstream:short)%09%(refname)','refs/heads','refs/remotes']),this.git(['log','--all','--date-order','-180','--format=%H%x1f%P%x1f%an%x1f%aI%x1f%s%x1f%D%x1e'],true),this.git(['stash','list','--format=%gd%x1f%gs%x1f%ci']),this.git(['remote','-v']),this.git(['rev-list','--left-right','--count','HEAD...@{upstream}'],true),this.git(['rev-parse','--absolute-git-dir'])]);
 const gd=gitDir.trim();const merging=await fs.access(path.join(gd,'MERGE_HEAD')).then(()=>true,()=>false);
 return {repo:this.repo,branch:branch.trim()||'(分离 HEAD / 未提交)',files,branches:branches.trim().split('\n').filter(Boolean).map(l=>{const [name,current,upstream,ref]=l.split('\t');return {name,current:current==='*',upstream,remote:ref.startsWith('refs/remotes/')};}),commits:logs.split('\x1e').map(s=>s.trim()).filter(Boolean).map(l=>{const [hash,parents,author,date,subject,refs]=l.split('\x1f');return {hash,parents:parents?parents.split(' '):[],author,date,subject,refs};}),stashes:stashRaw.trim().split('\n').filter(Boolean).map(l=>{const [ref,subject,date]=l.split('\x1f');return {ref,subject,date};}),remotes:remotes.trim(),counts:counts.trim(),merging};
 }
 async diff({file,staged=false,commit,stash}){
 if(commit){if(!/^[a-f0-9]{40}$/.test(commit))throw Error('无效提交');return this.git(['show','--no-ext-diff','--no-textconv','--format=fuller','--stat','--patch',commit,...(file?['--',file]:[])]);}
 if(stash){this.checkStash(stash);return this.git(['stash','show','--no-ext-diff','--no-textconv','--include-untracked','--stat','--patch',stash]);}
 await this.filePath(file);const status=await this.git(['status','--porcelain=v1','--',file]);if(status.startsWith('??')){const stat=await fs.stat(await this.filePath(file));if(stat.size>2*1024*1024)return '文件超过 2MB，暂不预览。';const data=await fs.readFile(await this.filePath(file));return data.includes(0)?'二进制文件':data.toString('utf8').split('\n').map(x=>'+'+x).join('\n');}
 return this.git(['diff',...(staged?['--cached']:[]),'--no-ext-diff','--no-textconv','--',file]);
 }
 checkStash(ref){if(!/^stash@\{\d+\}$/.test(ref))throw Error('无效 Stash 引用');}
 async mutate(action,p={}){if(this.busy)throw Error('另一个 Git 操作正在执行，请稍候');this.busy=true;try{
 switch(action){
 case 'stage': case 'unstage':{if(!Array.isArray(p.files)||!p.files.length)throw Error('请选择文件');const status=await this.snapshot();const files=action==='stage'?p.files:[...new Set(p.files.flatMap(f=>{const item=status.files.find(i=>i.path===f);return item?.oldPath?[f,item.oldPath]:[f];}))];for(const f of files)await this.filePath(f);if(action==='stage')return await this.git(['add','--',...files]);const hasHead=(await this.git(['rev-parse','--verify','HEAD'],true)).trim();return await this.git(hasHead?['restore','--staged','--',...files]:['rm','--cached','--',...files]);}
 case 'commit':if(!p.message?.trim())throw Error('请输入提交说明');return await this.git(['commit','-m',p.message]);
 case 'createBranch':if(!p.name||p.name.startsWith('-'))throw Error('请输入有效分支名');await this.git(['check-ref-format','--branch',p.name]);return await this.git(['switch','-c',p.name]);
 case 'track':{if(!p.name||p.name.startsWith('-')||p.name.endsWith('/HEAD'))throw Error('无效远程分支');const ref='refs/remotes/'+p.name;await this.git(['show-ref','--verify',ref]);const local=p.name.slice(p.name.indexOf('/')+1);await this.git(['check-ref-format','--branch',local]);return await this.git(['switch','--track','-c',local,ref]);}
 case 'switch':if(!p.name||p.name.startsWith('-'))throw Error('无效分支名');return await this.git(['switch',p.name]);
 case 'fetch':return await this.git(['fetch','--all']);
 case 'pull':return await this.git(['pull','--ff-only']);
 case 'push':return await this.git(['push']);
 case 'merge':if(!p.name||p.name.startsWith('-'))throw Error('无效分支名');return await this.git(['merge','--no-edit',p.name]);
 case 'abortMerge':return await this.git(['merge','--abort']);
 case 'stashSave':return await this.git(['stash','push',...(p.includeUntracked?['--include-untracked']:[]),'-m',p.message?.trim()||'Branchcraft 保存的修改']);
 case 'stashApply':case 'stashPop':case 'stashDrop':this.checkStash(p.ref);if(p.hash){const actual=(await this.git(['rev-parse',p.ref])).trim();if(actual!==p.hash)throw Error('Stash 列表已变化，请刷新后重试');}return await this.git(['stash',({stashApply:'apply',stashPop:'pop',stashDrop:'drop'})[action],p.ref]);
 default:throw Error('不支持的操作');
 }
 }finally{this.busy=false;}}

 async rollbackPreview(file){
 const target=await this.filePath(file);let data=Buffer.alloc(0);try{const st=await fs.lstat(target);if(!st.isFile()||st.isSymbolicLink())throw Error('仅支持普通文件回退');if(st.size>2*1024*1024)throw Error('文件超过 2MB，请使用外部工具');data=await fs.readFile(target);}catch(e){if(e.code!=='ENOENT')throw e;}
 const status=(await this.snapshot()).files.find(f=>f.path===file);if(!status||status.conflict)throw Error('文件状态已变化，或存在冲突，请刷新');
 const diff=await this.git(['diff','--no-ext-diff','--no-textconv','--binary','--',file]);
 const index=await this.git(['ls-files','--stage','--',file]);
 const token=createHash('sha256').update(JSON.stringify(status)).update(data).update(diff).update(index).digest('hex');
 const lines=diff.split('\n');const starts=[];lines.forEach((line,i)=>{if(/^@@ /.test(line))starts.push(i);});
 const hunks=starts.map((start,i)=>({label:lines[start],patch:lines.slice(0,starts[0]).join('\n')+'\n'+lines.slice(start,starts[i+1]??lines.length).join('\n').replace(/\n?$/,'\n')}));
 return {file,token,diff,hunks,untracked:status.x==='?',status};
 }
 async rollback({file,token,hunk}){
 if(this.busy)throw Error('另一个操作正在执行');this.busy=true;let temp;
 try{const current=await this.rollbackPreview(file);if(current.token!==token)throw Error('文件或暂存区已变化，请重新查看差异后回退');
 if(hunk!==undefined){if(!Number.isInteger(hunk)||!current.hunks[hunk])throw Error('无效代码块');temp=await fs.mkdtemp(path.join(os.tmpdir(),'branchcraft-patch-'));const patch=path.join(temp,'reverse.patch');await fs.writeFile(patch,current.hunks[hunk].patch);await this.git(['apply','--reverse','--check','--',patch]);await this.git(['apply','--reverse','--',patch]);}
 else if(current.untracked)await fs.unlink(await this.filePath(file));
 else await this.git(['restore','--worktree','--',file]);
 return '已回退未暂存修改，暂存区保持不变';
 }finally{if(temp)await fs.rm(temp,{recursive:true,force:true});this.busy=false;}
 }
 async stashHash(ref){this.checkStash(ref);return (await this.git(['rev-parse',ref])).trim();}
 async conflict(file){const f=await this.filePath(file);const stat=await fs.stat(f);if(stat.size>2*1024*1024)throw Error('文件超过 2MB，请用外部编辑器处理');const raw=await fs.readFile(f);if(raw.includes(0))throw Error('二进制冲突请用外部工具处理');const [base,ours,theirs]=await Promise.all([1,2,3].map(n=>this.git(['show',`:${n}:${file}`],true)));return {file,base,ours,theirs,content:raw.toString('utf8')};}
 async resolve({file,content}){if(this.busy)throw Error('另一个 Git 操作正在执行，请稍候');this.busy=true;try{const state=await this.snapshot();if(!state.files.some(f=>f.path===file&&f.conflict))throw Error('该文件已不处于冲突状态，请刷新');if(typeof content!=='string')throw Error('无效内容');if(/^(<<<<<<< |=======\r?$|>>>>>>> )/m.test(content))throw Error('内容仍含冲突标记，请先清理');await fs.writeFile(await this.filePath(file),content,'utf8');await this.git(['add','--',file]);return '已保存并暂存解决结果';}finally{this.busy=false;}}
}
module.exports={GitService};
