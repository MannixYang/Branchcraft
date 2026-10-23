const {_electron:electron}=require('playwright-core');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
process.env.BRANCHCRAFT_OUTPUT ||= path.resolve(__dirname,'../screenshots');fs.mkdirSync(process.env.BRANCHCRAFT_OUTPUT,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'branchcraft-ui-'));const repo=path.join(root,'演示仓库');fs.mkdirSync(repo);
const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',windowsHide:true});
(async()=>{let app;const errors=[];try{
git('init','-b','main');git('config','user.name','界面测试');git('config','user.email','ui@example.test');git('config','core.autocrlf','false');fs.writeFileSync(path.join(repo,'hello.txt'),'first line\n');git('add','.');git('commit','-m','初始提交');fs.writeFileSync(path.join(repo,'hello.txt'),'first line\nstashed work\n');git('stash','push','-m','界面测试储藏');fs.writeFileSync(path.join(repo,'hello.txt'),'first line\nworking change\n');
app=await electron.launch({executablePath:process.env.BRANCHCRAFT_EXE||require('electron'),args:[...(process.env.BRANCHCRAFT_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]),...(process.env.BRANCHCRAFT_EXE?[]:[path.resolve(__dirname,'..')]),'--user-data-dir='+path.join(root,'profile')],timeout:30000});const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.gitdesk);await page.locator('#statusText').waitFor();
await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},repo);
await page.locator('#openRepo').click();await page.waitForFunction(()=>document.querySelector('#repoName').textContent==='演示仓库');// Exercise real pointer interaction at the minimum supported window size.
const originalSize=await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];const size=win.getSize();win.setSize(1080,700);return size;});
await page.locator('#items .item').first().click();await page.waitForFunction(()=>document.querySelector('#detailBody').textContent.includes('working change'));await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setSize(...size),originalSize);
await page.screenshot({path:path.join(process.env.BRANCHCRAFT_OUTPUT,'Branchcraft-工作区.png')});
await page.getByRole('button',{name:'＋ 全部暂存',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#stagedCount').textContent.startsWith('1'));await page.locator('#commitMessage').fill('通过真实界面创建提交');await page.locator('#commit').click();await page.locator('#reviewDialog').waitFor({state:'visible'});await page.locator('#reviewConfirm').click();await page.waitForFunction(()=>document.querySelector('#changesCount').textContent==='0'&&document.querySelector('#commitMessage').value==='');
await page.locator('[data-view="history"]').click();await page.locator('#items .item').first().click();await page.waitForFunction(()=>document.querySelector('#detailBody').textContent.includes('working change'));await page.screenshot({path:path.join(process.env.BRANCHCRAFT_OUTPUT,'Branchcraft-提交历史.png')});
await page.locator('[data-view="stash"]').click();await page.locator('#items .item').first().click();await page.waitForFunction(()=>document.querySelector('#detailBody').textContent.includes('stashed work'));await page.screenshot({path:path.join(process.env.BRANCHCRAFT_OUTPUT,'Branchcraft-Stash.png')});
if(process.platform==='darwin'){
 const roles=await app.evaluate(({Menu})=>Menu.getApplicationMenu().items.flatMap(item=>(item.submenu?.items||[]).map(x=>x.role)));
 for(const role of ['copy','paste','undo'])if(!roles.includes(role))throw Error('macOS 原生编辑菜单缺少 '+role);
 const reopened=app.waitForEvent('window');
 await app.evaluate(({app,BrowserWindow})=>{BrowserWindow.getAllWindows()[0].close();if(BrowserWindow.getAllWindows().length!==0)throw Error('窗口未关闭');app.emit('activate');});
 const next=await reopened;next.on('pageerror',e=>errors.push(e.message));await next.waitForFunction(()=>!!window.gitdesk);
 await next.locator('#statusText').waitFor();console.log('macOS 原生菜单、关闭最后窗口及 activate 重建窗口通过。');
}
if(errors.length)throw Error(errors.join('\n'));console.log('真实 Electron 界面测试通过：启动、选择仓库、工作区 Diff、暂存、提交、提交历史、Stash 修改详情；无页面异常。');
}finally{if(app)await app.close();fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
