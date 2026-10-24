// Only skip compilation when the target ships the complete N-API prebuild.
const fs=require('node:fs'),path=require('node:path');
const ptyRoot=()=>path.dirname(require.resolve('node-pty/package.json'));
function hasPrebuild(platform,arch,root=ptyRoot()){
 const names=platform==='win32'?['conpty.node','conpty_console_list.node']:platform==='darwin'?['pty.node','spawn-helper']:[];
 return names.length>0&&names.every(name=>fs.existsSync(path.join(root,'prebuilds',`${platform}-${arch}`,name)));
}
function preparePrebuild(platform,arch,root=ptyRoot()){
 if(!hasPrebuild(platform,arch,root))return false;
 // node-pty 1.1.0 publishes Darwin spawn-helper as 0644. macOS calls it
 // through posix_spawn, so fix the executable bits before source tests AND
 // dependency collection for packaging. Keep hasPrebuild a read-only query.
 if(platform==='darwin'&&process.platform!=='win32'){
  const helper=path.join(root,'prebuilds',`${platform}-${arch}`,'spawn-helper');
  fs.chmodSync(helper,(fs.statSync(helper).mode&0o777)|0o111);
  fs.accessSync(helper,fs.constants.X_OK);
 }
 return true;
}
module.exports={hasPrebuild,preparePrebuild};
