 'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');const {RepositoryWatcher}=require('../repo-watcher');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const git=(repo,...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',windowsHide:true});
async function setup(t){const repo=await fs.mkdtemp(path.join(os.tmpdir(),'watch-test-'));t.after(()=>fs.rm(repo,{recursive:true,force:true,maxRetries:10,retryDelay:100}));git(repo,'init','-b','main');git(repo,'config','user.name','Test');git(repo,'config','user.email','t@t');git(repo,'config','core.autocrlf','false');await fs.writeFile(path.join(repo,'a'),'base');git(repo,'add','.');git(repo,'commit','-m','base');return repo;}
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await sleep(100);}assert.fail('watch notification timed out');}
test('recursive Windows watcher debounces external changes; read refresh stable; closes cleanly',async t=>{
 const repo=await setup(t),events=[];const w=new RepositoryWatcher(repo,{onChange:e=>events.push(e),interval:60000,debounce:80});t.after(()=>w.close());await w.ready;
 await fs.mkdir(path.join(repo,'nested'));for(let i=0;i<4;i++)await fs.writeFile(path.join(repo,'nested','new'),String(i));await until(()=>events.length>0);assert.deepEqual(events[0],{repo});await sleep(600);const n=events.length;
 for(let i=0;i<3;i++){git(repo,'status','--porcelain');w.schedule();}await sleep(700);assert.equal(events.length,n);
 git(repo,'add','.');await until(()=>events.length>n);const before=events.length;await w.close();await fs.writeFile(path.join(repo,'a'),'closed');await sleep(500);assert.equal(events.length,before);assert.equal(w.handles.length,0);
});
test('poll fallback notices edits, no events for recovery storage, lifecycle isolation',async t=>{
 const repo=await setup(t),dir=path.join(repo,'recovery'),events=[];await fs.mkdir(dir);const noWatch=()=>{throw Error('unavailable');};
 const w=new RepositoryWatcher(repo,{onChange:e=>events.push(e),ignore:[dir],watch:noWatch,interval:150,debounce:20});t.after(()=>w.close());await w.ready;
 await fs.writeFile(path.join(dir,'snapshot'),'ignored');await sleep(700);assert.equal(events.length,0);
 await fs.writeFile(path.join(repo,'a'),'external');await until(()=>events.length>0);await w.close();const n=events.length;await sleep(500);assert.equal(events.length,n);
 const newer=[];const next=new RepositoryWatcher(repo,{onChange:e=>newer.push(e),watch:noWatch,interval:150,debounce:20});t.after(()=>next.close());await next.ready;await fs.writeFile(path.join(repo,'a'),'external-again');await until(()=>newer.length>0);assert.equal(events.length,n);await next.close();
});

test('tracked recovery subtree is excluded from polling diffs',async t=>{
 const repo=await setup(t),recovery=path.join(repo,'recovery');await fs.mkdir(recovery);await fs.writeFile(path.join(recovery,'record'),'base');git(repo,'add','.');git(repo,'commit','-m','recovery fixture');
 let events=0;const w=new RepositoryWatcher(repo,{onChange:()=>events++,ignore:[recovery],interval:100000,watch(){throw Error('poll');}});t.after(()=>w.close());await w.ready;
 await fs.writeFile(path.join(recovery,'record'),'changed');await w.check();assert.equal(events,0);
 git(repo,'add','.');await w.check();assert.equal(events,0);await w.close();
});

test('linked worktree watches worktree git dir and common refs',async t=>{
 const root=await setup(t),linked=root+'-linked';git(root,'worktree','add','-b','linked',linked);t.after(()=>fs.rm(linked,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
 const watched=[];let events=0;const w=new RepositoryWatcher(linked,{onChange:()=>events++,interval:100000,watch(dir,options){watched.push(dir);assert.equal(options.recursive,true);return {on(){},close(){}};}});t.after(()=>w.close());await w.ready;
 assert.ok(watched.includes(path.resolve(linked)));assert.ok(watched.includes(path.join(root,'.git')));assert.ok(watched.some(dir=>dir.includes(path.join('.git','worktrees'))));
 git(root,'branch','external-common-ref');await w.check();assert.equal(events,1);await fs.writeFile(path.join(linked,'a'),'linked edit');await w.check();assert.equal(events,2);await w.close();
});
