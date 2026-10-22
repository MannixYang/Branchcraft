'use strict';
const {_electron:electron}=require('playwright-core');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'branchcraft-workflow-'));
const git=(repo,...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',windowsHide:true});
function makeRepo(name){const repo=path.join(root,name);fs.mkdirSync(repo);git(repo,'init','-b','main');git(repo,'config','user.name','Workflow');git(repo,'config','user.email','workflow@example.test');git(repo,'config','core.autocrlf','false');fs.writeFileSync(path.join(repo,'a.txt'),'base\n');git(repo,'add','.');git(repo,'commit','-m','base');fs.writeFileSync(path.join(repo,'a.txt'),'base\nexternal one\n');return repo;}
(async()=>{let app;const errors=[];try{
 const repo=makeRepo('workflow-a'),other=makeRepo('workflow-b');
 app=await electron.launch({executablePath:require('electron'),args:[path.resolve(__dirname,'..'),'--user-data-dir='+path.join(root,'profile')],timeout:30000});
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.gitdesk);
 const open=async folder=>{await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},folder);await page.locator('#openRepo').click();await page.waitForFunction(name=>document.querySelector('#repoName').textContent===name,path.basename(folder));};
 const settled=()=>page.waitForFunction(()=>!document.body.hasAttribute('aria-busy'));
 await open(repo);await page.locator('#items .item').first().click();await page.waitForFunction(()=>document.querySelector('#detailBody').textContent.includes('external one'));
 await page.locator('#search').fill('a.txt');await page.locator('#commitMessage').fill('草稿 A');
 // Same porcelain status, different bytes: selected diff must still refresh.
 fs.writeFileSync(path.join(repo,'a.txt'),'base\nexternal two\n');
 await page.waitForFunction(()=>document.querySelector('#detailBody').textContent.includes('external two'));
 assert.equal(await page.locator('#search').inputValue(),'a.txt');assert.equal(await page.locator('#commitMessage').inputValue(),'草稿 A');assert.equal(await page.locator('#items .selected').count(),1);console.log('通过：相同Git状态下的外部内容刷新、选择/搜索/草稿保持');
 await open(other);assert.equal(await page.locator('#commitMessage').inputValue(),'');await page.locator('#commitMessage').fill('草稿 B');await open(repo);assert.equal(await page.locator('#commitMessage').inputValue(),'草稿 A');console.log('通过：按仓库隔离并恢复提交草稿');
 await page.getByRole('button',{name:'＋ 全部暂存',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#stagedCount').textContent.startsWith('1'));await settled();
 await page.locator('#commit').click();await page.locator('#reviewDialog').waitFor({state:'visible'});
 // The review binds an index token; changes after opening must be rejected.
 fs.writeFileSync(path.join(repo,'a.txt'),'base\nnew staged bytes\n');git(repo,'add','.');await page.locator('#reviewConfirm').click();
 await page.waitForFunction(()=>document.querySelector('#reviewFeedback').textContent.includes('提交失败'));
 assert.equal(git(repo,'rev-list','--count','HEAD').trim(),'1');assert.equal(await page.locator('#commitMessage').inputValue(),'草稿 A');await page.locator('#reviewCancel').click();await settled();
 const hook=path.join(repo,'.git','hooks','pre-commit');fs.writeFileSync(hook,'#!/bin/sh\necho WORKFLOW_HOOK_REJECT >&2\nexit 1\n',{mode:0o755});
 await page.locator('#refresh').click();await settled();await page.locator('#commit').click();await page.locator('#reviewDialog').waitFor({state:'visible'});await page.locator('#reviewConfirm').click();
 await page.waitForFunction(()=>document.querySelector('#reviewFeedback').textContent.includes('WORKFLOW_HOOK_REJECT'));assert.equal(await page.locator('#commitMessage').inputValue(),'草稿 A');await page.locator('#reviewCancel').click();fs.unlinkSync(hook);console.log('通过：过期审阅拒绝、hook原始错误反馈、失败保留草稿');
 await settled();await page.locator('#commit').click();await page.locator('#reviewDialog').waitFor({state:'visible'});await page.locator('#reviewConfirm').click();await page.waitForFunction(()=>!document.querySelector('#reviewDialog').open&&document.querySelector('#commitMessage').value==='');assert.equal(git(repo,'rev-list','--count','HEAD').trim(),'2');
 // Destructive rollback creates a record; UI restore preserves index and takes another backup.
 fs.writeFileSync(path.join(repo,'a.txt'),'backup original bytes\r\n中文\n');await page.locator('#refresh').click();await settled();await page.waitForFunction(()=>document.querySelector('#items .group-label')?.textContent.includes('未暂存'));await page.locator('#items .item').first().click();await page.getByRole('button',{name:'恢复文件修改…',exact:true}).waitFor();await page.getByRole('button',{name:'恢复文件修改…',exact:true}).click();await page.locator('#modalConfirm').click();await settled();await page.waitForFunction(()=>!document.querySelector('#modal').open);await page.locator('#recoveryOpen').click();await page.locator('#recoveryDialog').waitFor({state:'visible'});await page.locator('#recoveryRows button').first().click();await page.waitForFunction(()=>!document.querySelector('#recoveryRestore').disabled);assert.match(await page.locator('#recoveryContent').textContent(),/backup original bytes/);const index=git(repo,'ls-files','--stage');await page.locator('#recoveryRestore').click();await page.locator('#modalConfirm').click();await page.locator('#recoveryDialog').waitFor({state:'visible'});assert.equal(fs.readFileSync(path.join(repo,'a.txt'),'utf8'),'backup original bytes\r\n中文\n');assert.equal(git(repo,'ls-files','--stage'),index);assert.equal(await page.locator('#recoveryRows button').count(),2);
 await page.locator('#recoveryClear').click();await page.locator('#modalConfirm').click();await page.locator('#recoveryDialog').waitFor({state:'visible'});assert.equal(await page.locator('#recoveryRows button').count(),0);assert.match(await page.locator('#recoveryRows').textContent(),/暂无恢复记录/);console.log('通过：回退前备份、记录预览、完整字节恢复、index隔离、恢复前再备份和手动清空');
 assert.deepEqual(errors,[]);console.log('工作流专项真实Electron测试全部通过；无页面异常。');
 }finally{if(app)await app.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
