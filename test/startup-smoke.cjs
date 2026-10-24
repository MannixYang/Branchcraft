const {_electron:electron}=require('playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{let app;const errors=[];const profile=fs.mkdtempSync(path.join(os.tmpdir(),'branchcraft-startup-'));try{
 app=await electron.launch({executablePath:process.env.BRANCHCRAFT_EXE||require('electron'),args:[...(process.env.BRANCHCRAFT_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]),...(process.env.BRANCHCRAFT_EXE?[]:[path.resolve(__dirname,'..')]),'--user-data-dir='+profile],timeout:30000});
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForLoadState('load');
 // Hold the editor script, not a clock: a genuine click must survive slow module loading.
 await app.evaluate(({session,dialog})=>{
  const filePath=url=>{let pathname=decodeURIComponent(new URL(url).pathname);if(process.platform==='win32')pathname=pathname.replace(/^\/(?=[A-Za-z]:)/,'');return pathname;};
  globalThis.startupChooseCalls=0;globalThis.releaseStartupEditor=null;
  dialog.showOpenDialog=async()=>{globalThis.startupChooseCalls++;return {canceled:true,filePaths:[]};};
  session.defaultSession.protocol.interceptFileProtocol('file',(request,callback)=>{
   const send=()=>callback({path:filePath(request.url)});
   if(new URL(request.url).pathname.endsWith('/project-ui.js'))globalThis.releaseStartupEditor=send;else send();
  });
 });
 await page.reload({waitUntil:'commit'});
 await page.waitForFunction(()=>!!document.querySelector('#openRepo')?.onclick);
 assert.equal(await page.evaluate(()=>!!window.projectEditor),false,'必须在编辑器初始化前点击');
 await page.locator('#openRepo').click();
 assert.equal(await app.evaluate(()=>globalThis.startupChooseCalls),0,'编辑器保护未就绪时不能绕过检查');
 await app.evaluate(()=>{assertRelease();function assertRelease(){if(!globalThis.releaseStartupEditor)throw Error('编辑器脚本未被拦截');globalThis.releaseStartupEditor();}});
 await page.waitForLoadState('load');
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal(await app.evaluate(()=>globalThis.startupChooseCalls),1,'初始化后必须恰好处理一次早点击，不能静默丢弃');
 await page.locator('#openRepo').click();
 await page.waitForFunction(()=>document.body.getAttribute('aria-busy')!=='true');
 assert.equal(await app.evaluate(()=>globalThis.startupChooseCalls),2,'正常初始化后的点击仍可使用');
 // A ready editor may still refuse navigation (dirty/saving): do not bypass it.
 await page.evaluate(()=>{window.startupOriginalLeave=window.projectEditor.leave;window.startupGuardCalls=0;window.projectEditor.leave=async()=>{window.startupGuardCalls++;return false;};});
 await page.locator('#openRepo').click();
 await page.waitForFunction(()=>window.startupGuardCalls===1);
 assert.equal(await app.evaluate(()=>globalThis.startupChooseCalls),2,'编辑器拒绝离开时不得打开仓库对话框');
 await page.evaluate(()=>{window.projectEditor.leave=window.startupOriginalLeave;});
 await page.locator('#openRepo').click();
 await page.waitForFunction(()=>document.body.getAttribute('aria-busy')!=='true');
 assert.equal(await app.evaluate(()=>globalThis.startupChooseCalls),3,'取消离开后恢复正常保护和点击');
 assert.deepEqual(errors,[]);
 console.log('启动初始化回归通过：真实早点击等待保护就绪，恰好执行一次；后续点击正常，无页面异常。');
 }finally{if(app)await app.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
