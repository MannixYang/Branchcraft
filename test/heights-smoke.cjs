const {_electron:electron}=require('playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'branchcraft-layout-')),repo=path.join(root,'repo'),profile=path.join(root,'profile');fs.mkdirSync(repo);
const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',windowsHide:true});
(async()=>{let app;const errors=[];try{
 git('init','-b','main');git('config','user.name','Layout Test');git('config','user.email','layout@example.test');
 fs.writeFileSync(path.join(repo,'initial.txt'),'initial\n');git('add','.');git('commit','-m','Initial');
 for(let n=0;n<35;n++){git('branch','test-'+String(n).padStart(2,'0'));git('update-ref','refs/remotes/origin/test-'+n,'HEAD');fs.writeFileSync(path.join(repo,'file-'+n+'.txt'),'content\n');}
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 app=await electron.launch({env,executablePath:process.env.BRANCHCRAFT_EXE||require('electron'),args:[...(process.env.BRANCHCRAFT_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]),...(process.env.BRANCHCRAFT_EXE?[]:[path.resolve(__dirname,'..')]),'--user-data-dir='+profile],timeout:30000});
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForLoadState('load');
 await app.evaluate(({dialog},repo)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[repo]});},repo);
 await page.locator('#openRepo').click();await page.waitForFunction(()=>document.querySelector('#items .item'));
 const tick=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const grip=id=>page.locator('[data-height="'+id+'"]');
 async function size(selector){return page.locator(selector).evaluate(n=>n.getBoundingClientRect().height);}
 async function scrollable(selector){assert(await page.locator(selector).evaluate(n=>{n.scrollTop=n.scrollHeight;return n.scrollHeight>n.clientHeight&&n.scrollTop>0;}),selector+' must scroll');}
 await page.locator('.sidebar').evaluate(n=>n.scrollTop=0);
 await grip('branches').scrollIntoViewIfNeeded();const box=await grip('branches').boundingBox();const before=await size('#branches');
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+box.height/2+35,{steps:5});await page.mouse.up();await tick();
 assert((await size('#branches'))>before+20,'mouse drag must expand branch list');
 await grip('branches').press('Home');await tick();assert((await size('#branches'))<=33);await scrollable('#branches');
 await grip('remoteBranches').scrollIntoViewIfNeeded();await grip('remoteBranches').press('Home');await tick();await scrollable('#remoteBranches');
 await grip('commit').press('End');await tick();await scrollable('#items');
 const commitLarge=await size('#commitBox');await grip('commit').press('ArrowDown');await tick();assert((await size('#commitBox'))<commitLarge,'top grip down must reduce height');
 await grip('commit').press('Home');await tick();await scrollable('#commitBox');
 await grip('commit').dblclick();await tick();assert(Math.abs((await size('#commitBox'))-158)<2,'double click reset');
 await grip('branches').scrollIntoViewIfNeeded();await grip('branches').press('End');await grip('branches').press('ArrowUp');await tick();const remembered=await size('#branches');
 await page.reload();await page.waitForFunction(()=>document.querySelector('[data-height="branches"]'));await tick();assert(Math.abs((await size('#branches'))-remembered)<2,'height must survive reload');
 // Width controls must remain independent from height preferences.
 const horizontal=page.locator('.sidebar > .panel-splitter');const width=await page.locator('.sidebar').evaluate(n=>n.getBoundingClientRect().width);await horizontal.press('ArrowRight');await tick();assert((await page.locator('.sidebar').evaluate(n=>n.getBoundingClientRect().width))>width);
 await page.locator('#recent button').first().click();await page.waitForFunction(()=>document.querySelector('#repoName').textContent==='repo');
 await page.locator('[data-view="graph"]').click();await page.waitForFunction(()=>document.querySelector('#graphRows .graph-row'));
 await grip('graphInspector').press('Home');await tick();const small=await size('#graphInspector');await grip('graphInspector').press('End');await tick();assert((await size('#graphInspector'))>small+30);
 await grip('graphInfo').press('Home');await tick();assert((await size('#graphInfo'))<=41);
 await page.locator('#toggleTerminal').click();await page.waitForFunction(()=>document.querySelector('#terminalHost .xterm'));
 await grip('terminalHeight').press('Home');await tick();assert((await size('#terminalPanel'))<=121);await grip('terminalHeight').press('End');await tick();assert((await size('#terminalPanel'))>200);await page.locator('#hideTerminal').click();
 await page.locator('[data-view="changes"]').click();await grip('detailHeight').press('Home');await tick();assert((await size('.detail-panel'))<=121);await grip('detailHeight').press('End');
 await page.locator('[data-height="detailHeight"]').evaluate(n=>n.remove());await tick();assert.equal(await grip('detailHeight').count(),1,'removed floating grip must recover');
 await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.setMinimumSize(800,480);win.setSize(1050,540);});await tick();
 await scrollable('#items');await page.locator('.sidebar-bottom a').scrollIntoViewIfNeeded();assert(await page.locator('.sidebar-bottom a').isVisible());
 // The real generic dialog remains usable with unusually long content.
 await page.evaluate(()=>{const d=document.querySelector('#modal');d.querySelector('form').prepend(Object.assign(document.createElement('div'),{textContent:'Long dialog '.repeat(1000)}));d.showModal();});await tick();
 assert(await page.locator('#modal').evaluate(n=>n.getBoundingClientRect().height<=innerHeight-30&&n.scrollHeight>n.clientHeight));await page.locator('#modalConfirm').scrollIntoViewIfNeeded();assert(await page.locator('#modalConfirm').isVisible());await page.evaluate(()=>document.querySelector('#modal').close());
 const out=process.env.BRANCHCRAFT_OUTPUT||path.resolve(__dirname,'../screenshots/layout');fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,'layout-short-window.png')});
 assert.equal(errors.length,0,errors.join('\n'));console.log('PASS: vertical mouse/keyboard/reset/persistence, width isolation, branch/file/commit overflow, graph/terminal/detail heights and short-window dialogs');
 }finally{if(app)await app.close();fs.rmSync(root,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
