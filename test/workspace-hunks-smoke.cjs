'use strict';
const {_electron:electron}=require('playwright-core');
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('node:assert/strict'),{execFileSync:run}=require('child_process');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bc-hunks-')),repo=path.join(root,'repo');fs.mkdirSync(repo);
 const git=(...args)=>run('git',['-C',repo,...args],{encoding:'utf8',stdio:'pipe'});
 const file='src/nested/code.txt',target=path.join(repo,file),base=Array.from({length:40},(_,i)=>`line ${i+1}`).join('\n')+'\n';
 const changed=base.replace('line 3\n','changed FIRST\n').replace('line 32\n','changed SECOND\n');let app;
 try{
  git('init');git('config','user.name','Hunk Test');git('config','user.email','test@example.com');git('config','core.autocrlf','false');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,base);git('add','.');git('commit','-m','fixture');
  git('config','diff.context','8');git('config','diff.noprefix','true');fs.writeFileSync(target,changed);fs.writeFileSync(path.join(repo,'new.txt'),'new file\n');
  delete process.env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({executablePath:process.env.BRANCHCRAFT_EXE||require('electron'),args:[...(process.env.BRANCHCRAFT_EXE?[]:[path.resolve(__dirname,'..')]),'--user-data-dir='+path.join(root,'profile')]});
  await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},repo);
  const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(12000);page.setDefaultNavigationTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>typeof choose==='function');await page.evaluate(()=>choose());
  const bulk=name=>page.locator('#listActions').getByRole('button',{name,exact:true});
  await bulk('全部折叠').click();assert.equal(await page.locator('.folder-toggle[aria-expanded="true"]').count(),0);assert.equal(await page.locator(`.item[title="${file}"]`).count(),0);
  await page.fill('#search','code.txt');await bulk('全部展开').click();assert.equal(await page.locator('.folder-toggle[aria-expanded="true"]').count(),2);await page.fill('#search','');
  const folder=page.locator('.folder-toggle[data-folder="worktree:src/"]');await folder.click();assert.equal(await folder.getAttribute('aria-expanded'),'false');await folder.focus();await page.keyboard.press('Enter');assert.equal(await folder.getAttribute('aria-expanded'),'true');
  const open=async kind=>{await page.evaluate(async({file,kind})=>{const f=state.files.find(f=>f.path===file);await selectFile(f,kind,kind+':'+file);},{file,kind});};
  const action=(type,n=0)=>page.locator(`.hunk-action[data-action="${type}"][data-hunk="${n}"]`);
  console.log('已打开测试仓库');
  const idle=()=>page.waitForFunction(()=>!loading&&!document.querySelector('#modal').open);
  await open('worktree');assert.equal(await page.locator('[data-action="stage"]').count(),2);assert.equal(await page.locator('[data-action="restore"]').count(),2);
  const buttonBox=await action('stage').boundingBox(),numberBox=await page.locator('.diff-line.hunk .line-num').first().boundingBox();assert(buttonBox.width>=35&&buttonBox.x+buttonBox.width<=numberBox.x,'action must be visible before line numbers');
  console.log('暂存块');await action('stage').click();await idle();assert.equal(fs.readFileSync(target,'utf8'),changed);assert.equal(git('show',':'+file),base.replace('line 3\n','changed FIRST\n'));
  console.log('读取已暂存');await open('staged');assert.equal(await page.locator('[data-action="unstage"]').count(),1);assert.equal(await page.locator('[data-action="restore"]').count(),0);await action('unstage').click();await idle();assert.equal(git('show',':'+file),base);assert.equal(fs.readFileSync(target,'utf8'),changed);
  await open('worktree');console.log('暂存块');await action('stage').click();await idle();await open('worktree');assert.equal(await page.locator('[data-action="restore"]').count(),1);
  await action('restore').click();await page.locator('#modal[open]').waitFor();await page.click('#modalCancel');assert.equal(fs.readFileSync(target,'utf8'),changed);
  await action('restore').click();await page.click('#modalConfirm');await idle();const firstOnly=base.replace('line 3\n','changed FIRST\n');assert.equal(fs.readFileSync(target,'utf8'),firstOnly);assert.equal(git('show',':'+file),firstOnly);
  console.log('读取已暂存');await open('staged');fs.appendFileSync(target,'external edit\n');await action('unstage').click();await idle();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('变化'));assert.equal(git('show',':'+file),firstOnly);assert.equal(fs.readFileSync(target,'utf8'),firstOnly+'external edit\n');
  await page.evaluate(()=>refresh());await page.locator('.item[title="new.txt"]').click();await page.waitForFunction(()=>document.querySelector('#detailBody').textContent.includes('代码块操作不可用'));assert.equal(await page.locator('[data-action="stage"]').count(),0);await page.locator('#detailActions').getByRole('button',{name:'＋ 暂存文件',exact:true}).click();await idle();assert.equal(git('show',':new.txt'),'new file\n');
  assert.deepEqual(errors,[]);
  console.log('PASS: Electron workspace bulk/search/nested/keyboard, left gutter, exact stage/unstage/restore, cancel, isolation, stale token, fallback, whole-file action, no page errors');
 }finally{if(app)await app.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
})().catch(e=>{console.error(e);process.exitCode=1;});
