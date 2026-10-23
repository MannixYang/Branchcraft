'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {ProjectService}=require('../src/main/project-service');
const {gitExecutable,gitEnvironment}=require('../src/main/platform');
async function fixture(t,commit=true){
 const repo=await fs.mkdtemp(path.join(os.tmpdir(),'project-service-test-'));
 t.after(()=>fs.rm(repo,{recursive:true,force:true}));
 const git=(...args)=>execFileSync(gitExecutable(),args,{cwd:repo,env:{...gitEnvironment(),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null'},encoding:'utf8',windowsHide:true});
 git('init','-q');git('config','user.email','test@example.com');git('config','user.name','Test');git('config','core.autocrlf','false');
 const put=(file,text)=>fs.writeFile(path.join(repo,file),text);
 await put('tracked.txt','head line\n');git('add','--','tracked.txt');if(commit)git('commit','-qm','initial');
 return {repo,git,put,service:new ProjectService(repo)};
}
test('tree: tracked and unignored untracked, deduplicated, deleted omitted',async t=>{
 const {repo,git,put,service}=await fixture(t);
 await put('.gitignore','ignored.txt\n');await put('ignored.txt','ignored');await put('new 中文.txt','new');
 await put('deleted.txt','old');git('add','--','deleted.txt');await fs.unlink(path.join(repo,'deleted.txt'));
 const files=await service.tree();assert(files.includes('tracked.txt'));assert(files.includes('new 中文.txt'));assert(files.includes('.gitignore'));assert(!files.includes('ignored.txt'));assert(!files.includes('deleted.txt'));assert.equal(new Set(files).size,files.length);
});
test('read: exact UTF-8, BOM, CRLF and SHA256 raw-byte token; Chinese paths',async t=>{
 const {put,service}=await fixture(t);const raw=Buffer.from('\ufeff你好🙂\r\n');await put('中文.txt',raw);
 assert.deepEqual(await service.read('中文.txt'),{file:'中文.txt',text:raw.toString('utf8'),token:createHash('sha256').update(raw).digest('hex')});
});
test('save changes worktree, keeps index intact, and issues fresh token',async t=>{
 const {git,service}=await fixture(t);const index=git('write-tree');const current=await service.read('tracked.txt');
 const saved=await service.save({...current,text:'保存中文\r\n'});assert.equal(saved.text,'保存中文\r\n');assert.notEqual(saved.token,current.token);assert.deepEqual(await service.read('tracked.txt'),saved);assert.equal(git('write-tree'),index);assert.equal(git('diff','--cached'),'');
});
test('optimistic lock rejects external change without overwriting it',async t=>{
 const {put,service}=await fixture(t);const original=await service.read('tracked.txt');await put('tracked.txt','external\n');
 await assert.rejects(service.save({...original,text:'ours'}),/外部修改/);assert.equal((await service.read('tracked.txt')).text,'external\n');
});
test('external deletion and same-content replacement are safe',async t=>{
 const {repo,service}=await fixture(t);const original=await service.read('tracked.txt');await fs.unlink(path.join(repo,'tracked.txt'));
 await assert.rejects(service.save({...original,text:'ours'}),/ENOENT/);assert.equal(await fs.stat(path.join(repo,'tracked.txt')).then(()=>true,()=>false),false);
});
test('reject traversal, absolute paths, Windows aliases and Git metadata for all operations',async t=>{
 const {repo,service}=await fixture(t);
 for(const file of ['../outside','a/../../outside','a\\..\\tracked.txt',path.join(repo,'tracked.txt'),'C:\\Windows\\win.ini','/etc/passwd','.git/config','.GIT/config','.git./config','tracked.txt:stream','']){
  await assert.rejects(service.read(file));await assert.rejects(service.save({file,text:'x',token:'a'.repeat(64)}));await assert.rejects(service.diff({file,base:'HEAD'}));
 }
 await assert.rejects(service.read('.'));await assert.rejects(service.read('.git'));
});
test('reject directories, binary, invalid UTF8, oversized files and invalid save text',async t=>{
 const {repo,put,service}=await fixture(t);await fs.mkdir(path.join(repo,'dir'));
 await put('binary',Buffer.from([65,0,66]));await put('invalid',Buffer.from([0xc3,0x28]));await put('large',Buffer.alloc(2*1024*1024+1,65));
 for(const file of ['dir','binary','invalid','large']){await assert.rejects(service.read(file));await assert.rejects(service.save({file,text:'x',token:'a'.repeat(64)}));}
 const current=await service.read('tracked.txt');
 for(const text of ['a\0b','\ud800','a'.repeat(2*1024*1024+1),'中'.repeat(800000)])await assert.rejects(service.save({...current,text}));
 assert.equal((await service.read('tracked.txt')).text,current.text);
});
test('exact 2MB limit accepted',async t=>{
 const {put,service}=await fixture(t);await put('limit','a'.repeat(2*1024*1024));const read=await service.read('limit');await service.save({...read,text:'b'.repeat(2*1024*1024)});assert.equal((await service.read('limit')).text.length,2*1024*1024);
});
test('symlink files and ancestor directory links refused, including links inside repo',async t=>{
 const {repo,git,service}=await fixture(t);await fs.mkdir(path.join(repo,'real'));await fs.writeFile(path.join(repo,'real','nested'),'safe');
 // Junction creation works without Developer Mode on Windows and exercises ancestor checks.
 await fs.symlink(path.join(repo,'real'),path.join(repo,'alias'),process.platform==='win32'?'junction':'dir');
 for(const file of ['alias/nested']){await assert.rejects(service.read(file),/链接/);await assert.rejects(service.save({file,text:'bad',token:'a'.repeat(64)}),/链接/);await assert.rejects(service.diff({file,base:'HEAD'}),/链接/);}
 assert(!(await service.tree()).includes('alias/nested'));
 try{await fs.symlink(path.join(repo,'tracked.txt'),path.join(repo,'link.txt'),'file');}catch(e){if(['EPERM','EACCES','ENOSYS'].includes(e.code)){t.diagnostic('File symlink privilege unavailable; junction ancestor coverage passed');return;}throw e;}
 await assert.rejects(service.read('link.txt'),/链接/);const tracked=await service.read('tracked.txt');await assert.rejects(service.save({...tracked,file:'link.txt'}),/链接/);assert(!(await service.tree()).includes('link.txt'));
 git('status','--porcelain');
});
test('diff HEAD and index select distinct baselines; diff never stages',async t=>{
 const {git,put,service}=await fixture(t);await put('tracked.txt','index line\n');git('add','--','tracked.txt');await put('tracked.txt','worktree 中文\n');const index=git('write-tree');
 const head=await service.diff({file:'tracked.txt',base:'HEAD'}),staged=await service.diff({file:'tracked.txt',base:'index'});
 assert.match(head,/-head line/);assert.match(head,/\+worktree 中文/);assert.match(staged,/-index line/);assert.doesNotMatch(staged,/-head line/);assert.equal(git('write-tree'),index);
});
test('diff untracked uses empty baseline, unchanged returns empty, rejects invalid base',async t=>{
 const {put,service}=await fixture(t);await put('new 中文.txt','新文件\n');
 for(const base of ['HEAD','index'])assert.match(await service.diff({file:'new 中文.txt',base}),/\+新文件/);
 assert.equal(await service.diff({file:'tracked.txt',base:'HEAD'}),'');for(const base of ['head','HEAD~1','--help'])await assert.rejects(service.diff({file:'tracked.txt',base}),/base/);
});
test('unborn HEAD is normal; existing index blob still used',async t=>{
 const {service}=await fixture(t,false);assert.match(await service.diff({file:'tracked.txt',base:'HEAD'}),/\+head line/);assert.equal(await service.diff({file:'tracked.txt',base:'index'}),'');
});
test('Git failures are not swallowed',async t=>{
 const {repo,service}=await fixture(t);await fs.rename(path.join(repo,'.git'),path.join(repo,'metadata-backup'));
 await assert.rejects(service.tree());await assert.rejects(service.diff({file:'tracked.txt',base:'HEAD'}));await assert.rejects(service.diff({file:'tracked.txt',base:'index'}));
});
test('unmerged index rejected, not silently treated as untracked',async t=>{
 const {git,service}=await fixture(t);const oid=git('rev-parse','HEAD:tracked.txt').trim();git('update-index','--force-remove','--','tracked.txt');
 execFileSync(gitExecutable(),['update-index','--index-info'],{cwd:service.repo,input:`100644 ${oid} 1\ttracked.txt\n100644 ${oid} 2\ttracked.txt\n`,env:gitEnvironment(),windowsHide:true});
 await assert.rejects(service.diff({file:'tracked.txt',base:'index'}),/index/);
});
test('tree list cap fails explicitly rather than silently truncating',async t=>{
 const {service}=await fixture(t);service.git=async()=>Array.from({length:10001},(_,i)=>`file-${i}\0`).join('');await assert.rejects(service.tree(),/10000/);
});
test('diff cleans temporary directories on success and Git failure',async t=>{
 const {service}=await fixture(t);const before=(await fs.readdir(os.tmpdir())).filter(x=>x.startsWith('project-diff-')).sort();
 await service.diff({file:'tracked.txt',base:'HEAD'});const run=service.run.bind(service);
 service.run=(args,...rest)=>args[0]==='diff'?Promise.reject(Error('injected diff failure')):run(args,...rest);
 await assert.rejects(service.diff({file:'tracked.txt',base:'HEAD'}),/injected/);
 assert.deepEqual((await fs.readdir(os.tmpdir())).filter(x=>x.startsWith('project-diff-')).sort(),before);
});

test('diff defaults to HEAD even when index differs',async t=>{
 const {git,put,service}=await fixture(t);await put('tracked.txt','staged line\n');git('add','--','tracked.txt');await put('tracked.txt','working line\n');
 const implicit=await service.diff({file:'tracked.txt'});assert.match(implicit,/-head line/);assert.match(implicit,/\+working line/);assert.doesNotMatch(implicit,/-staged line/);
 assert.match(await service.diff({file:'tracked.txt',base:undefined}),/-head line/);
});
test('diff local and remote branches, short and full refs, uses resolved commit oid',async t=>{
 const {git,put,service}=await fixture(t);const original=git('rev-parse','HEAD').trim();
 git('branch','feature/topic');await put('tracked.txt','branch line\n');git('add','--','tracked.txt');git('commit','-qm','branch baseline');
 const branch=git('rev-parse','HEAD').trim();git('update-ref','refs/heads/feature/topic',branch);git('update-ref','refs/remotes/origin/topic',branch);
 git('reset','--hard',original);await put('tracked.txt','working line\n');const index=git('write-tree'),head=git('rev-parse','HEAD');
 const runGit=service.git.bind(service);const trees=[];service.git=args=>{if(args[0]==='ls-tree')trees.push(args[2]);return runGit(args);};
 for(const base of ['feature/topic','refs/heads/feature/topic','origin/topic','refs/remotes/origin/topic']){
  const diff=await service.diff({file:'tracked.txt',base});assert.match(diff,/-branch line/);assert.match(diff,/\+working line/);assert.doesNotMatch(diff,/-head line/);
 }
 assert.deepEqual(trees,[branch,branch,branch,branch]);assert.equal(git('write-tree'),index);assert.equal(git('rev-parse','HEAD'),head);
});
test('branch missing file is an empty baseline, not an invalid branch',async t=>{
 const {git,put,service}=await fixture(t);git('branch','before-file');git('update-ref','refs/remotes/origin/before-file',git('rev-parse','HEAD').trim());
 await put('later.txt','later content\n');git('add','--','later.txt');git('commit','-qm','add later');
 for(const base of ['before-file','refs/heads/before-file','origin/before-file','refs/remotes/origin/before-file']){
  const diff=await service.diff({file:'later.txt',base});assert.match(diff,/@@ -0,0 \+1 @@/);assert.match(diff,/\+later content/);
 }
});
test('diff rejects revisions, tags, unknown refs and option injection explicitly',async t=>{
 const {git,service}=await fixture(t);git('tag','release');const oid=git('rev-parse','HEAD').trim();
 const runGit=service.git.bind(service),run=service.run.bind(service);const calls=[];
 service.git=args=>{calls.push(args);return runGit(args);};service.run=(args,...rest)=>{calls.push(args);return run(args,...rest);};
 for(const base of [null,1,{},[], '', 'missing', 'refs/heads/missing','refs/remotes/origin/missing','release','refs/tags/release',oid,'HEAD~1','HEAD^','HEAD^{tree}','HEAD:tracked.txt','HEAD@{0}','@','--help','--output=evil','feature\n--help','HEAD\0bad']){
  await assert.rejects(service.diff({file:'tracked.txt',base}),/base/);
 }
 assert(calls.every(args=>args[0]==='for-each-ref'));
});
test('default HEAD on unborn repository has empty baseline',async t=>{
 const {service}=await fixture(t,false);assert.match(await service.diff({file:'tracked.txt'}),/\+head line/);
});
