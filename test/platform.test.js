const {test}=require('node:test');
const assert=require('node:assert/strict');
const {gitEnvironment,gitExecutable}=require('../platform');
test('平台 Git 环境保留原有配置且无 shell 调用',()=>{
 const original={PATH:'/custom',SSH_AUTH_SOCK:'agent'};
 const env=gitEnvironment(original,'darwin');
 assert.ok(env.PATH.includes('/opt/homebrew/bin'));assert.equal(env.SSH_AUTH_SOCK,'agent');assert.equal(original.PATH,'/custom');
 assert.equal(gitEnvironment({PATH:'native'},'win32').PATH,'native');
 assert.ok(gitEnvironment({},'linux').PATH.includes('/usr/bin'));
 assert.equal(gitExecutable({}),'git');assert.throws(()=>gitExecutable({BRANCHCRAFT_GIT:'relative/git'}));
});
test('显式 Git 可执行文件路径可用于带空格路径',()=>{assert.equal(gitExecutable({BRANCHCRAFT_GIT:process.execPath}),process.execPath);});
