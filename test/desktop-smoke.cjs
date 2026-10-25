const {_electron:electron}=require('playwright-core');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
process.env.BRANCHCRAFT_OUTPUT ||= path.resolve(__dirname,'../screenshots');fs.mkdirSync(process.env.BRANCHCRAFT_OUTPUT,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'branchcraft-ui-'));const repo=path.join(root,'演示仓库');fs.mkdirSync(repo);
const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',windowsHide:true});
(async()=>{let app,page;const errors=[],evidence=[],consoleErrors=[];
async function capture(label){
 if(!page||page.isClosed())return;
 const snapshot=await page.evaluate(label=>{
  const rect=n=>{if(!n)return null;const r=n.getBoundingClientRect(),style=getComputedStyle(n);return {x:r.x,y:r.y,width:r.width,height:r.height,scrollTop:n.scrollTop,scrollHeight:n.scrollHeight,clientHeight:n.clientHeight,overflowY:style.overflowY,display:style.display};};
  const row=document.querySelector('#items .item'),r=row?.getBoundingClientRect(),hit=r?document.elementFromPoint(r.x+r.width/2,r.y+r.height/2):null;
  return {label,time:performance.now(),ready:document.readyState,editor:!!window.projectEditor,repo:document.querySelector('#repoName')?.textContent,status:document.querySelector('#statusText')?.textContent,busy:document.body.getAttribute('aria-busy'),toast:document.querySelector('#toast')?.textContent,view:document.querySelector('[data-view].active')?.dataset.view,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},row:rect(row),items:rect(document.querySelector('#items')),panel:rect(document.querySelector('.list-panel')),commitBox:rect(document.querySelector('#commitBox')),rowText:row?.textContent,hit:hit?.outerHTML.slice(0,600),centerHit:!!row&&row.contains(hit)};
 },label);evidence.push(snapshot);return snapshot;
}
function saveEvidence(){fs.writeFileSync(path.join(process.env.BRANCHCRAFT_OUTPUT,'desktop-evidence.json'),JSON.stringify({platform:process.platform,arch:process.arch,errors,consoleErrors,evidence},null,2));}
try{
git('init','-b','main');git('config','user.name','界面测试');git('config','user.email','ui@example.test');git('config','core.autocrlf','false');fs.writeFileSync(path.join(repo,'hello.txt'),'first line\n');git('add','.');git('commit','-m','初始提交');fs.writeFileSync(path.join(repo,'hello.txt'),'first line\nstashed work\n');git('stash','push','-m','界面测试储藏');fs.writeFileSync(path.join(repo,'hello.txt'),'first line\nworking change\n');
app=await electron.launch({executablePath:process.env.BRANCHCRAFT_EXE||require('electron'),args:[...(process.env.BRANCHCRAFT_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]),...(process.env.BRANCHCRAFT_EXE?[]:[path.resolve(__dirname,'..')]),'--user-data-dir='+path.join(root,'profile')],timeout:30000});page=await app.firstWindow();page.on('console',msg=>{if(msg.type()==='error')consoleErrors.push(msg.text());});page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.gitdesk);await page.locator('#statusText').waitFor();
await app.evaluate(({dialog},folder)=>{globalThis.smokeDialogRequests=[];dialog.showOpenDialog=async()=>{globalThis.smokeDialogRequests.push({folder,time:Date.now()});return {canceled:false,filePaths:[folder]};};},repo);
await capture('before-open');await page.locator('#openRepo').click();await capture('after-open-click');await page.waitForFunction(()=>document.querySelector('#repoName').textContent==='演示仓库');// Regress the zero-height file viewport using real clicks, never force or DOM events.
async function checkCompactLayout(expected,commitEditor=false){
 const original=await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];const state={size:win.getSize(),zoom:win.webContents.getZoomFactor()};win.setSize(1080,700);return state;});
 try{
  for(const zoom of [1,1.25,1.5,1.75]){
   await app.evaluate(({BrowserWindow},z)=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(z),zoom);
   for(const narrow of [false,true]){
    const splitter=page.locator('.list-panel > .panel-splitter');
    if(narrow)await splitter.press('Home');else await splitter.dblclick();
    if(commitEditor)await page.locator('#commitMessage').evaluate((node,tall)=>{node.style.height=tall?'320px':'';},narrow);
    await page.waitForFunction(()=>document.querySelector('#items').getBoundingClientRect().height>=95);
    await capture(`before-row-click:${expected}:${zoom}:${narrow}`);
    await page.locator('#items .item').first().click();
    await page.waitForFunction(text=>document.querySelector('#detailBody').textContent.includes(text),expected);
    // Query and inspect the current row in one renderer task. A locator-resolved
    // ElementHandle can be detached by an intervening asynchronous list refresh.
    const hit=await page.evaluate(()=>{const node=document.querySelector('#items .item');if(!node)return {ok:false,connected:false,reason:'current file row missing'};const r=node.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {ok:node.contains(hit),connected:node.isConnected,rect:r.toJSON(),hit:hit?.outerHTML.slice(0,800)};});
    await capture(`after-row-rebuild:${expected}:${zoom}:${narrow}`);
    if(!hit.ok)throw Error(JSON.stringify(hit)+`文件行中心被遮挡：zoom=${zoom}, narrow=${narrow}`);
    if(commitEditor){
     // Both the wrapped actions and enlarged editor must remain reachable by pointer.
     await page.locator('#listActions button:enabled').first().click({trial:true});
     await page.locator('#commitMessage').click();
    }
   }
  }
 }catch(error){
  await capture('compact-failure-before-reset:'+expected).catch(()=>{});
  saveEvidence();
  await page.screenshot({path:path.join(process.env.BRANCHCRAFT_OUTPUT,'desktop-compact-failure.png')}).catch(()=>{});
  throw error;
 }finally{
  if(commitEditor)await page.locator('#commitMessage').evaluate(node=>{node.style.height='';});
  await app.evaluate(({BrowserWindow},state)=>{const win=BrowserWindow.getAllWindows()[0];win.webContents.setZoomFactor(state.zoom);win.setSize(...state.size);},original);
  await page.locator('.list-panel > .panel-splitter').dblclick();
 }
 console.log('紧凑布局真实点击通过：'+expected+'，4 档缩放 × 2 档分栏宽度');
}
await checkCompactLayout('working change',true);
await page.screenshot({path:path.join(process.env.BRANCHCRAFT_OUTPUT,'Branchcraft-工作区.png')});
await page.getByRole('button',{name:'＋ 全部暂存',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#stagedCount').textContent.startsWith('1'));await page.locator('#commitMessage').fill('通过真实界面创建提交');await page.locator('#commit').click();await page.locator('#reviewDialog').waitFor({state:'visible'});await page.locator('#reviewConfirm').click();await page.waitForFunction(()=>document.querySelector('#changesCount').textContent==='0'&&document.querySelector('#commitMessage').value==='');
await page.locator('[data-view="history"]').click();await checkCompactLayout('working change');await page.locator('#items .item').first().click();await page.waitForFunction(()=>document.querySelector('#detailBody').textContent.includes('working change'));await page.screenshot({path:path.join(process.env.BRANCHCRAFT_OUTPUT,'Branchcraft-提交历史.png')});
await page.locator('[data-view="stash"]').click();await checkCompactLayout('stashed work');await page.locator('#items .item').first().click();await page.waitForFunction(()=>document.querySelector('#detailBody').textContent.includes('stashed work'));await page.screenshot({path:path.join(process.env.BRANCHCRAFT_OUTPUT,'Branchcraft-Stash.png')});
if(process.platform==='darwin'){
 const roles=await app.evaluate(({Menu})=>Menu.getApplicationMenu().items.flatMap(item=>(item.submenu?.items||[]).map(x=>x.role)));
 for(const role of ['copy','paste','undo'])if(!roles.includes(role))throw Error('macOS 原生编辑菜单缺少 '+role);
 // close() requests native window closure; on macOS it need not finish synchronously.
 // Observe both close notifications before checking the zero-window state or activating.
 await Promise.all([
  page.waitForEvent('close'),
  app.evaluate(async({BrowserWindow})=>{
   const win=BrowserWindow.getAllWindows()[0];
   await new Promise(resolve=>{win.once('closed',resolve);win.close();});
   if(BrowserWindow.getAllWindows().length!==0)throw Error('窗口未关闭');
  })
 ]);
 // Attach rejection handlers immediately so a failed evaluate is not masked by an
 // unhandled window waiter when finally closes the application.
 const [next]=await Promise.all([
  app.waitForEvent('window'),
  app.evaluate(({app})=>{app.emit('activate');})
 ]);
 next.on('pageerror',e=>errors.push(e.message));await next.waitForFunction(()=>!!window.gitdesk);
 await next.locator('#statusText').waitFor();console.log('macOS 原生菜单、关闭最后窗口及 activate 重建窗口通过。');
}
saveEvidence();if(errors.length)throw Error(errors.join('\n'));console.log('真实 Electron 界面测试通过：启动、选择仓库、工作区 Diff、暂存、提交、提交历史、Stash 修改详情；无页面异常。');
}catch(error){await capture('failure-before-cleanup').catch(()=>{});if(app)try{evidence.push({main:await app.evaluate(({BrowserWindow})=>({dialogRequests:globalThis.smokeDialogRequests,windows:BrowserWindow.getAllWindows().map(w=>({bounds:w.getBounds(),zoom:w.webContents.getZoomFactor(),loading:w.webContents.isLoading()}))}))});}catch{}saveEvidence();if(page&&!page.isClosed())await page.screenshot({path:path.join(process.env.BRANCHCRAFT_OUTPUT,'desktop-failure.png')}).catch(()=>{});console.error('桌面测试失败（应用清理前）：',error);throw error;}finally{if(app)await app.close();fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
