const {_electron:electron}=require('playwright-core');
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert'),{execFileSync}=require('child_process');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bc-merge-ui-'));let app,page;
 try{
  const repo=path.join(root,'repo');fs.mkdirSync(repo);const globalFile=path.join(root,'global');fs.writeFileSync(globalFile,'');
  const env={...process.env,GIT_CONFIG_GLOBAL:globalFile,GIT_CONFIG_NOSYSTEM:'1'};
  const git=(...args)=>execFileSync('git',args,{cwd:repo,env,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
  const write=(name,text)=>fs.writeFileSync(path.join(repo,name),text);
  git('init','-b','main');git('config','user.name','Merge UI');git('config','user.email','merge@example.test');git('config','core.autocrlf','false');
  write('a.txt','base\n');git('add','.');git('commit','-m','base');const base=git('rev-parse','HEAD');
  git('checkout','-b','feature');write('incoming.txt','incoming\n');write('second.txt','second\n');git('add','.');git('commit','-m','incoming');const target=git('rev-parse','HEAD');git('checkout','main');
  app=await electron.launch({executablePath:require('electron'),args:[path.resolve(__dirname,'..'),'--user-data-dir='+path.join(root,'profile')],env});
  page=await app.firstWindow();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},repo);
  await page.waitForFunction(()=>typeof choose==='function');await page.evaluate(()=>choose());
  const button=t=>page.getByRole('button',{name:t,exact:true});
  const confirm=async()=>{await page.locator('#mergeConfirm').click();await page.locator('#modal').waitFor({state:'visible'});await page.locator('#modalConfirm').click();await page.waitForFunction(()=>!loading&&!document.querySelector('#modal').open);};
  await page.waitForFunction(()=>!loading);await page.evaluate(()=>showMergePreview('feature'));await page.locator('#mergePreviewDiff').waitFor();
  assert.equal(git('rev-parse','HEAD'),base);assert.equal(git('status','--porcelain'),'');assert((await page.locator('#mergePreviewDiff').innerText()).includes('incoming.txt'));
  await button('下一文件').click();await button('下一文件').click();await button('上一文件').click();
  write('untracked.txt','dirty');await confirm();assert.equal(git('rev-parse','HEAD'),base);assert((await page.locator('#toast').innerText()).includes('干净'));fs.unlinkSync(path.join(repo,'untracked.txt'));
  await page.waitForFunction(()=>!loading);await page.evaluate(()=>showMergePreview('feature'));await confirm();assert.equal(git('rev-parse','HEAD'),target);
  git('checkout','-b','conflicting');write('a.txt','theirs\n');git('add','.');git('commit','-m','theirs');git('checkout','main');write('a.txt','ours\n');git('add','.');git('commit','-m','ours');
  await page.evaluate(()=>refresh());await page.waitForFunction(()=>!loading);await page.evaluate(()=>showMergePreview('conflicting'));await confirm();assert(git('ls-files','-u').includes('a.txt'));
  await page.evaluate(async()=>{await setView('changes');const file=state.files.find(f=>f.conflict);await selectFile(file,'conflict','conflict:'+file.path);});
  const editor=page.locator('#conflictResult');await editor.waitFor();assert((await editor.inputValue()).includes('<<<<<<<'));
  assert((await page.locator('.conflict-side.ours').innerText()).includes('ours'));assert((await page.locator('.conflict-side.theirs').innerText()).includes('theirs'));
  await button('下一冲突').click();await button('上一冲突').click();const original=await editor.inputValue();
  await button('接受当前块').click();assert.equal(await editor.inputValue(),'ours\n');await editor.fill(original);
  await button('接受传入块').click();assert.equal(await editor.inputValue(),'theirs\n');await editor.fill(original);
  await button('接受双方块').click();assert.equal(await editor.inputValue(),'ours\ntheirs\n');assert((await page.locator('#conflictStatus').innerText()).includes('未保存'));
  // 刷新不得静默丢失编辑，切视图取消/放弃分别验证。
  await page.locator('#refresh').click();assert.equal(await editor.inputValue(),'ours\ntheirs\n');
  await page.waitForFunction(()=>!loading);await page.evaluate(()=>{void setView('history');});await page.locator('#modal').waitFor({state:'visible'});await page.locator('#modalCancel').click();assert.equal(await editor.inputValue(),'ours\ntheirs\n');
  await page.evaluate(()=>{void choose();});await page.locator('#modal').waitFor({state:'visible'});await page.locator('#modalCancel').click();assert.equal(await editor.inputValue(),'ours\ntheirs\n');
  assert(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;}));
  await editor.fill('manual\nresult\n');assert.equal(await page.locator('.conflict-gutter').innerText(),'1\n2\n3');
  const disk=fs.readFileSync(path.join(repo,'a.txt'),'utf8');write('a.txt',disk+'external\n');
  await page.locator('#conflictSave').click();await page.locator('#modalConfirm').click();await page.waitForFunction(()=>!loading&&!conflictSaving);assert.equal(await editor.inputValue(),'manual\nresult\n');assert(git('ls-files','-u'));assert.equal(fs.readFileSync(path.join(repo,'a.txt'),'utf8'),disk+'external\n');
  await button('重新载入').click();await page.locator('#modalCancel').click();assert.equal(await editor.inputValue(),'manual\nresult\n');
  await button('重新载入').click();await page.locator('#modalConfirm').click();await page.waitForFunction(()=>document.querySelector('#conflictResult')?.value.includes('external'));
  await editor.fill('resolved manually\n');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1080,700));assert(await page.locator('#conflictSave').isVisible());
  await page.locator('#conflictSave').click();await page.locator('#modalConfirm').click();await page.waitForFunction(()=>!loading&&!conflictSaving&&!document.querySelector('#conflictResult'));
  assert.equal(git('ls-files','-u'),'');assert.equal(git('show',':a.txt'),'resolved manually');assert.equal(fs.readFileSync(path.join(repo,'a.txt'),'utf8'),'resolved manually\n');
  assert.equal(errors.length,0,errors.join('\n'));console.log('PASS: real Electron merge preview/navigation/dirty rejection/merge, real conflict sides/block choices/manual edit/gutter/refresh/view and repository leave cancel/unload guard/stale save/reload/save staging/minimum window; no pageerror');
 }finally{if(page)await page.evaluate(()=>{conflictDrafts.clear();conflictSaving=false;}).catch(()=>{});if(app)await app.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
})().catch(e=>{console.error(e);process.exitCode=1;});
