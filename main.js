const {app,BrowserWindow,ipcMain,dialog,shell}=require('electron');
const {GitService}=require('./git-service');const fs=require('node:fs/promises');const path=require('node:path');
let win,service;let recent=[];
const store=()=>path.join(app.getPath('userData'),'repositories.json');
async function openRepo(folder){const candidate=new GitService(folder);const root=(await candidate.git(['rev-parse','--show-toplevel'])).trim();service=new GitService(root);recent=[root,...recent.filter(x=>x!==root)].slice(0,12);await fs.writeFile(store(),JSON.stringify(recent));return service.snapshot();}
function register(name,fn){ipcMain.handle(name,async(event,...args)=>{if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw Error('不可信来源');try{return {ok:true,data:await fn(...args)};}catch(error){return {ok:false,error:error.message};}});}
app.whenReady().then(async()=>{
 try{const saved=JSON.parse(await fs.readFile(store(),'utf8'));recent=Array.isArray(saved)?saved.filter(x=>typeof x==='string'):[];}catch{}
 win=new BrowserWindow({width:1480,height:940,minWidth:1080,minHeight:700,backgroundColor:'#101417',title:'Branchcraft · Git 工作台',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});win.setMenuBarVisibility(false);
 win.webContents.setWindowOpenHandler(({url})=>{if(url==='https://deerflow.tech/')shell.openExternal(url);return {action:'deny'};});win.webContents.on('will-navigate',event=>event.preventDefault());
 register('recent',()=>recent);register('choose',async()=>{const r=await dialog.showOpenDialog(win,{title:'选择 Git 仓库目录',properties:['openDirectory']});return r.canceled?null:openRepo(r.filePaths[0]);});register('open',folder=>{if(!recent.includes(folder))throw Error('请通过目录选择器打开仓库');return openRepo(folder);});
 const repo=()=>{if(!service)throw Error('请先打开仓库');return service;};
 register('snapshot',()=>repo().snapshot());register('diff',args=>repo().diff(args));register('action',(action,args)=>repo().mutate(action,args));register('conflict',file=>repo().conflict(file));register('resolve',args=>repo().resolve(args));register('stashHash',ref=>repo().stashHash(ref));register('reveal',()=>shell.openPath(repo().repo));
 await win.loadFile('index.html');
});app.on('window-all-closed',()=>app.quit());
