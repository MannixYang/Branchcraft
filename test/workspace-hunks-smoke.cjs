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
  const buttonBox=await action('stage').boundingBox(),numberBox=await page.locator('.diff-line.hunk .line-num').first().boundingBox();assert(buttonBox.width>=24&&buttonBox.width<=28&&buttonBox.x+buttonBox.width<=numberBox.x,'action must be visible before line numbers');
  assert.equal(await action('stage').textContent(),'＋');assert.ok(await action('stage').getAttribute('aria-label'));assert.equal(await action('restore').textContent(),'↶');console.log('暂存块');await action('stage').click();await idle();assert.equal(fs.readFileSync(target,'utf8'),changed);assert.equal(git('show',':'+file),base.replace('line 3\n','changed FIRST\n'));
  console.log('读取已暂存');await open('staged');await action('unstage').waitFor();await page.setViewportSize({width:1100,height:800});assert.equal(await page.locator('[data-action="unstage"]').count(),1);assert.equal(await page.locator('[data-action="restore"]').count(),0);assert.equal(await action('unstage').textContent(),'−');assert.match(await action('unstage').getAttribute('title'),/取消暂存/);const unstageBox=await action('unstage').boundingBox();assert.ok(unstageBox.width<=28&&unstageBox.width>=24);const pane=await page.locator('#detailBody').boundingBox();assert.ok(unstageBox.x>=pane.x&&unstageBox.x+unstageBox.width<=pane.x+pane.width,'窄窗已暂存入口必须可见');if(process.env.BRANCHCRAFT_HUNKS_SCREENSHOT)await page.screenshot({path:process.env.BRANCHCRAFT_HUNKS_SCREENSHOT});await action('unstage').click();await idle();assert.equal(git('show',':'+file),base);assert.equal(fs.readFileSync(target,'utf8'),changed);
  await open('worktree');console.log('暂存块');await action('stage').click();await idle();await open('worktree');assert.equal(await page.locator('[data-action="restore"]').count(),1);
  await action('restore').click();await page.locator('#modal[open]').waitFor();await page.click('#modalCancel');assert.equal(fs.readFileSync(target,'utf8'),changed);
  await action('restore').click();await page.click('#modalConfirm');await idle();const firstOnly=base.replace('line 3\n','changed FIRST\n');assert.equal(fs.readFileSync(target,'utf8'),firstOnly);assert.equal(git('show',':'+file),firstOnly);
  console.log('读取已暂存');await open('staged');fs.appendFileSync(target,'external edit\n');await action('unstage').click();await idle();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('变化'));assert.equal(git('show',':'+file),firstOnly);assert.equal(fs.readFileSync(target,'utf8'),firstOnly+'external edit\n');
  const fileAction=type=>page.locator(`.hunk-action[data-scope="file"][data-action="${type}"]`);
  const openFile=async(name,staged=false)=>{await page.evaluate(()=>refresh());await page.locator(`.item[title="${name}"]`)[staged?'first':'last']().click();await fileAction(staged?'unstage':'stage').waitFor();};
  const restoreFile=async(confirm)=>{await fileAction('restore').click();await page.locator('#modal[open]').waitFor();await page.click(confirm?'#modalConfirm':'#modalCancel');await idle();};
  const fresh=path.join(repo,'new.txt');
  await openFile('new.txt');assert.equal(await fileAction('stage').count(),1);assert.equal(await fileAction('stage').textContent(),'＋');assert.match(await fileAction('stage').getAttribute('aria-label'),/整个文件/);
  const fb=await fileAction('stage').boundingBox(),ln=await page.locator('.diff-line .line-num').first().boundingBox();assert.ok(fb.x+fb.width<=ln.x&&fb.width>=24&&fb.width<=28);
  await restoreFile(false);assert.equal(fs.readFileSync(fresh,'utf8'),'new file\n');
  fs.appendFileSync(fresh,'external\n');await restoreFile(true);await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('变化'));assert.equal(fs.readFileSync(fresh,'utf8'),'new file\nexternal\n');
  await openFile('new.txt');await fileAction('stage').click();await idle();assert.equal(git('show',':new.txt'),'new file\nexternal\n');
  await openFile('new.txt',true);assert.equal(await fileAction('restore').count(),0);assert.equal(await fileAction('unstage').textContent(),'−');await fileAction('unstage').click();await idle();assert.ok(fs.existsSync(fresh));assert.equal(git('ls-files','--','new.txt'),'');
  await openFile('new.txt');await restoreFile(true);assert.equal(fs.existsSync(fresh),false);
  console.log('新增文件整文件图标及安全恢复通过');
  const deleted=path.join(repo,'deleted.txt');fs.writeFileSync(deleted,'delete base\n');git('add','deleted.txt');git('commit','-m','deletion fixture');fs.unlinkSync(deleted);
  await openFile('deleted.txt');assert.equal(await fileAction('restore').count(),1);await restoreFile(false);assert.equal(fs.existsSync(deleted),false);
  if(process.env.BRANCHCRAFT_FILE_SCREENSHOT)await page.screenshot({path:process.env.BRANCHCRAFT_FILE_SCREENSHOT});
  await fileAction('stage').click();await idle();assert.equal(git('ls-files','--','deleted.txt'),'');assert.equal(fs.existsSync(deleted),false);
  await openFile('deleted.txt',true);assert.equal(await fileAction('restore').count(),0);await fileAction('unstage').click();await idle();assert.equal(git('show',':deleted.txt'),'delete base\n');assert.equal(fs.existsSync(deleted),false);
  await openFile('deleted.txt');await restoreFile(true);assert.equal(fs.readFileSync(deleted,'utf8'),'delete base\n');
  // A staged addition may also have unstaged edits: restoring those must keep the index.
  fs.writeFileSync(fresh,'indexed addition\n');git('add','new.txt');fs.appendFileSync(fresh,'unstaged edit\n');await page.evaluate(()=>refresh());await page.locator('.item[title="new.txt"]').last().click();await page.locator('#detailActions').getByRole('button',{name:'恢复文件修改…',exact:true}).waitFor();assert.equal(await fileAction('stage').count(),0);await page.locator('#detailActions').getByRole('button',{name:'恢复文件修改…',exact:true}).click();await page.click('#modalConfirm');await idle();assert.equal(fs.readFileSync(fresh,'utf8'),'indexed addition\n');assert.equal(git('show',':new.txt'),'indexed addition\n');
  // Empty and binary additions have no @@ line but still expose exactly one file action group.
  for(const [name,data] of [['empty.txt',''],['binary.dat',Buffer.from([0,1,2])]]){fs.writeFileSync(path.join(repo,name),data);await openFile(name);assert.equal(await fileAction('stage').count(),1);assert.equal(await fileAction('restore').count(),1);await restoreFile(true);assert.equal(fs.existsSync(path.join(repo,name)),false);}
  console.log('删除文件、暂存区隔离、空文件和二进制文件通过');
  assert.deepEqual(errors,[]);
  console.log('PASS: Electron workspace bulk/search/nested/keyboard, left gutter, exact stage/unstage/restore, cancel, isolation, stale token, fallback, whole-file action, no page errors');
 }finally{if(app)await app.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
})().catch(e=>{console.error(e);process.exitCode=1;});
