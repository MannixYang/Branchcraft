'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {GitService}=require('../src/main/git-service');
const {GraphService}=require('../src/main/graph-service');
const env={...process.env,GIT_AUTHOR_NAME:'Graph Author',GIT_AUTHOR_EMAIL:'graph@example.invalid',GIT_COMMITTER_NAME:'Graph Author',GIT_COMMITTER_EMAIL:'graph@example.invalid',GIT_AUTHOR_DATE:'2024-01-01T12:00:00+00:00',GIT_COMMITTER_DATE:'2024-01-01T12:00:00+00:00',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null'};
function git(dir,args,input){return execFileSync('git',['-c','core.quotepath=false',...args],{cwd:dir,encoding:'utf8',windowsHide:true,env,input});}
async function fixture(t,format){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'branchcraft-graph-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:200}));
 git(dir,['init','-b','main',...(format?[`--object-format=${format}`]:[])]);
 git(dir,['config','user.name','Graph Author']);git(dir,['config','user.email','graph@example.invalid']);git(dir,['config','core.autocrlf','false']);git(dir,['config','commit.gpgsign','false']);
 const service=new GitService(dir),calls=[];const original=service.git.bind(service);
 service.git=(args,...rest)=>{calls.push(args);assert.ok(['for-each-ref','symbolic-ref','rev-parse','log','cat-file','diff-tree'].includes(args[0]),`Unexpected write command: ${args[0]}`);return original(args,...rest);};
 return {dir,graph:new GraphService(service),calls};
}
async function put(f,name,text){await fs.writeFile(path.join(f.dir,name),text);}
function commit(f,message){git(f.dir,['add','--all']);git(f.dir,['commit','-m',message]);return git(f.dir,['rev-parse','HEAD']).trim();}
async function history(t){
 const f=await fixture(t);await put(f,'base.txt','root\n');f.root=commit(f,'root\n\nroot body');
 git(f.dir,['checkout','-b','topic']);await put(f,'topic.txt','topic\n');f.topic=commit(f,'topic');
 git(f.dir,['checkout','main']);await put(f,'main.txt','main\n');f.main=commit(f,'main');
 git(f.dir,['merge','--no-ff','topic','-m','merge']);f.merge=git(f.dir,['rev-parse','HEAD']).trim();
 git(f.dir,['checkout','-b','remote-only',f.root]);await put(f,'remote.txt','remote\n');f.remote=commit(f,'remote only');git(f.dir,['update-ref','refs/remotes/origin/only',f.remote]);git(f.dir,['checkout','main']);git(f.dir,['branch','-D','remote-only']);
 await put(f,'base.txt','stash secret\n');git(f.dir,['stash','push','-m','stash only']);f.stash=git(f.dir,['rev-parse','refs/stash']).trim();return f;
}
async function snapshot(dir){const result={};async function walk(folder){for(const e of await fs.readdir(folder,{withFileTypes:true})){const full=path.join(folder,e.name);if(e.isDirectory())await walk(full);else if(e.isFile())result[path.relative(dir,full)]=createHash('sha256').update(await fs.readFile(full)).digest('hex');}}await walk(dir);return result;}
test('empty and uncommitted repository; strict query validation',async t=>{
 const f=await fixture(t);await put(f,'untracked.txt','not committed');assert.deepEqual(await f.graph.graphLog(),{commits:[],branches:[],hasMore:false,head:null});
 for(const limit of [0,-1,2001,1.5,'3',null,NaN,Infinity])await assert.rejects(f.graph.graphLog({limit}));
 for(const input of [null,[],false])await assert.rejects(f.graph.graphLog(input));
 for(const ref of ['--all','main','HEAD','refs/stash','refs/heads/missing','refs/heads/main\0--all'])await assert.rejects(f.graph.graphLog({ref}));
 for(const hash of ['', '--all','HEAD','a'.repeat(39),'a'.repeat(41),'g'.repeat(40),'a'.repeat(40),'a'.repeat(64)])await assert.rejects(f.graph.graphCommit({hash}));
});
test('topological graph includes remote-only and HEAD, excludes stash; limits are prefixes',async t=>{
 const f=await history(t);const all=await f.graph.graphLog();assert.equal(all.head,f.merge);assert.equal(all.hasMore,false);assert.equal(all.commits.length,5);
 assert.ok(all.commits.some(c=>c.hash===f.remote));assert.ok(!all.commits.some(c=>c.hash===f.stash));assert.deepEqual(all.commits.find(c=>c.hash===f.merge).parents,[f.main,f.topic]);assert.deepEqual(all.commits.find(c=>c.hash===f.remote).refs,['refs/remotes/origin/only']);
 assert.ok(all.branches.some(b=>b.ref==='refs/heads/main'&&b.current&&!b.remote&&b.name==='main'));assert.ok(all.branches.some(b=>b.remote&&b.name==='origin/only'));
 const positions=new Map(all.commits.map((c,i)=>[c.hash,i]));for(const c of all.commits)for(const parent of c.parents)assert.ok(positions.get(parent)>positions.get(c.hash));
 for(const limit of [1,2,4,5,6,2000]){const page=await f.graph.graphLog({limit});assert.deepEqual(page.commits,all.commits.slice(0,limit));assert.equal(page.hasMore,all.commits.length>limit);}
 assert.deepEqual((await f.graph.graphLog({ref:'refs/heads/topic'})).commits.map(c=>c.hash),[f.topic,f.root]);assert.deepEqual((await f.graph.graphLog({ref:'refs/remotes/origin/only'})).commits.map(c=>c.hash),[f.remote,f.root]);
 assert.ok(f.calls.some(a=>a.includes('--max-count=2')));assert.ok(f.calls.every(a=>!a.some(v=>v.startsWith('--skip'))));
 git(f.dir,['checkout','--detach',f.remote]);await put(f,'detached.txt','detached\n');const detached=commit(f,'detached');const detachedLog=await f.graph.graphLog();assert.equal(detachedLog.head,detached);assert.ok(detachedLog.commits.some(c=>c.hash===detached));assert.ok(detachedLog.branches.every(b=>!b.current));
});

test('root, normal and merge details use empty tree or first parent',async t=>{
 const f=await history(t);
 const root=await f.graph.graphCommit({hash:f.root});assert.equal(root.comparison.type,'root');assert.equal(root.comparison.base,null);assert.deepEqual(root.parents,[]);assert.equal(root.subject,'root');assert.equal(root.body,'root body\n');assert.deepEqual(root.files,[{status:'A',path:'base.txt'}]);assert.match(root.diff,new RegExp('\\+root'));
 const normal=await f.graph.graphCommit({hash:f.main});assert.deepEqual(normal.parents,[f.root]);assert.equal(normal.comparison.base,f.root);assert.deepEqual(normal.files,[{status:'A',path:'main.txt'}]);assert.equal(normal.author,'Graph Author');assert.equal(Date.parse(normal.date),Date.parse('2024-01-01T12:00:00+00:00'));
 const merge=await f.graph.graphCommit({hash:f.merge});assert.equal(merge.comparison.type,'first-parent');assert.equal(merge.comparison.base,f.main);assert.deepEqual(merge.files,[{status:'A',path:'topic.txt'}]);assert.match(merge.diff,new RegExp('\\+topic'));assert.ok(!merge.diff.includes('diff --git a/main.txt'));
 const tree=git(f.dir,['rev-parse',`${f.root}^{tree}`]).trim();await assert.rejects(f.graph.graphCommit({hash:tree}));git(f.dir,['tag','-a','annotated',f.root,'-m','tag']);const tag=git(f.dir,['rev-parse','annotated']).trim();await assert.rejects(f.graph.graphCommit({hash:tag}));
});
test('rename, deletion, literal magic paths and filtered diffs',async t=>{
 const f=await fixture(t);await put(f,'before.txt','rename content\n');await put(f,'delete.txt','delete content\n');await put(f,'[abc].txt','before\n');await put(f,'a.txt','unrelated\n');commit(f,'root');
 git(f.dir,['mv','before.txt','中文 space.txt']);await fs.rm(path.join(f.dir,'delete.txt'));await put(f,'[abc].txt','literal\n');await put(f,'a.txt','unrelated changed\n');const hash=commit(f,'changes');
 const detail=await f.graph.graphCommit({hash});assert.ok(detail.files.some(f=>f.status==='R100'&&f.oldPath==='before.txt'&&f.path==='中文 space.txt'));assert.ok(detail.files.some(f=>f.status==='D'&&f.path==='delete.txt'));
 const renamed=await f.graph.graphCommit({hash,file:'中文 space.txt'});assert.match(renamed.diff,new RegExp('rename from before.txt'));assert.ok(!renamed.diff.includes('delete content'));
 const deleted=await f.graph.graphCommit({hash,file:'delete.txt'});assert.match(deleted.diff,new RegExp('-delete content'));
 const literal=await f.graph.graphCommit({hash,file:'[abc].txt'});assert.match(literal.diff,new RegExp('\\+literal'));assert.ok(!literal.diff.includes('unrelated changed'));assert.deepEqual(literal.files,detail.files);
 for(const file of ['missing.txt','../secret','--all','before.txt','',null,'a\0b'])await assert.rejects(f.graph.graphCommit({hash,file}));
});
test('NUL-safe tabs, newlines and pathspec magic using index-only fixture',async t=>{
 const f=await fixture(t);const names=['tab\tname.txt','line\nname.txt',':(glob)*.txt','-option.txt','中文 空格.txt'];const blob=git(f.dir,['hash-object','-w','--stdin'],'special\n').trim();
 const index=names.map(name=>`100644 ${blob}\t${name}\0`).join('');git(f.dir,['-c','core.protectNTFS=false','update-index','-z','--index-info'],index);
 const tree=git(f.dir,['write-tree']).trim();const hash=git(f.dir,['commit-tree',tree], 'special\n').trim();git(f.dir,['update-ref','refs/heads/main',hash]);
 const detail=await f.graph.graphCommit({hash});assert.deepEqual(detail.files.map(f=>f.path).sort(),names.sort());
 for(const file of names){const result=await f.graph.graphCommit({hash,file});assert.match(result.diff,new RegExp('\\+special'));assert.equal(result.diff.split('diff --git ').length-1,1);}
});
test('queries preserve repository bytes and disable external diff and textconv',async t=>{
 const f=await history(t);git(f.dir,['config','diff.external','graph-test-must-not-execute']);git(f.dir,['config','diff.guard.textconv','graph-test-must-not-execute']);await put(f,'.gitattributes','*.txt diff=guard\n');
 const before=await snapshot(f.dir);const all=await f.graph.graphLog();for(const c of all.commits){const detail=await f.graph.graphCommit({hash:c.hash});for(const file of detail.files)await f.graph.graphCommit({hash:c.hash,file:file.path});}assert.deepEqual(await snapshot(f.dir),before);
 for(const args of f.calls.filter(a=>a[0]==='diff-tree')){assert.ok(args.includes('--no-ext-diff'));assert.ok(args.includes('--no-textconv'));}
});
test('SHA256 repositories when supported by installed Git',async t=>{
 let sha;try{sha=await fixture(t,'sha256');}catch{t.skip('Installed Git does not support SHA256');return;}
 await put(sha,'file.txt','sha256\n');const hash=commit(sha,'sha256');assert.equal(hash.length,64);assert.equal((await sha.graph.graphLog()).commits[0].hash,hash);assert.equal((await sha.graph.graphCommit({hash})).hash,hash);
});

test('IPC captures repo across a switch; preload exports graph APIs',async()=>{
 const vm=require('node:vm');const handlers=new Map();let ready;let exposed;
 class Window {
  constructor(){this.webContents={mainFrame:{},setWindowOpenHandler(){},on(){},send(){},isDestroyed(){return false;}};}
  setMenuBarVisibility(){} on(){} async loadFile(){} isDestroyed(){return false;}
 }
 class Terminal {dispose(){}}
 const electron={app:{whenReady:()=>({then:fn=>{ready=fn();}}),getPath:()=>os.tmpdir(),on(){}},BrowserWindow:Window,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},dialog:{},shell:{},Menu:{setApplicationMenu(){},buildFromTemplate(){}}};
 const mocks={electron,'node:fs/promises':{readFile:async()=> '[]'},'node:path':path,'./git-service':{GitService},'./graph-service':{GraphService},'./project-service':{},'./config-service':{},'./terminal-service':{TerminalService:Terminal},'./terminal-clipboard':{registerTerminalClipboard(){}},'./repo-watcher':{RepositoryWatcher:class{}}};
 const context=vm.createContext({require:name=>{assert.ok(name in mocks,name);return mocks[name];},process:{platform:'win32'},console,__dirname:path.join(__dirname,'..','src','main')});
 vm.runInContext(await fs.readFile(path.join(__dirname,'..','src','main','index.js'),'utf8'),context);await ready;
 let release;const gate=new Promise(resolve=>{release=resolve;});const calls=[];
 context.old={repo:'old',git:async args=>{calls.push(args);if(args[0]==='for-each-ref')await gate;return '';}};
 context.next={repo:'new',git:async()=>{throw Error('Cross-session query');}};
 vm.runInContext('service=old',context);const win=vm.runInContext('win',context);
 const result=handlers.get('graphLog')({sender:win.webContents,senderFrame:win.webContents.mainFrame},{});
 vm.runInContext('service=next',context);release();assert.equal((await result).ok,true);assert.equal(calls.length,3);assert.ok(handlers.has('graphCommit'));
 const invocations=[];
 const preload=vm.createContext({require:()=>({contextBridge:{exposeInMainWorld:(name,api)=>{assert.equal(name,'gitdesk');exposed=api;}},ipcRenderer:{invoke:async(...args)=>{invocations.push(args);return {ok:true,data:'response'};}}})});
 vm.runInContext(await fs.readFile(path.join(__dirname,'..','src','preload','index.js'),'utf8'),preload);
 assert.equal(await exposed.graphLog({limit:1}),'response');assert.equal(await exposed.graphCommit({hash:'abc'}),'response');assert.deepEqual(invocations.map(a=>a[0]),['graphLog','graphCommit']);
});

