'use strict';
(()=>{
 const api=window.gitdesk,panel=document.querySelector('#terminalPanel'),host=document.querySelector('#terminalHost'),toggle=document.querySelector('#toggleTerminal'),status=document.querySelector('#terminalState');
 let term,fit,id=null,opening=null,generation=0,visible=false,pending=[],pendingExits=[],disposed=false,restarting=false;
 function state(text){status.textContent=text;}
 function create(){if(term)return;term=new Terminal({cursorBlink:true,fontSize:12,fontFamily:'Consolas, monospace',scrollback:5000,theme:{background:'#101417',foreground:'#e2ebe9',cursor:'#b7ed91'},allowProposedApi:false});fit=new FitAddon.FitAddon();term.loadAddon(fit);term.open(host);term.onData(data=>{if(id)api.terminalWrite(id,data).catch(e=>state(e.message));});term.attachCustomKeyEventHandler(e=>!(e.ctrlKey&&e.shiftKey&&(e.code==='KeyC'||e.code==='KeyV')));}
 async function resize(){if(!visible||!term||!host.clientWidth||!host.clientHeight)return;fit.fit();if(id)try{await api.terminalResize(id,Math.min(500,term.cols),Math.min(300,term.rows));}catch(e){state(e.message);}}
 async function open(){if(id)return;if(opening)return opening;const seq=generation;state('启动中…');opening=(async()=>{try{const session=await api.terminalOpen();if(seq!==generation||disposed)return;id=session.id;for(const event of pending)if(event.id===id)term.write(event.data);pending=[];const exited=pendingExits.find(event=>event.id===id);pendingExits=[];if(exited){finishExit(exited);return;}state('运行中 · 隐藏不退出');await resize();}catch(e){if(seq===generation)state(e.message);}finally{if(seq===generation)opening=null;}})();return opening;}
 async function show(){visible=true;panel.classList.remove('hidden');toggle.setAttribute('aria-expanded','true');create();await open();await resize();term.focus();}
 function hide(){visible=false;panel.classList.add('hidden');toggle.setAttribute('aria-expanded','false');}
 function reset(){generation++;id=null;opening=null;pending=[];pendingExits=[];term?.reset();state('未启动');if(visible)open();}
 const unsubscribeData=api.onTerminalData(event=>{if(event.id===id)term.write(event.data);else if(opening){pending.push(event);if(pending.length>200)pending.shift();}});
 function finishExit(event){id=null;state('已退出 · 可重启');term.writeln('\r\n[Shell 已退出，代码 '+event.exitCode+']');}
 const unsubscribeExit=api.onTerminalExit(event=>{if(event.id===id)finishExit(event);else if(opening){pendingExits.push(event);if(pendingExits.length>20)pendingExits.shift();}});
 toggle.addEventListener('click',()=>visible?hide():show());document.querySelector('#hideTerminal').addEventListener('click',hide);
 document.querySelector('#restartTerminal').addEventListener('click',async()=>{if(restarting||!window.confirm('终止当前 Shell 及正在执行的任务，并启动新会话？'))return;restarting=true;const seq=generation;try{if(opening)await opening;if(seq!==generation)return;const old=id;generation++;id=null;opening=null;if(old)await api.terminalClose(old);if(generation!==seq+1)return;reset();if(!visible)await show();}catch(e){state(e.message);}finally{restarting=false;}});
 const observer=new ResizeObserver(()=>resize());observer.observe(host);window.addEventListener('unload',()=>{disposed=true;unsubscribeData();unsubscribeExit();observer.disconnect();});window.terminalPanel={reset};
})();
