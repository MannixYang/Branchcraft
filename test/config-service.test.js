'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {ConfigService,LIMITS,WARNING}=require('../src/main/config-service');
async function fixture(t,{empty=false,natural=false}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'config-service-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
 const home=path.join(root,'home'),repo=path.join(root,'repo'),other=path.join(root,'other');
 await Promise.all([home,repo,other].map(p=>fs.mkdir(p,{recursive:true})));const global=path.join(home,'.gitconfig');
 const env={...process.env,HOME:home,USERPROFILE:home,XDG_CONFIG_HOME:path.join(home,'xdg'),GIT_CONFIG_GLOBAL:global,GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'};
 for(const k of Object.keys(env))if(/^GIT_(?:DIR|WORK_TREE|COMMON_DIR|CONFIG|CONFIG_COUNT|CONFIG_PARAMETERS|CONFIG_KEY_\d+|CONFIG_VALUE_\d+)$/i.test(k))delete env[k];
 if(natural)delete env.GIT_CONFIG_GLOBAL;
 const git=(dir,...args)=>execFileSync('git',args,{cwd:dir,env,encoding:'utf8',windowsHide:true,timeout:10000,stdio:['ignore','pipe','pipe']});
 git(repo,'init','-q');git(other,'init','-q');if(!empty)await fs.writeFile(global,'');
 return {root,home,repo,other,global,env,git,s:new ConfigService(repo,{env}),second:new ConfigService(other,{env})};
}
const values=async(s,scope,key)=>(await s.list(scope)).find(e=>e.key===key)?.values||[];
const code=c=>e=>e.code===c;
test('local/global 增改删、作用域隔离、精确值与警告',async t=>{
 const f=await fixture(t);const {s,second}=f;
 for(const scope of ['local','global']){
  assert.equal((await s.set({scope,key:'user.name',value:'中文 用户',expected:[]})).warning,WARNING);
  assert.deepEqual(await values(s,scope,'user.name'),['中文 用户']);
  assert.deepEqual(await values(second,scope,'user.name'),scope==='local'?[]:['中文 用户']);
  await s.set({scope,key:'USER.Name',value:'line1\nline2 = ; # "',expected:['中文 用户']});
  assert.deepEqual(await values(s,scope,'user.name'),['line1\nline2 = ; # "']);
  await s.unset({scope,key:'user.name',expected:['line1\nline2 = ; # "']});
  assert.deepEqual(await values(s,scope,'user.name'),[]);await s.unset({scope,key:'user.name',expected:[]});
 }
 await s.set({scope:'local',key:'user.email',value:'local@invalid',expected:[]});
 await s.set({scope:'global',key:'user.email',value:'global@invalid',expected:[]});
 await s.unset({scope:'global',key:'user.email',expected:['global@invalid']});
 assert.deepEqual(await values(s,'local','user.email'),['local@invalid']);
});
test('重复及不同多值可显示、精确 CAS、禁止覆盖和删除',async t=>{
 const f=await fixture(t);
 for(const scope of ['local','global'])for(const pair of [['a','b'],['same','same']]){
  for(const v of pair)f.git(f.repo,'config',`--${scope}`,'--add','demo.multi',v);
  const e=(await f.s.list(scope)).find(e=>e.key==='demo.multi');assert.deepEqual(e.values,pair);assert.equal(e.editable,false);assert.match(e.reason,/多值/);
  await assert.rejects(f.s.set({scope,key:'demo.multi',value:'x',expected:[pair[0]]}),code('CAS_MISMATCH'));
  for(const method of ['set','unset'])await assert.rejects(f.s[method]({scope,key:'demo.multi',value:'x',expected:pair}),code('MULTI_VALUE'));
  assert.deepEqual(await values(f.s,scope,'demo.multi'),pair);f.git(f.repo,'config',`--${scope}`,'--unset-all','demo.multi');
 }
});
test('显式 expected、外部更新、缺项 CAS',async t=>{
 const f=await fixture(t);
 for(const scope of ['local','global']){
  for(const m of ['set','unset'])await assert.rejects(f.s[m]({scope,key:'demo.cas',value:'x'}),code('EXPECTED_REQUIRED'));
  await f.s.set({scope,key:'demo.cas',value:'old',expected:[]});f.git(f.repo,'config',`--${scope}`,'demo.cas','external');
  for(const m of ['set','unset'])await assert.rejects(f.s[m]({scope,key:'demo.cas',value:'mine',expected:['old']}),code('CAS_MISMATCH'));
  assert.deepEqual(await values(f.s,scope,'demo.cas'),['external']);
  await assert.rejects(f.s.set({scope,key:'demo.cas',value:'mine',expected:[]}),code('CAS_MISMATCH'));
  await assert.rejects(f.s.unset({scope,key:'demo.missing',expected:['x']}),code('CAS_MISMATCH'));
 }
});
test('scope、键和值校验及选项、shell 注入保持字面量',async t=>{
 const f=await fixture(t);
 for(const scope of ['',undefined,'system','--global','LOCAL',{},null]){
  await assert.rejects(f.s.list(scope),code('INVALID_SCOPE'));
  for(const m of ['set','unset'])await assert.rejects(f.s[m]({scope,key:'user.name',value:'x',expected:[]}),code('INVALID_SCOPE'));
 }
 for(const key of ['',null,'--global','-c','a','a..b','a.b\0x','a.b\nx','1a.name','a.1name','a.b;whoami','a.'+'b'.repeat(513)])await assert.rejects(f.s.set({scope:'local',key,value:'x',expected:[]}),code('INVALID_KEY'));
 for(const value of [null,1,'a\0b','x'.repeat(LIMITS.value+1)])await assert.rejects(f.s.set({scope:'local',key:'demo.value',value,expected:[]}),code('INVALID_VALUE'));
 const marker=path.join(f.root,'NEVER-CREATE'),dangerous=`--global; echo pwned > "${marker}" & $(whoami) | cmd.exe`;
 await f.s.set({scope:'local',key:'alias.evil',value:dangerous,expected:[]});assert.deepEqual(await values(f.s,'local','alias.evil'),[dangerous]);
 await f.s.set({scope:'local',key:'core.hooksPath',value:marker,expected:[]});await f.s.list('local');await assert.rejects(fs.access(marker),{code:'ENOENT'});
 for(const v of ['--unset-all','-c','', 'a\nb']){await f.s.set({scope:'global',key:'demo.literal',value:v,expected:await values(f.s,'global','demo.literal')});assert.deepEqual(await values(f.s,'global','demo.literal'),[v]);}
});
test('include 和 includeIf 不展开、不写源文件，子节大小写保留',async t=>{
 const f=await fixture(t),included=path.join(f.root,'included');
 await fs.writeFile(included,'[demo]\n secret = only-in-include\n');const original=await fs.readFile(included);
 for(const scope of ['local','global']){
  f.git(f.repo,'config',`--${scope}`,'include.path',included);f.git(f.repo,'config',`--${scope}`,'includeIf.gitdir:*.path',included);
  assert.deepEqual(await values(f.s,scope,'demo.secret'),[]);assert.deepEqual(await values(f.s,scope,'include.path'),[included]);
  await f.s.set({scope,key:'demo.secret',value:'direct',expected:[]});await f.s.unset({scope,key:'demo.secret',expected:['direct']});
  await f.s.set({scope,key:'remote.Mixed.url',value:'https:example.invalid',expected:[]});
  assert.deepEqual(await values(f.s,scope,'remote.Mixed.url'),['https:example.invalid']);assert.deepEqual(await values(f.s,scope,'remote.mixed.url'),[]);
 }assert.deepEqual(await fs.readFile(included),original);
});
test('实际 Git 锁、并发 CAS、锁后读取并保护其他配置',async t=>{
 const f=await fixture(t),file=path.join(f.repo,'.git','config'),lock=file+'.lock';
 await fs.writeFile(lock,'foreign-lock');await assert.rejects(f.s.set({scope:'local',key:'demo.race',value:'x',expected:[]}),code('CONFIG_BUSY'));
 assert.equal(await fs.readFile(lock,'utf8'),'foreign-lock');await fs.rm(lock);
 const second=new ConfigService(f.repo,{env:f.env});
 const results=await Promise.allSettled([f.s.set({scope:'local',key:'demo.race',value:'a',expected:[]}),second.set({scope:'local',key:'demo.race',value:'b',expected:[]})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.ok(['CONFIG_BUSY','CAS_MISMATCH'].includes(results.find(r=>r.status==='rejected').reason.code));await assert.rejects(fs.access(lock),{code:'ENOENT'});
 const service=new ConfigService(f.repo,{env:f.env}),original=service.git.bind(service);let checked=false;
 service.git=async args=>{if(args[0]==='config'&&args.includes('--list')&&!checked){checked=true;assert.equal(await fs.readFile(lock,'utf8'),'');assert.throws(()=>f.git(f.repo,'config','demo.external','blocked'));}return original(args);};
 await service.set({scope:'local',key:'demo.safe',value:'yes',expected:[]});assert.equal(checked,true);assert.equal(f.git(f.repo,'config','--local','core.repositoryformatversion').trim(),'0');
});
test('绕过锁的外部更新在发布前检测且保留，不遗留锁',async t=>{
 const f=await fixture(t),file=path.join(f.repo,'.git','config'),original=f.s.git.bind(f.s);
 f.s.git=async args=>{const out=await original(args);if(args.includes('--replace-all'))await fs.appendFile(file,'\n[demo]\n outside = preserved\n');return out;};
 await assert.rejects(f.s.set({scope:'local',key:'demo.mine',value:'x',expected:[]}),code('CAS_MISMATCH'));
 assert.deepEqual(await values(f.s,'local','demo.outside'),['preserved']);assert.deepEqual(await values(f.s,'local','demo.mine'),[]);await assert.rejects(fs.access(file+'.lock'),{code:'ENOENT'});
});
test('不存在的 global 文件可新增，环境完全隔离',async t=>{
 const f=await fixture(t,{empty:true});assert.deepEqual(await f.s.list('global'),[]);
 await f.s.set({scope:'global',key:'user.name',value:'isolated',expected:[]});assert.deepEqual(await values(f.s,'global','user.name'),['isolated']);
 assert.match(await fs.readFile(f.global,'utf8'),/isolated/);assert.equal(f.s.env.HOME,f.home);assert.equal(f.s.env.GIT_CONFIG_GLOBAL,f.global);
});
test('长度、条数限制和格式错误失败且清理锁',async t=>{
 const f=await fixture(t);
 await fs.writeFile(f.global,'[demo]\n value = '+'x'.repeat(LIMITS.value+1)+'\n');await assert.rejects(f.s.list('global'),code('LIMIT'));
 await fs.writeFile(f.global,'[demo]\n'+' value = x\n'.repeat(LIMITS.entries+1));await assert.rejects(f.s.list('global'),code('LIMIT'));
 await fs.writeFile(f.global,'#'+'x'.repeat(LIMITS.file+1));await assert.rejects(f.s.set({scope:'global',key:'demo.x',value:'x',expected:[]}),code('LIMIT'));
 await fs.writeFile(f.global,'[bad\n');await assert.rejects(f.s.set({scope:'global',key:'demo.x',value:'x',expected:[]}),code('GIT_ERROR'));await assert.rejects(fs.access(f.global+'.lock'),{code:'ENOENT'});
});
test('继承环境不能重定向 local 或注入 command-scope 值',async t=>{
 const f=await fixture(t),s=new ConfigService(f.repo,{env:{...f.env,GIT_DIR:path.join(f.other,'.git'),GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'demo.injected',GIT_CONFIG_VALUE_0:'bad',GIT_CONFIG_PARAMETERS:"'demo.param=bad'"}});
 assert.deepEqual(await values(s,'local','demo.injected'),[]);await s.set({scope:'local',key:'demo.correct',value:'yes',expected:[]});assert.deepEqual(await values(f.s,'local','demo.correct'),['yes']);assert.deepEqual(await values(f.second,'local','demo.correct'),[]);
});
test('XDG 和 home 双 global 源：原键原源编辑、新键优先 home、多值拒绝',async t=>{
 const f=await fixture(t,{natural:true});const xdg=path.join(f.env.XDG_CONFIG_HOME,'git','config');await fs.mkdir(path.dirname(xdg),{recursive:true});
 await fs.writeFile(xdg,'# xdg retained\n[demo]\n xdg = old\n duplicate = same\n');
 await fs.writeFile(f.global,'# home retained\n[demo]\n home = old\n duplicate = same\n');
 assert.deepEqual(await values(f.s,'global','demo.xdg'),['old']);
 await f.s.set({scope:'global',key:'demo.xdg',value:'updated',expected:['old']});assert.deepEqual(await values(f.s,'global','demo.xdg'),['updated']);
 assert.match(await fs.readFile(xdg,'utf8'),/updated/);assert.doesNotMatch(await fs.readFile(f.global,'utf8'),/updated/);
 await f.s.unset({scope:'global',key:'demo.xdg',expected:['updated']});assert.deepEqual(await values(f.s,'global','demo.xdg'),[]);
 await f.s.set({scope:'global',key:'demo.new',value:'home-only',expected:[]});assert.match(await fs.readFile(f.global,'utf8'),/home-only/);assert.doesNotMatch(await fs.readFile(xdg,'utf8'),/home-only/);
 await assert.rejects(f.s.set({scope:'global',key:'demo.duplicate',value:'bad',expected:['same','same']}),code('MULTI_VALUE'));
 await assert.rejects(f.s.unset({scope:'global',key:'demo.duplicate',expected:['same','same']}),code('MULTI_VALUE'));
 assert.match(await fs.readFile(xdg,'utf8'),/# xdg retained/);assert.match(await fs.readFile(f.global,'utf8'),/# home retained/);
 for(const file of [xdg,f.global])await assert.rejects(fs.access(file+'.lock'),{code:'ENOENT'});
});
test('只有 XDG 时新键写 XDG；全局次级源锁冲突不遗留已取得的锁',async t=>{
 const f=await fixture(t,{natural:true,empty:true});const xdg=path.join(f.env.XDG_CONFIG_HOME,'git','config');await fs.mkdir(path.dirname(xdg),{recursive:true});await fs.writeFile(xdg,'');
 await f.s.set({scope:'global',key:'demo.xdg',value:'yes',expected:[]});assert.match(await fs.readFile(xdg,'utf8'),/yes/);await assert.rejects(fs.access(f.global),{code:'ENOENT'});
 const files=(await f.s.paths('global')).sort();await fs.writeFile(files[1]+'.lock','foreign');
 await assert.rejects(f.s.set({scope:'global',key:'demo.xdg',value:'bad',expected:['yes']}),code('CONFIG_BUSY'));
 await assert.rejects(fs.access(files[0]+'.lock'),{code:'ENOENT'});assert.equal(await fs.readFile(files[1]+'.lock','utf8'),'foreign');
});
test('global 文件 symlink 只读，目标不修改',async t=>{
 const f=await fixture(t),target=path.join(f.root,'target');await fs.writeFile(target,'[demo]\n safe = original\n');await fs.rm(f.global);
 try{await fs.symlink(target,f.global,'file');}catch(e){if(['EPERM','EACCES','ENOTSUP'].includes(e.code)){t.skip('Windows 未启用符号链接权限');return;}throw e;}
 assert.deepEqual(await values(f.s,'global','demo.safe'),['original']);
 await assert.rejects(f.s.set({scope:'global',key:'demo.safe',value:'bad',expected:['original']}),code('UNSAFE_FILE'));
 assert.equal(await fs.readFile(target,'utf8'),'[demo]\n safe = original\n');await assert.rejects(fs.access(f.global+'.lock'),{code:'ENOENT'});
});
test('Git 输出超限被拒绝，不截断后继续写',async t=>{
 const f=await fixture(t);await fs.writeFile(f.global,'[demo]\n'+(' value = '+'x'.repeat(300)+'\n').repeat(4000));
 await assert.rejects(f.s.list('global'),code('GIT_ERROR'));
});