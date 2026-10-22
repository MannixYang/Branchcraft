const {app,BrowserWindow,ipcMain,dialog,shell,Menu}=require('electron');
const {GitService}=require('./git-service');const fs=require('node:fs/promises');const path=require('node:path');
const {ProjectService}=require('./project-service');
let project;let win,service;let recent=[];
const store=()=>path.join(app.getPath('userData'),'repositories.json');
async function openRepo(folder){const candidate=new GitService(folder);const root=(await candidate.git(['rev-parse','--show-toplevel'])).trim();service=new GitService(root);project=new ProjectService(root);recent=[root,...recent.filter(x=>x!==root)].slice(0,12);await fs.writeFile(store(),JSON.stringify(recent));return service.snapshot();}
function register(name,fn){ipcMain.handle(name,async(event,...args)=>{if(!win||event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw Error('不可信来源');try{return {ok:true,data:await fn(...args)};}catch(error){return {ok:false,error:error.message};}});}
async function createWindow(){
 win=new BrowserWindow({width:1480,height:940,minWidth:1080,minHeight:700,backgroundColor:'#101417',title:'Branchcraft · Git 工作台',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});win.setMenuBarVisibility(false);
 win.webContents.setWindowOpenHandler(({url})=>{if(url==='https://deerflow.tech/')shell.openExternal(url);return {action:'deny'};});win.webContents.on('will-navigate',event=>event.preventDefault());
 win.on('closed',()=>{win=null;});
 await win.loadFile(path.join(__dirname,'index.html'));
}
app.whenReady().then(async()=>{
 if(process.platform==='darwin')Menu.setApplicationMenu(Menu.buildFromTemplate([
  {role:'appMenu'},{label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
  {label:'视图',submenu:[{role:'reload'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]}, {role:'windowMenu'}
 ]));

 try{const saved=JSON.parse(await fs.readFile(store(),'utf8'));recent=Array.isArray(saved)?saved.filter(x=>typeof x==='string'):[];}catch{}
 register('recent',()=>recent);register('choose',async()=>{const r=await dialog.showOpenDialog(win,{title:'选择 Git 仓库目录',properties:['openDirectory']});return r.canceled?null:openRepo(r.filePaths[0]);});register('open',folder=>{if(!recent.includes(folder))throw Error('请通过目录选择器打开仓库');return openRepo(folder);});
 const repo=()=>{if(!service)throw Error('请先打开仓库');return service;};
 for(const method of ['tree','read','save','diff'])register('project'+method[0].toUpperCase()+method.slice(1),arg=>{repo();return project[method](arg);});
 register('rollbackPreview',file=>repo().rollbackPreview(file));register('rollback',args=>repo().rollback(args));register('snapshot',()=>repo().snapshot());register('diff',args=>repo().diff(args));register('action',(action,args)=>repo().mutate(action,args));register('conflict',file=>repo().conflict(file));register('resolve',args=>repo().resolve(args));register('stashHash',ref=>repo().stashHash(ref));register('reveal',()=>shell.openPath(repo().repo));
 await createWindow();
 app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
