const {app,BrowserWindow,ipcMain,dialog,shell,Menu}=require('electron');
const {GitService}=require('./git-service');const fs=require('node:fs/promises');const path=require('node:path');
const {GraphService}=require('./graph-service');
const {ProjectService}=require('./project-service');
const {ConfigService}=require('./config-service');
const {TerminalService}=require('./terminal-service');
const {registerTerminalClipboard}=require('./terminal-clipboard');
const {RepositoryWatcher}=require('./repo-watcher');
let watcher,openGeneration=0,watchEpoch=0,watchClosing=Promise.resolve();
function stopWatcher(){watchEpoch++;const previous=watcher;watcher=null;watchClosing=watchClosing.then(()=>previous?.close()).catch(e=>console.error('关闭仓库监听失败',e));return watchClosing;}
async function startWatcher(){const closed=stopWatcher(),epoch=watchEpoch;await closed;if(epoch!==watchEpoch||!service||!win||win.isDestroyed())return;const current=service;watcher=new RepositoryWatcher(current.repo,{ignore:[path.join(app.getPath('userData'),'recovery')],onChange:event=>{if(epoch===watchEpoch&&service===current&&win&&!win.isDestroyed()&&!win.webContents.isDestroyed())win.webContents.send('repositoryChanged',event);}});}
let terminal,terminalSession;
function resetTerminal(){if(terminal)terminal.dispose();terminalSession=null;terminal=new TerminalService({onData:event=>win?.webContents.send('terminalData',event),onExit:event=>{terminalSession=null;win?.webContents.send('terminalExit',event);}});}
let project;let win,service;let recent=[];
const store=()=>path.join(app.getPath('userData'),'repositories.json');
async function openRepo(folder){const generation=++openGeneration;const candidate=new GitService(folder);const root=(await candidate.git(['rev-parse','--show-toplevel'])).trim();const next=new GitService(root,{recoveryDir:path.join(app.getPath('userData'),'recovery')});const snapshot=await next.snapshot();if(generation!==openGeneration)throw Error('仓库打开请求已被替换');await stopWatcher();if(generation!==openGeneration)throw Error('仓库打开请求已被替换');resetTerminal();service=next;project=new ProjectService(root);startWatcher();recent=[root,...recent.filter(x=>x!==root)].slice(0,12);await fs.writeFile(store(),JSON.stringify(recent));return snapshot;}
function register(name,fn){ipcMain.handle(name,async(event,...args)=>{if(!win||event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw Error('不可信来源');try{return {ok:true,data:await fn(...args)};}catch(error){return {ok:false,error:error.message};}});}
async function createWindow(){
 win=new BrowserWindow({width:1480,height:940,minWidth:1080,minHeight:700,backgroundColor:'#101417',title:'Branchcraft · Git 工作台',webPreferences:{preload:path.join(__dirname,'../preload/index.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});win.setMenuBarVisibility(false);
 win.webContents.setWindowOpenHandler(({url})=>{if(url==='https://deerflow.tech/')shell.openExternal(url);return {action:'deny'};});win.webContents.on('will-navigate',event=>event.preventDefault());
 win.webContents.on('render-process-gone',()=>{stopWatcher();resetTerminal();});
 win.webContents.on('did-start-loading',()=>{stopWatcher();resetTerminal();});
 win.webContents.on('did-finish-load',()=>startWatcher());
 win.on('closed',()=>{openGeneration++;stopWatcher();if(terminal)terminal.dispose();terminalSession=null;win=null;});
 await win.loadFile(path.join(__dirname,'../renderer/index.html'));
}
app.whenReady().then(async()=>{
 registerTerminalClipboard({register,getWindow:()=>win});
 for(const method of ['rollbackAllPreview','rollbackAll'])register(method,arg=>repo()[method](arg));
 if(process.platform==='darwin')Menu.setApplicationMenu(Menu.buildFromTemplate([
  {role:'appMenu'},{label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
  {label:'视图',submenu:[{role:'reload'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]}, {role:'windowMenu'}
 ]));

 try{const saved=JSON.parse(await fs.readFile(store(),'utf8'));recent=Array.isArray(saved)?saved.filter(x=>typeof x==='string'):[];}catch{}
 register('recent',()=>recent);register('choose',async()=>{const r=await dialog.showOpenDialog(win,{title:'选择 Git 仓库目录',properties:['openDirectory']});return r.canceled?null:openRepo(r.filePaths[0]);});register('open',folder=>{if(!recent.includes(folder))throw Error('请通过目录选择器打开仓库');return openRepo(folder);});
 resetTerminal();
 const repo=()=>{if(!service)throw Error('请先打开仓库');return service;};
 register('terminalOpen',()=>{const r=repo();if(!terminalSession)terminalSession=terminal.open(r.repo);return terminalSession;});
 register('terminalWrite',(id,data)=>terminal.write(id,data));register('terminalResize',(id,cols,rows)=>terminal.resize(id,cols,rows));register('terminalClose',id=>{terminal.close(id);terminalSession=null;});
 for(const method of ['tree','read','save','diff'])register('project'+method[0].toUpperCase()+method.slice(1),arg=>{repo();return project[method](arg);});
 register('configList',scope=>new ConfigService(repo().repo).list(scope));
 register('configSet',input=>new ConfigService(repo().repo).set(input));
 register('configUnset',input=>new ConfigService(repo().repo).unset(input));
 for(const method of ['graphLog','graphCommit'])register(method,arg=>{const current=repo();return new GraphService(current)[method](arg);});
 register('commitPreview',()=>repo().commitPreview());
 for(const method of ['recoveryList','recoveryClear','recoveryPreview','recoveryRestore'])register(method,arg=>repo()[method](arg));
 register('rollbackPreview',file=>repo().rollbackPreview(file));register('rollback',args=>repo().rollback(args));register('snapshot',()=>repo().snapshot());register('diff',args=>repo().diff(args));register('action',(action,args)=>repo().mutate(action,args));register('mergePreview',name=>repo().mergePreview(name));register('conflict',file=>repo().conflict(file));register('resolve',args=>repo().resolve(args));register('stashHash',ref=>repo().stashHash(ref));register('reveal',()=>shell.openPath(repo().repo));
 await createWindow();
 app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});

app.on('before-quit',()=>{openGeneration++;stopWatcher();terminal?.dispose();});
