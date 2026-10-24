// Preserve dependency collection: beforeBuild=false suppresses it in builder 26.
// Disable only forced compilation, and only for complete target N-API prebuilds.
const {preparePrebuild}=require('./native-policy.cjs');
const {spawnSync}=require('node:child_process');
const args=process.argv.slice(2);
const platform=args.includes('--win')?'win32':args.includes('--linux')?'linux':args.includes('--mac')?'darwin':process.platform;
const arches=['x64','arm64','ia32','armv7l'].filter(arch=>args.includes('--'+arch));
if(!arches.length)arches.push(...(args.includes('--mac')?['x64','arm64']:[process.arch]));
if(arches.every(arch=>preparePrebuild(platform,arch))){
 console.log('使用完整目标 N-API 预构建，保留依赖收集，跳过强制重编译:',platform,arches.join(','));
 args.push('-c.npmRebuild=false');
}
const result=spawnSync(process.execPath,[require.resolve('electron-builder/cli.js'),...args],{stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
