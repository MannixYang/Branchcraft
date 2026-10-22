// Only skip compilation when the target ships the complete N-API prebuild.
const fs=require('node:fs'),path=require('node:path');
function hasPrebuild(platform,arch){
 const root=path.dirname(require.resolve('node-pty/package.json'));
 const names=platform==='win32'?['conpty.node','conpty_console_list.node']:platform==='darwin'?['pty.node','spawn-helper']:[];
 return names.length>0&&names.every(name=>fs.existsSync(path.join(root,'prebuilds',`${platform}-${arch}`,name)));
}
module.exports={hasPrebuild};
