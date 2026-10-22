const {contextBridge,ipcRenderer}=require('electron');
const invoke=async(name,...args)=>{const result=await ipcRenderer.invoke(name,...args);if(!result.ok)throw Error(result.error);return result.data;};
contextBridge.exposeInMainWorld('gitdesk',Object.fromEntries(['rollbackPreview','rollback','recent','choose','open','snapshot','diff','action','conflict','resolve','stashHash','reveal'].map(name=>[name,(...args)=>invoke(name,...args)])));
