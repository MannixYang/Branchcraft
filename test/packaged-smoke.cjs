const path=require('node:path');
const fs=require('node:fs');
const folder=process.platform==='win32'?'win-unpacked':process.platform==='linux'?'linux-unpacked':process.arch==='arm64'?'mac-arm64':'mac';
const binary=process.platform==='win32'?'Branchcraft.exe':process.platform==='linux'?'branchcraft':'Branchcraft.app/Contents/MacOS/Branchcraft';
const exe=path.resolve(__dirname,'../release',folder,binary);
if(!fs.existsSync(exe))throw Error('打包程序不存在：'+exe);
process.env.BRANCHCRAFT_EXE=exe;
process.env.BRANCHCRAFT_OUTPUT ||= path.resolve(__dirname,'../screenshots/packaged');
require('./desktop-smoke.cjs');
