const {test}=require('node:test');
const assert=require('node:assert/strict');
const {gitEnvironment,gitExecutable}=require('../src/main/platform');
test('平台 Git 环境保留原有配置且无 shell 调用',()=>{
 const original={PATH:'/custom',SSH_AUTH_SOCK:'agent'};
 const env=gitEnvironment(original,'darwin');
 assert.ok(env.PATH.includes('/opt/homebrew/bin'));assert.equal(env.SSH_AUTH_SOCK,'agent');assert.equal(original.PATH,'/custom');
 assert.equal(gitEnvironment({PATH:'native'},'win32').PATH,'native');
 assert.ok(gitEnvironment({},'linux').PATH.includes('/usr/bin'));
 assert.equal(gitExecutable({}),'git');assert.throws(()=>gitExecutable({BRANCHCRAFT_GIT:'relative/git'}));
});
test('显式 Git 可执行文件路径可用于带空格路径',()=>{assert.equal(gitExecutable({BRANCHCRAFT_GIT:process.execPath}),process.execPath);});

const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {hasPrebuild,preparePrebuild}=require('../scripts/native-policy.cjs');
test('预构建策略拒绝不完整及未知平台，检查操作保持只读',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'branchcraft-native-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,'prebuilds','darwin-arm64');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'pty.node'),'fixture');
 assert.equal(hasPrebuild('darwin','arm64',root),false);
 assert.equal(preparePrebuild('darwin','arm64',root),false);
 fs.writeFileSync(path.join(dir,'spawn-helper'),'fixture',{mode:0o644});
 assert.equal(hasPrebuild('darwin','arm64',root),true);
 assert.equal(hasPrebuild('darwin','x64',root),false);
 assert.equal(hasPrebuild('linux','arm64',root),false);
 if(process.platform!=='win32')assert.equal(fs.statSync(path.join(dir,'spawn-helper')).mode&0o777,0o644);
});
test('macOS 两种架构的 helper 在安装及打包前获得执行权限且重复运行安全',{skip:process.platform==='win32'},t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'branchcraft-native-mode-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const arch of ['x64','arm64']){
  const dir=path.join(root,'prebuilds',`darwin-${arch}`);fs.mkdirSync(dir,{recursive:true});
  const helper=path.join(dir,'spawn-helper');fs.writeFileSync(path.join(dir,'pty.node'),'fixture');
  fs.writeFileSync(helper,'#!/bin/sh\nexit 0\n');fs.chmodSync(helper,0o644);
  assert.equal(preparePrebuild('darwin',arch,root),true);
  assert.equal(fs.statSync(helper).mode&0o777,0o755);fs.accessSync(helper,fs.constants.X_OK);
  assert.equal(require('node:child_process').spawnSync(helper).status,0);
  assert.equal(preparePrebuild('darwin',arch,root),true);
  assert.equal(fs.statSync(helper).mode&0o777,0o755);
 }
});
