const {hasPrebuild}=require('./native-policy.cjs');
const {spawnSync}=require('node:child_process');
if(hasPrebuild(process.platform,process.env.npm_config_arch||process.arch)){
 console.log('node-pty: using target N-API prebuild; no forced source rebuild');
}else{
 const cli=require.resolve('electron-builder/cli.js');
 const result=spawnSync(process.execPath,[cli,'install-app-deps'],{stdio:'inherit'});
 if(result.error)throw result.error;
 process.exitCode=result.status??1;
}
