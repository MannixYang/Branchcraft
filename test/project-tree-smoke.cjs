'use strict';
const { _electron: electron }=require('playwright-core');
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('node:assert/strict');
const {execFileSync:run}=require('child_process');
(async()=>{
 const repo=fs.mkdtempSync(path.join(os.tmpdir(),'bc-project-tree-'));
 const other=fs.mkdtempSync(path.join(os.tmpdir(),'bc-project-other-'));
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'bc-project-profile-'));
 const git=(folder,...args)=>run('git',['-C',folder,...args],{stdio:'pipe'});
 const payload='<img src=x onerror="window.projectInjected=true">';
 let app;
 try{
  for(const folder of [repo,other]){
   git(folder,'init');git(folder,'config','user.name','Project Test');git(folder,'config','user.email','test@example.com');
   fs.mkdirSync(path.join(folder,'src/nested'),{recursive:true});fs.mkdirSync(path.join(folder,'docs'));
   fs.writeFileSync(path.join(folder,'src/nested/a.txt'),'HEAD line\n');
   fs.writeFileSync(path.join(folder,'docs/readme.txt'),'docs\n');fs.writeFileSync(path.join(folder,'root.txt'),'root\n');
   git(folder,'add','.');git(folder,'commit','-m','fixture');
  }
  fs.writeFileSync(path.join(repo,'src/nested/a.txt'),'INDEX line\n');git(repo,'add','.');
  fs.writeFileSync(path.join(repo,'src/nested/a.txt'),payload+'\n');
  delete process.env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({executablePath:require('electron'),args:[path.resolve(__dirname,'..'),'--user-data-dir='+profile]});
  await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},repo);
  const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>typeof choose==='function');await page.evaluate(()=>choose());
  await page.click('[data-view="project"]');
  const src=page.locator('button.folder-row[data-folder="src/"]');
  async function expanded(name,value){await page.waitForFunction(({name,value})=>document.querySelector(`button.folder-row[data-folder="${name}"]`)?.getAttribute('aria-expanded')===String(value),{name,value});}
  await expanded('src/',false);assert.equal(await page.locator('.file-row').count(),1);
  assert.equal(await page.locator('.folder-row[aria-expanded="true"]').count(),0);
  const box=await src.boundingBox(),list=await page.locator('#items').boundingBox();assert(box.width>list.width*.9,'folder button must fill the row');
  assert(await src.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.right-8,r.top+r.height/2));}),"folder right edge must not be covered by the resize handle");
  await src.click({position:{x:box.width-8,y:box.height/2}});await expanded('src/',true);await expanded('src/nested/',false);
  await src.focus();await page.keyboard.press('Space');await expanded('src/',false);
  await page.getByRole('button',{name:'全部展开',exact:true}).click();await expanded('src/nested/',true);
  assert.equal(await page.locator('.file-row').count(),3);
  await page.getByRole('button',{name:'全部折叠',exact:true}).click();await expanded('src/',false);assert.equal(await page.locator('.file-row').count(),1);
  await page.click('#refresh');await page.waitForFunction(()=>!document.body.hasAttribute('aria-busy'));await expanded('src/',false);
  await page.getByRole('button',{name:'全部展开',exact:true}).click();
  await page.locator('.folder-row[data-folder="docs/"]').click();
  await page.click('#refresh');await page.waitForFunction(()=>!document.body.hasAttribute('aria-busy'));await expanded('docs/',false);await expanded('src/nested/',true);
  await page.locator('.file-row[title="src/nested/a.txt"]').click();
  assert.equal(await page.locator('#diffBase').isVisible(),false);
  await page.getByRole('button',{name:'显示 Diff',exact:true}).click();
  await page.waitForSelector('#editorDiff .diff-line.add');
  assert((await page.locator('#editorDiff .diff-line.del').textContent()).includes('-HEAD line'));
  assert((await page.locator('#editorDiff .diff-line.add').textContent()).includes(payload));
  assert(await page.locator('#editorDiff .line-num').count()>0);assert.equal(await page.locator('#editorDiff img').count(),0);
  assert.equal(await page.evaluate(()=>window.projectInjected),undefined);
  const colors=await page.evaluate(()=>['add','del'].map(c=>getComputedStyle(document.querySelector('#editorDiff .'+c)).backgroundColor));assert.notEqual(colors[0],colors[1]);
  await page.selectOption('#diffBase','index');await page.waitForFunction(()=>document.querySelector('#editorDiff .del')?.textContent.includes('-INDEX line'));
  await app.evaluate(({ipcMain})=>{
   const original=ipcMain._invokeHandlers.get('projectDiff');
   ipcMain.removeHandler('projectDiff');
   ipcMain.handle('projectDiff',async(event,args)=>{
    const result=await original(event,args);
    if(args.base==='HEAD')await new Promise(resolve=>setTimeout(resolve,350));
    return result;
   });
  });
  await page.selectOption('#diffBase','HEAD');await page.selectOption('#diffBase','index');
  await page.waitForFunction(()=>document.querySelector('#editorDiff .del')?.textContent.includes('-INDEX line'));
  await page.waitForTimeout(500);
  assert((await page.locator('#editorDiff .del').textContent()).includes('-INDEX line'),'stale HEAD response must not replace index');
  await page.locator('#projectText').fill('unsaved local buffer');
  await page.waitForFunction(()=>document.querySelector('#editorDiff .detail-note')?.textContent.includes('未保存'));
  assert.equal(await page.locator('#projectText').inputValue(),'unsaved local buffer');assert(await page.locator('#projectText').evaluate(n=>n===document.activeElement));
  await page.getByRole('button',{name:'隐藏 Diff',exact:true}).click();assert.equal(await page.locator('#editorDiff').isVisible(),false);
  await page.getByRole('button',{name:'显示 Diff',exact:true}).click();await page.waitForSelector('#editorDiff .add');
  await page.click('[data-view="history"]');await page.click('#modalCancel');assert(await page.locator('#projectText').isVisible());
  await page.locator('#projectText').press('Control+s');await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('已保存到工作区'));
  assert.equal(fs.readFileSync(path.join(repo,'src/nested/a.txt'),'utf8'),'unsaved local buffer');assert.equal(git(repo,'show',':src/nested/a.txt').toString(),'INDEX line\n');
  await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},other);
  await page.evaluate(()=>choose());await expanded('src/',false);assert.equal(await page.locator('#projectText').count(),0);
  await page.getByRole('button',{name:'全部展开',exact:true}).click();await expanded('src/nested/',true);
  await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},repo);
  await page.evaluate(()=>choose());await expanded('src/',false);
  assert.deepEqual(errors,[]);
  console.log('PASS: real Electron initial collapse, full-row/keyboard toggle, bulk actions, refresh retention, repository reset, colored safe numbered Diff, HEAD/index, dirty buffer/focus, hidden Diff, save/index unchanged');
 }finally{
  if(app)await app.close();
  for(const folder of [repo,other,profile])fs.rmSync(folder,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});