// Distinct tips matter: aliases of one commit would be deduplicated by the old code.
test('1000 distinct branch tips use a bounded command line with paging and filtering',async t=>{
 const f=await fixture(t);await put(f,'root.txt','root\n');const root=commit(f,'root');
 const commands=[];
 for(let i=0;i<1000;i++)commands.push(`commit refs/remotes/origin/load-${i}\ncommitter Graph Author <graph@example.invalid> ${1704110400+i} +0000\ndata ${Buffer.byteLength('load-'+i)}\nload-${i}\nfrom ${root}\n\n`);
 git(f.dir,['fast-import','--quiet'],commands.join('')+'done\n');
 const before=git(f.dir,['show-ref']);
 const first=await f.graph.graphLog({limit:300});assert.equal(first.commits.length,300);assert.equal(first.hasMore,true);assert.equal(first.branches.length,1001);
 const all=await f.graph.graphLog({limit:2000});assert.equal(all.commits.length,1001);assert.equal(all.hasMore,false);
 const filtered=await f.graph.graphLog({ref:'refs/remotes/origin/load-999'});assert.equal(filtered.commits.length,2);assert.equal(filtered.commits[0].subject,'load-999');
 for(const args of f.calls.filter(a=>a[0]==='log'))assert.ok(args.join(' ').length<1000,'command length must not scale with branch count');
 assert.equal(git(f.dir,['show-ref']),before);
});
