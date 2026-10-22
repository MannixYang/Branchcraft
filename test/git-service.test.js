'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {GitService}=require('../git-service');
const git=(dir,...args)=>execFileSync('git',['-c','core.quotepath=false',...args],{cwd:dir,encoding:'utf8',windowsHide:true});
async function repo(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'branchcraft-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:200}));git(dir,'init','-b','main');git(dir,'config','user.name','测试用户');git(dir,'config','user.email','test@example.invalid');git(dir,'config','core.autocrlf','false');return new GitService(dir);}
async function write(s,file,text){await fs.mkdir(path.dirname(path.join(s.repo,file)),{recursive:true});await fs.writeFile(path.join(s.repo,file),text);}
async function commit(s,file='a.txt',text='base\n'){await write(s,file,text);await s.mutate('stage',{files:[file]});await s.mutate('commit',{token:(await s.commitPreview()).token,message:'初始提交'});}

test('空仓库、中文空格文件、初次暂存取消与提交',async t=>{const s=await repo(t);assert.equal((await s.snapshot()).commits.length,0);const f='中文 空格/文件.txt';await write(s,f,'你好\n');assert.match(await s.diff({file:f}),/\+你好/);await s.mutate('stage',{files:[f]});assert.equal((await s.snapshot()).files[0].x,'A');await s.mutate('unstage',{files:[f]});assert.equal((await s.snapshot()).files[0].x,'?');await s.mutate('stage',{files:[f]});await s.mutate('commit',{token:(await s.commitPreview()).token,message:'中文提交'});const snap=await s.snapshot();assert.equal(snap.files.length,0);assert.equal(snap.commits[0].subject,'中文提交');assert.match(await s.diff({commit:snap.commits[0].hash}),/你好/);});

test('同一文件已暂存与未暂存修改分别预览',async t=>{const s=await repo(t);await commit(s);await write(s,'a.txt','staged\n');await s.mutate('stage',{files:['a.txt']});await write(s,'a.txt','working\n');const f=(await s.snapshot()).files[0];assert.equal(f.x+f.y,'MM');assert.match(await s.diff({file:'a.txt',staged:true}),/\+staged/);assert.match(await s.diff({file:'a.txt'}),/\+working/);await s.mutate('unstage',{files:['a.txt']});assert.equal((await s.snapshot()).files[0].x,' ');});

test('删除整层目录后可预览与暂存删除',async t=>{const s=await repo(t);await commit(s,'深层/目录/a.txt');await fs.rm(path.join(s.repo,'深层'),{recursive:true});assert.match(await s.diff({file:'深层/目录/a.txt'}),/deleted file/);await s.mutate('stage',{files:['深层/目录/a.txt']});assert.equal((await s.snapshot()).files[0].x,'D');await s.mutate('unstage',{files:['深层/目录/a.txt']});assert.equal((await s.snapshot()).files[0].y,'D');});

test('重命名状态正确解析并可整体取消暂存',async t=>{const s=await repo(t);await commit(s,'a.txt','base\n'.repeat(20));git(s.repo,'mv','a.txt','新 文件.txt');const f=(await s.snapshot()).files[0];assert.equal(f.x,'R');assert.equal(f.oldPath,'a.txt');assert.equal(f.path,'新 文件.txt');await write(s,f.path,'base\n'.repeat(20)+'renamed modification\n');await s.mutate('stage',{files:[f.path]});assert.match(await s.diff({file:f.path,staged:true}),/renamed modification/);await s.mutate('unstage',{files:[f.path]});assert.ok((await s.snapshot()).files.every(x=>x.x===' '||x.x==='?'));});

test('本地分支创建、切换、合并和非法分支拒绝',async t=>{const s=await repo(t);await commit(s);await s.mutate('createBranch',{name:'feature/demo'});await commit(s,'feature.txt','feature\n');await s.mutate('switch',{name:'main'});await s.mutate('merge',{name:'feature/demo'});assert.equal((await s.snapshot()).branch,'main');assert.equal(await fs.readFile(path.join(s.repo,'feature.txt'),'utf8'),'feature\n');await assert.rejects(s.mutate('createBranch',{name:'--bad'}));await assert.rejects(s.mutate('createBranch',{name:'bad..name'}));});

async function conflictRepo(t,file='a.txt'){const s=await repo(t);await commit(s,file);await s.mutate('createBranch',{name:'other'});await commit(s,file,'other\n');await s.mutate('switch',{name:'main'});await commit(s,file,'main\n');await assert.rejects(s.mutate('merge',{name:'other'}));return s;}
test('合并冲突读取、拒绝标记、编辑解决并完成提交',async t=>{const s=await conflictRepo(t);assert.equal((await s.snapshot()).merging,true);assert.equal((await s.snapshot()).files[0].conflict,true);const c=await s.conflict('a.txt');assert.equal(c.ours,'main\n');assert.equal(c.theirs,'other\n');await assert.rejects(s.resolve({file:'a.txt',token:c.token,content:c.content}),/冲突标记/);await s.resolve({file:'a.txt',token:c.token,content:'合并完成\n'});assert.ok((await s.snapshot()).files.every(f=>!f.conflict));await s.mutate('commit',{token:(await s.commitPreview()).token,message:'解决合并'});assert.equal((await s.snapshot()).merging,false);assert.equal((await s.snapshot()).commits[0].parents.length,2);});
test('中止合并还原原始文件',async t=>{const s=await conflictRepo(t);await s.mutate('abortMerge');assert.equal((await s.snapshot()).merging,false);assert.equal(await fs.readFile(path.join(s.repo,'a.txt'),'utf8'),'main\n');});

test('Stash 保存含未跟踪、预览、应用、删除与恢复移除',async t=>{const s=await repo(t);await commit(s);await write(s,'a.txt','work\n');await write(s,'新文件.txt','untracked\n');await s.mutate('stashSave',{message:'进行中',includeUntracked:true});let snap=await s.snapshot();assert.equal(snap.files.length,0);assert.equal(snap.stashes.length,1);const ref=snap.stashes[0].ref,hash=await s.stashHash(ref);assert.match(await s.diff({stash:ref}),/untracked/);await s.mutate('stashApply',{ref,hash});assert.equal((await s.snapshot()).stashes.length,1);assert.equal(await fs.readFile(path.join(s.repo,'新文件.txt'),'utf8'),'untracked\n');await s.mutate('stashDrop',{ref,hash});assert.equal((await s.snapshot()).stashes.length,0);await s.mutate('stashSave',{includeUntracked:true});await s.mutate('stashPop',{ref:'stash@{0}',hash:await s.stashHash('stash@{0}')});assert.equal((await s.snapshot()).stashes.length,0);assert.equal(await fs.readFile(path.join(s.repo,'a.txt'),'utf8'),'work\n');});

test('Stash 列表变化时拒绝过期删除，冲突时 pop 保留储藏',async t=>{const s=await repo(t);await commit(s);await write(s,'a.txt','first\n');await s.mutate('stashSave');const old=await s.stashHash('stash@{0}');await write(s,'a.txt','second\n');await s.mutate('stashSave');await assert.rejects(s.mutate('stashDrop',{ref:'stash@{0}',hash:old}),/列表已变化/);await commit(s,'a.txt','new base\n');await assert.rejects(s.mutate('stashPop',{ref:'stash@{0}'}));assert.equal((await s.snapshot()).stashes.length,2);assert.equal((await s.snapshot()).files[0].conflict,true);});

test('非 origin 远程识别、显式跟踪、fetch/push/pull',async t=>{const s=await repo(t);await commit(s);const bare=await fs.mkdtemp(path.join(os.tmpdir(),'branchcraft-remote-'));t.after(()=>fs.rm(bare,{recursive:true,force:true,maxRetries:5,retryDelay:200}));git(bare,'init','--bare');git(s.repo,'remote','add','upstream',bare);git(s.repo,'push','-u','upstream','main');await s.mutate('fetch');const b=(await s.snapshot()).branches.find(b=>b.name==='upstream/main');assert.equal(b.remote,true);await s.mutate('createBranch',{name:'topic'});await commit(s,'topic.txt','topic\n');git(s.repo,'push','upstream','topic');await s.mutate('switch',{name:'main'});git(s.repo,'branch','-D','topic');await s.mutate('track',{name:'upstream/topic'});assert.equal((await s.snapshot()).branch,'topic');assert.match((await s.snapshot()).branches.find(b=>b.current).upstream,/upstream\/topic/);await s.mutate('push');await s.mutate('pull');await assert.rejects(s.mutate('track',{name:'upstream/topic'}));});

test('路径逃逸、内部目录、非法引用与并发锁防护',async t=>{const s=await repo(t);await commit(s);for(const f of ['../outside','.git/config','a\0.txt'])await assert.rejects(s.filePath(f));await assert.rejects(s.diff({commit:'--all'}));await assert.rejects(s.stashHash('HEAD'));await assert.rejects(s.mutate('stage',{files:[]}));s.busy=true;await assert.rejects(s.mutate('stashSave'),/正在执行/);await assert.rejects(s.resolve({file:'a.txt',token:'not-a-conflict-preview',content:'x'}),/正在执行/);s.busy=false;await assert.rejects(s.resolve({file:'a.txt',token:'not-a-conflict-preview',content:'x'}),/冲突状态/);});

test('二进制和大文件预览边界',async t=>{const s=await repo(t);await write(s,'binary.bin',Buffer.from([0,1,2]));assert.equal(await s.diff({file:'binary.bin'}),'二进制文件');await write(s,'large.txt',Buffer.alloc(2*1024*1024+1,65));assert.match(await s.diff({file:'large.txt'}),/超过 2MB/);});


test('安全回退：保护暂存区，代码块及过期检测',async t=>{
 const s=await repo(t);const base=Array.from({length:30},(_,i)=>'line '+i+'\n').join('');await commit(s,'a.txt',base);
 const staged=base.replace('line 2\n','staged\n');await write(s,'a.txt',staged);await s.mutate('stage',{files:['a.txt']});
 const changed=staged.replace('line 10\n','changed one\n').replace('line 25\n','changed two\n');await write(s,'a.txt',changed);
 const index=await s.git(['show',':a.txt']);let preview=await s.rollbackPreview('a.txt');assert.equal(preview.hunks.length,2);
 await s.rollback({file:'a.txt',token:preview.token,hunk:0});assert.equal(await s.git(['show',':a.txt']),index);
 assert.equal(await fs.readFile(path.join(s.repo,'a.txt'),'utf8'),staged.replace('line 25\n','changed two\n'));
 await assert.rejects(s.rollback({file:'a.txt',token:preview.token}),/已变化/);
 preview=await s.rollbackPreview('a.txt');await s.rollback({file:'a.txt',token:preview.token});assert.equal(await fs.readFile(path.join(s.repo,'a.txt'),'utf8'),staged);assert.equal(await s.git(['show',':a.txt']),index);
 await write(s,'new.txt','new');preview=await s.rollbackPreview('new.txt');await s.rollback({file:'new.txt',token:preview.token});await assert.rejects(fs.stat(path.join(s.repo,'new.txt')));
 await assert.rejects(s.rollbackPreview('../escape'),/不允许/);
});

const hunkDiff=(s,file='a.txt',staged=false)=>s.diff({file,staged,hunks:true});
const lines=()=>Array.from({length:50},(_,i)=>`line ${i}\n`).join('');
test('hunk：多块精确暂存取消、方向和工作区隔离',async t=>{
 const s=await repo(t),base=lines();await commit(s,'a.txt',base);
 const changed=base.replace('line 5\n','first\nextra\n').replace('line 35\n','last\n');await write(s,'a.txt',changed);
 let p=await hunkDiff(s);assert.equal(p.hunks.length,2);assert.deepEqual(p.hunks.map(h=>h.index),[0,1]);assert.equal(typeof await s.diff({file:'a.txt'}),'string');
 await s.mutate('stageHunk',{file:'a.txt',token:p.hunkToken,hunk:1});
 assert.equal(await s.git(['show',':a.txt']),base.replace('line 35\n','last\n'));assert.equal(await fs.readFile(path.join(s.repo,'a.txt'),'utf8'),changed);
 await assert.rejects(s.mutate('stageHunk',{file:'a.txt',token:p.hunkToken,hunk:0}),/已变化/);
 p=await hunkDiff(s);await s.mutate('stageHunk',{file:'a.txt',token:p.hunkToken,hunk:0});assert.equal(await s.git(['show',':a.txt']),changed);
 p=await hunkDiff(s,'a.txt',true);assert.equal(p.hunks.length,2);
 await assert.rejects(s.mutate('stageHunk',{file:'a.txt',token:p.hunkToken,hunk:0}));
 await s.mutate('unstageHunk',{file:'a.txt',token:p.hunkToken,hunk:0});assert.equal(await s.git(['show',':a.txt']),base.replace('line 35\n','last\n'));
 p=await hunkDiff(s,'a.txt',true);await s.mutate('unstageHunk',{file:'a.txt',token:p.hunkToken,hunk:0});assert.equal(await s.git(['show',':a.txt']),base);assert.equal(await fs.readFile(path.join(s.repo,'a.txt'),'utf8'),changed);
});
test('hunk：工作区、index、文件 token 绑定',async t=>{
 const s=await repo(t),base=lines();await commit(s,'a.txt',base);await commit(s,'b.txt',base);
 const changed=base.replace('line 5\n','changed\n');await write(s,'a.txt',changed);await write(s,'b.txt',changed);
 const p=await hunkDiff(s);await assert.rejects(s.mutate('stageHunk',{file:'b.txt',token:p.hunkToken,hunk:0}),/已变化/);
 await write(s,'a.txt',changed+'later\n');await assert.rejects(s.mutate('stageHunk',{file:'a.txt',token:p.hunkToken,hunk:0}),/已变化/);
 await write(s,'a.txt',changed);await s.mutate('stage',{files:['a.txt']});const q=await hunkDiff(s,'a.txt',true);
 await write(s,'a.txt',changed+'later\n');await assert.rejects(s.mutate('unstageHunk',{file:'a.txt',token:q.hunkToken,hunk:0}),/已变化/);
 await write(s,'a.txt',changed);await s.mutate('unstage',{files:['a.txt']});await write(s,'a.txt',base.replace('line 40\n','index edit\n'));await s.mutate('stage',{files:['a.txt']});await write(s,'a.txt',changed);
 await assert.rejects(s.mutate('stageHunk',{file:'a.txt',token:p.hunkToken,hunk:0}),/已变化/);
});
test('hunk：中文空格、无末尾换行和未暂存修改隔离',async t=>{
 const s=await repo(t),file='中文 空格.txt',base=lines()+'end';await commit(s,file,base);
 const indexed=base.replace('line 5\n','index\n');await write(s,file,indexed);await s.mutate('stage',{files:[file]});const working=indexed.replace('end','tail');await write(s,file,working);
 let p=await hunkDiff(s,file);await s.mutate('stageHunk',{file,token:p.hunkToken,hunk:0});assert.equal(await s.git(['show',':'+file]),working);
 p=await hunkDiff(s,file,true);assert.equal(p.hunks.length,2);await s.mutate('unstageHunk',{file,token:p.hunkToken,hunk:1});assert.equal(await s.git(['show',':'+file]),indexed);assert.equal(await fs.readFile(path.join(s.repo,file),'utf8'),working);
});
test('hunk：拒绝非法参数路径、不支持状态与边界',async t=>{
 const s=await repo(t);await commit(s);await write(s,'a.txt','edit\n');const p=await hunkDiff(s);
 for(const hunk of [-1,0.5,'0',null,undefined,100])await assert.rejects(s.mutate('stageHunk',{file:'a.txt',token:p.hunkToken,hunk}),/无效/);
 for(const file of ['../outside','.git/config',':(glob)*','.','a\0.txt'])await assert.rejects(hunkDiff(s,file));
 await write(s,'new.txt','new');await assert.rejects(hunkDiff(s,'new.txt'),/不支持/);
 await write(s,'a.txt',Buffer.from([0,1,2]));await assert.rejects(hunkDiff(s),/二进制/);
 await write(s,'a.txt',Buffer.alloc(2*1024*1024+1,65));await assert.rejects(hunkDiff(s),/2MB/);
 await write(s,'a.txt','base\n');await assert.rejects(hunkDiff(s),/不支持|没有/);
 await fs.unlink(path.join(s.repo,'a.txt'));await assert.rejects(hunkDiff(s),/不支持/);
 await write(s,'a.txt','base\n');git(s.repo,'mv','a.txt','renamed.txt');await assert.rejects(hunkDiff(s,'renamed.txt',true),/不支持/);
 const c=await conflictRepo(t);await assert.rejects(hunkDiff(c),/冲突/);
});
test('hunk：apply check/apply 失败传播并释放 busy',async t=>{
 const s=await repo(t);await commit(s);await write(s,'a.txt','edit\n');const p=await hunkDiff(s),original=s.git.bind(s);const index=await original(['show',':a.txt']);
 for(const failCheck of [true,false]){
 const calls=[];s.git=async(args,...rest)=>{if(args[0]==='apply'){calls.push(args);if(args.includes('--check')===failCheck)throw Error('injected apply failure');}return original(args,...rest);};
 await assert.rejects(s.mutate('stageHunk',{file:'a.txt',token:p.hunkToken,hunk:0}),/injected apply failure/);assert.equal(s.busy,false);assert.equal(calls.length,failCheck?1:2);assert.ok(calls.every(a=>a.includes('--cached')));assert.equal(await original(['show',':a.txt']),index);assert.equal(await fs.readFile(path.join(s.repo,'a.txt'),'utf8'),'edit\n');
 }s.git=original;
});

test('hunk：HEAD 变化、并发锁及检查期间变更拒绝',async t=>{
 const s=await repo(t);await commit(s);await write(s,'a.txt','edit\n');await s.mutate('stage',{files:['a.txt']});const staged=await hunkDiff(s,'a.txt',true);
 git(s.repo,'commit','--allow-empty','--only','-m','head changed');
 await assert.rejects(s.mutate('unstageHunk',{file:'a.txt',token:staged.hunkToken,hunk:0}),/已变化/);
 await s.mutate('unstage',{files:['a.txt']});const p=await hunkDiff(s);
 s.busy=true;await assert.rejects(s.mutate('stageHunk',{file:'a.txt',token:p.hunkToken,hunk:0}),/操作正在执行/);s.busy=false;
 const original=s.git.bind(s);let applies=0;s.git=async(args,...rest)=>{const result=await original(args,...rest);if(args[0]==='apply'){applies++;if(args.includes('--check'))await write(s,'a.txt','raced\n');}return result;};
 await assert.rejects(s.mutate('stageHunk',{file:'a.txt',token:p.hunkToken,hunk:0}),/已变化/);assert.equal(applies,1);assert.equal(await original(['show',':a.txt']),'base\n');assert.equal(s.busy,false);s.git=original;
});

test('commit review: required token, staged files, index and HEAD binding, hook failures',async t=>{
 const s=await repo(t);await write(s,'a.txt','base\n');await s.mutate('stage',{files:['a.txt']});
 const p=await s.commitPreview();assert.match(p.token,/^[a-f0-9]{64}$/);assert.ok(p.files.some(f=>f.path==='a.txt'));assert.match(p.diff,/base/);
 await assert.rejects(s.mutate('commit',{message:'no review'}),/审阅/);
 await s.mutate('commit',{message:'base',token:p.token});
 await write(s,'a.txt','second\n');await s.mutate('stage',{files:['a.txt']});const old=await s.commitPreview();
 await write(s,'a.txt','third\n');await s.mutate('stage',{files:['a.txt']});await assert.rejects(s.mutate('commit',{message:'stale index',token:old.token}),/审阅/);
 const reviewed=await s.commitPreview();await s.git(['commit','--allow-empty','-m','external']);await assert.rejects(s.mutate('commit',{message:'stale head',token:reviewed.token}),/审阅/);
 await write(s,'a.txt','fourth\n');await s.mutate('stage',{files:['a.txt']});const valid=await s.commitPreview();
 const gd=(await s.git(['rev-parse','--absolute-git-dir'])).trim();const hook=path.join(gd,'hooks','pre-commit');await fs.writeFile(hook,'#!/bin/sh\necho REVIEW_HOOK_REJECTED >&2\nexit 1\n',{mode:0o755});
 await assert.rejects(s.mutate('commit',{message:'hook',token:valid.token}),/REVIEW_HOOK_REJECTED/);assert.equal(s.busy,false);await fs.unlink(hook);
 await s.mutate('commit',{message:'retry after hook',token:valid.token});
});


test('literal pathspec isolates [ab].txt during initial/HEAD stage, unstage and diff',async t=>{
 const s=await repo(t),file='[ab].txt',names=[file,'a.txt','b.txt'];
 for(const f of names)await write(s,f,'base '+f+'\n');
 assert.equal(await s.diff({file}),'+base [ab].txt\n+');
 await s.mutate('stage',{files:[file]});
 assert.deepEqual((await s.snapshot()).files.filter(f=>f.x==='A').map(f=>f.path),[file]);
 await s.mutate('unstage',{files:[file]});assert.ok((await s.snapshot()).files.every(f=>f.x==='?'));
 await s.mutate('stage',{files:names});await s.mutate('unstage',{files:[file]});
 assert.deepEqual((await s.snapshot()).files.filter(f=>f.x==='A').map(f=>f.path).sort(),['a.txt','b.txt']);
 await s.mutate('stage',{files:[file]});await s.mutate('commit',{message:'literal base',token:(await s.commitPreview()).token});
 const hash=(await s.snapshot()).commits[0].hash;
 const shown=await s.diff({file,commit:hash});assert.match(shown,/base \[ab\]\.txt/);assert.doesNotMatch(shown,/base [ab]\.txt/);
 for(const f of names)await write(s,f,'changed '+f+'\n');
 const diff=await s.diff({file});assert.match(diff,/\+changed \[ab\]\.txt/);assert.doesNotMatch(diff,/\+changed [ab]\.txt/);
 await s.mutate('stage',{files:[file]});assert.deepEqual((await s.snapshot()).files.filter(f=>f.x==='M').map(f=>f.path),[file]);
 const staged=await s.diff({file,staged:true});assert.match(staged,/\+changed \[ab\]\.txt/);assert.doesNotMatch(staged,/\+changed [ab]\.txt/);
 await s.mutate('unstage',{files:[file]});assert.ok((await s.snapshot()).files.every(f=>f.x===' '));
 await s.mutate('stage',{files:names});await s.mutate('unstage',{files:[file]});
 assert.deepEqual((await s.snapshot()).files.filter(f=>f.x==='M').map(f=>f.path).sort(),['a.txt','b.txt']);
});

test('conflict token rejects missing token, externally changed worktree and unmerged index entries',async t=>{
 const s=await conflictRepo(t),c=await s.conflict('a.txt'),target=path.join(s.repo,'a.txt');
 await assert.rejects(s.resolve({file:'a.txt',content:'resolved\n'}),/token/);
 await fs.writeFile(target,'external\n');
 await assert.rejects(s.resolve({file:'a.txt',token:c.token,content:'resolved\n'}),/已变化/);
 assert.equal(await fs.readFile(target,'utf8'),'external\n');
 await fs.writeFile(target,c.content);const index=await s.git(['ls-files','--unmerged','--stage','--',':(literal)a.txt']);
 const entry=index.split('\n').find(line=>/ 3\t/.test(line));const oid=(await s.git(['rev-parse','HEAD:a.txt'])).trim();
 const old=entry.split(' ')[1];
 // execFileSync supplies stdin without altering the worktree.
 execFileSync('git',['update-index','--index-info'],{cwd:s.repo,input:entry.replace(old,oid)+'\n',encoding:'utf8',windowsHide:true});
 await assert.rejects(s.resolve({file:'a.txt',token:c.token,content:'resolved\n'}),/已变化/);
 assert.equal(await fs.readFile(target,'utf8'),c.content);assert.equal(s.busy,false);
});

test('conflict save replaces hardlink without overwriting peer and preserves mode',async t=>{
 const s=await conflictRepo(t),target=path.join(s.repo,'a.txt'),peer=path.join(s.repo,'peer.txt');
 await fs.link(target,peer);const before=await fs.readFile(peer),mode=(await fs.stat(target)).mode&0o777,c=await s.conflict('a.txt');
 await s.resolve({file:'a.txt',token:c.token,content:'resolved\n'});
 assert.deepEqual(await fs.readFile(peer),before);assert.equal(await fs.readFile(target,'utf8'),'resolved\n');
 assert.equal((await fs.stat(target)).mode&0o777,mode);assert.equal(await s.git(['show',':a.txt']),'resolved\n');
 assert.ok(!(await fs.readdir(s.repo)).some(f=>f.startsWith('.branchcraft-conflict-')));
});

test('conflict save rechecks immediately before rename and cleans temporary files',async t=>{
 const s=await conflictRepo(t),c=await s.conflict('a.txt'),target=path.join(s.repo,'a.txt'),original=s.conflictState.bind(s);let checks=0;
 s.conflictState=async(file)=>{if(++checks===2)await fs.writeFile(target,'late external\n');return original(file);};
 await assert.rejects(s.resolve({file:'a.txt',token:c.token,content:'resolved\n'}),/已变化/);
 assert.equal(await fs.readFile(target,'utf8'),'late external\n');assert.equal(s.busy,false);
 assert.ok(!(await fs.readdir(s.repo)).some(f=>f.startsWith('.branchcraft-conflict-')));
});

test('conflict preview and save reject file symlinks',async t=>{
 const s=await conflictRepo(t),c=await s.conflict('a.txt'),target=path.join(s.repo,'a.txt'),peer=path.join(s.repo,'peer.txt');
 await fs.rename(target,peer);
 try{await fs.symlink(peer,target,'file');}catch(e){if(['EPERM','EACCES','ENOSYS','ENOTSUP'].includes(e.code)){t.skip('file symlink unavailable: '+e.code);return;}throw e;}
 await assert.rejects(s.conflict('a.txt'),/链接/);await assert.rejects(s.resolve({file:'a.txt',token:c.token,content:'resolved\n'}),/链接/);
 assert.equal(await fs.readFile(peer,'utf8'),c.content);
});

test('conflict preview and save reject linked parent directory (Windows junction fallback)',async t=>{
 const s=await conflictRepo(t,'dir/a.txt'),file='dir/a.txt',c=await s.conflict(file),target=path.join(s.repo,'dir'),peer=path.join(s.repo,'peer-dir');
 await fs.rename(target,peer);
 try{await fs.symlink(peer,target,'dir');}catch(e){
  if(!['EPERM','EACCES','ENOSYS','ENOTSUP'].includes(e.code))throw e;
  if(process.platform!=='win32'){t.skip('directory symlink unavailable: '+e.code);return;}
  await fs.symlink(peer,target,'junction');t.diagnostic('directory symlink unavailable; parent rejection verified using junction');
 }
 await assert.rejects(s.conflict(file),/链接/);await assert.rejects(s.resolve({file,token:c.token,content:'resolved\n'}),/链接/);
 assert.equal(await fs.readFile(path.join(peer,'a.txt'),'utf8'),c.content);
});

test('conflict preview and save reject non-regular directory target',async t=>{
 const s=await conflictRepo(t),c=await s.conflict('a.txt'),target=path.join(s.repo,'a.txt');await fs.unlink(target);await fs.mkdir(target);
 await assert.rejects(s.conflict('a.txt'),/普通文件/);await assert.rejects(s.resolve({file:'a.txt',token:c.token,content:'resolved\n'}),/普通文件/);
});

test('literal conflict save stages only the reviewed file and requires token',async t=>{
 const s=await conflictRepo(t,'[ab].txt');await write(s,'a.txt','neighbor a\n');await write(s,'b.txt','neighbor b\n');
 const c=await s.conflict('[ab].txt');
 await assert.rejects(s.resolve({file:'[ab].txt',content:'resolved\n'}),/token/);
 await s.resolve({file:'[ab].txt',token:c.token,content:'resolved\n'});
 assert.equal(await s.git(['show',':[ab].txt']),'resolved\n');
 const entries=await s.git(['ls-files','-z']);assert.deepEqual(entries.split('\0').filter(Boolean),['[ab].txt']);
 assert.equal(await fs.readFile(path.join(s.repo,'a.txt'),'utf8'),'neighbor a\n');
 assert.equal(await fs.readFile(path.join(s.repo,'b.txt'),'utf8'),'neighbor b\n');
});