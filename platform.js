"use strict";
const path = require('node:path');
const fs = require('node:fs');
// GUI apps on macOS/Linux often inherit a smaller PATH than terminals.
function gitEnvironment(env=process.env, platform=process.platform, home=require('node:os').homedir()) {
 const result={...env};
 if(platform!=='win32') {
  const extra=platform==='darwin'?['/opt/homebrew/bin','/usr/local/bin','/usr/bin','/bin']:['/usr/local/bin','/usr/bin','/bin',path.join(home,'.local/bin')];
  result.PATH=[...new Set([...(env.PATH||'').split(path.delimiter).filter(Boolean),...extra])].join(path.delimiter);
 }
 return result;
}
function gitExecutable(env=process.env) {
 const custom=env.BRANCHCRAFT_GIT;
 if(custom) {
  if(!path.isAbsolute(custom)||!fs.statSync(custom).isFile())throw Error('BRANCHCRAFT_GIT 必须为 Git 可执行文件的绝对路径');
  return custom;
 }
 return 'git';
}
module.exports={gitEnvironment,gitExecutable};
