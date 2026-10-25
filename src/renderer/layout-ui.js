'use strict';
(()=>{
 const storageKey='branchcraft.layout.v1';let saved={};
 try{saved=JSON.parse(localStorage.getItem(storageKey)||'{}')||{};if(typeof saved!=='object'||Array.isArray(saved))saved={};}catch{}
 const entries=new Map();let scheduled=false;
 const width=node=>node.getBoundingClientRect().width;
 const contentWidth=node=>{const style=getComputedStyle(node);return width(node)-parseFloat(style.borderLeftWidth)-parseFloat(style.borderRightWidth)-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);};
 function persist(key,value){saved[key]=value;try{localStorage.setItem(storageKey,JSON.stringify(saved));}catch{}}
 function attach(key,node,side,bounds,initial){
  if(!node||entries.get(key)?.node===node)return;
  const old=entries.get(key);if(old){old.observer.disconnect();old.handle.remove();}
  const handle=document.createElement('div');handle.className='panel-splitter splitter-'+side;handle.tabIndex=0;
  handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');
  handle.setAttribute('aria-label',({sidebar:'侧栏宽度',list:'文件列表宽度',terminal:'终端宽度',editor:'代码与差异分隔'})[key]);
  handle.title='拖拽调整 · 方向键微调 · Home/End 最小/最大 · 双击重置';node.classList.add('resizable-panel');node.append(handle);
  let preferred=Number.isFinite(saved[key])?saved[key]:initial(),drag=null;
  function apply(value,remember=false){const [min,max]=bounds();if(max<=0)return;const next=Math.max(Math.ceil(Math.min(min,max)),Math.min(Math.floor(max),Math.round(value)));const basis=next+'px';if(node.style.width!==basis)node.style.width=basis;if(node.style.flexBasis!==basis)node.style.flex='0 0 '+basis;handle.setAttribute('aria-valuemin',String(Math.min(min,max)));handle.setAttribute('aria-valuemax',String(Math.floor(max)));handle.setAttribute('aria-valuenow',String(next));if(remember){preferred=next;persist(key,next);}}
  handle.onpointerdown=e=>{if(e.button!==0||drag)return;e.preventDefault();drag={x:e.clientX,start:width(node),id:e.pointerId};handle.setPointerCapture(e.pointerId);document.body.classList.add('panel-resizing');};
  handle.onpointermove=e=>{if(drag&&e.pointerId===drag.id&&(e.buttons&1))apply(drag.start+(e.clientX-drag.x)*(side==='left'?-1:1),true);};
  function finish(event){if(event&&drag&&event.pointerId!==drag.id)return;drag=null;document.body.classList.remove('panel-resizing');}
  handle.onpointerup=finish;handle.onpointercancel=finish;handle.onlostpointercapture=finish;
  handle.onkeydown=e=>{const [min,max]=bounds();let next=width(node);const delta=(e.shiftKey?40:10)*(side==='left'?-1:1);if(e.key==='ArrowLeft')next-=delta;else if(e.key==='ArrowRight')next+=delta;else if(e.key==='Home')next=min;else if(e.key==='End')next=max;else return;e.preventDefault();apply(next,true);};
  handle.ondblclick=()=>apply(initial(),true);
  const observer=new ResizeObserver(()=>request());observer.observe(node.parentElement);
  entries.set(key,{node,handle,observer,apply:()=>apply(preferred)});apply(preferred);
 }
 function update(){scheduled=false;const workspace=document.querySelector('.workspace'),terminal=document.getElementById('terminalPanel');if(!workspace)return;
  attach('sidebar',document.querySelector('.sidebar'),'right',()=>[180,Math.min(400,innerWidth-760)],()=>240);
  attach('terminal',terminal,'left',()=>[220,Math.max(220,contentWidth(workspace)-(document.body.classList.contains('graph-view')?480:(entries.get('list')?width(entries.get('list').node):320)+240))],()=>340);
  attach('list',document.querySelector('.list-panel'),'right',()=>[180,Math.max(180,contentWidth(workspace)-(terminal.classList.contains('hidden')?0:width(terminal))-240)],()=>320);
  const left=document.querySelector('.editor-left');if(left)attach('editor',left,'right',()=>[120,Math.max(120,width(left.parentElement)-120)],()=>width(left.parentElement)/2);
  for(const [key,entry] of entries){if(!entry.node.isConnected){entry.observer.disconnect();entries.delete(key);}else{entry.apply();if(key==='list'){const hidden=document.body.classList.contains('graph-view');if(entry.handle.classList.contains('hidden')!==hidden)entry.handle.classList.toggle('hidden',hidden);}if(key==='editor'){const hidden=document.getElementById('editorDiff')?.classList.contains('hidden')??true;if(entry.handle.classList.contains('hidden')!==hidden)entry.handle.classList.toggle('hidden',hidden);entry.node.style.flex=hidden?'1 1 0px':'0 0 '+entry.node.style.width;}}}
 }
 function request(){if(!scheduled){scheduled=true;requestAnimationFrame(update);}}
 new MutationObserver(request).observe(document.querySelector('.workspace'),{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
 new MutationObserver(request).observe(document.body,{attributes:true,attributeFilter:['class']});
 window.addEventListener('resize',request);update();
})();

// Height preferences are independent from the established width splitters.
(()=>{
 const key='branchcraft.heights.v1';let saved={};
 try{const value=JSON.parse(localStorage.getItem(key)||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))saved=value;}catch{}
 const entries=new Map();let scheduled=false;
 const height=node=>node.getBoundingClientRect().height;
 function request(){if(!scheduled){scheduled=true;requestAnimationFrame(()=>{scheduled=false;update();});}}
 function attach(id,node,label,side,bounds,initial,floating=false){
  if(!node)return;
  const existing=entries.get(id);
  if(existing?.node===node&&existing.handle.isConnected)return;
  if(existing){existing.finish();existing.handle.remove();entries.delete(id);}
  const handle=document.createElement('div');handle.className='height-splitter'+(floating?' height-floating height-'+side:'');handle.tabIndex=0;
  handle.dataset.height=id;handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','horizontal');handle.setAttribute('aria-label',label);
  if(node.id)handle.setAttribute('aria-controls',node.id);
  handle.title='上下拖动调整高度 · ↑/↓ 微调 · Shift 加速 · Home/End 最小/最大 · 双击重置';
  if(floating){node.classList.add('height-resizable');node.append(handle);node.style.alignSelf=side==='top'?'flex-end':'flex-start';}
  else if(side==='top')node.before(handle);else node.after(handle);
  node.classList.add('height-managed');
  let preferred=Number.isFinite(saved[id])?saved[id]:null,drag=null;
  function apply(value,remember=false){
   if(!node.getClientRects().length||getComputedStyle(node).display==='none'){handle.hidden=true;return;}
   handle.hidden=false;const raw=bounds(),max=Math.max(0,Math.floor(raw[1])),min=Math.min(max,Math.ceil(raw[0]));
   const next=Math.max(min,Math.min(max,Math.round(value)));const size=next+'px';
   if(node.style.height!==size)node.style.height=size;
   if(!floating&&node.style.flexBasis!==size)node.style.flex='0 0 '+size;
   handle.setAttribute('aria-valuemin',String(min));handle.setAttribute('aria-valuemax',String(max));handle.setAttribute('aria-valuenow',String(next));
   if(remember){preferred=next;saved[id]=next;try{localStorage.setItem(key,JSON.stringify(saved));}catch{}}
  }
  function finish(event){if(event&&drag&&event.pointerId!==drag.id)return;drag=null;document.body.classList.remove('height-resizing');}
  handle.addEventListener('pointerdown',event=>{if(event.button!==0||drag)return;event.preventDefault();handle.focus({preventScroll:true});drag={id:event.pointerId,y:event.clientY,size:height(node)};handle.setPointerCapture(event.pointerId);document.body.classList.add('height-resizing');});
  handle.addEventListener('pointermove',event=>{if(drag&&event.pointerId===drag.id&&(event.buttons&1))apply(drag.size+(event.clientY-drag.y)*(side==='top'?-1:1),true);});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(name,finish);
  handle.addEventListener('keydown',event=>{const step=event.shiftKey?40:10;let value;
   if(event.key==='ArrowUp'||event.key==='ArrowDown')value=height(node)+(event.key==='ArrowDown'?1:-1)*(side==='top'?-1:1)*step;
   else if(event.key==='Home')value=bounds()[0];else if(event.key==='End')value=bounds()[1];else return;
   event.preventDefault();apply(value,true);
  });
  handle.addEventListener('dblclick',()=>{preferred=null;delete saved[id];try{localStorage.setItem(key,JSON.stringify(saved));}catch{}apply(initial());});
  entries.set(id,{node,handle,finish,apply:()=>apply(preferred??initial())});
 }
 function update(){
  for(const [id,entry]of entries)if(!entry.node.isConnected){entry.finish();entry.handle.remove();entries.delete(id);}
  const workspace=document.querySelector('.workspace');if(!workspace)return;
  const stackMax=(node,reserve)=>()=>[40,Math.max(40,height(node.parentElement)-reserve)];
  const recent=document.querySelector('#recent');attach('recent',recent,'最近仓库高度','bottom',()=>[30,Math.min(180,innerHeight*.24)],()=>70);
  for(const [id,label]of [['branches','本地分支高度'],['remoteBranches','远程分支高度']]){
   const node=document.getElementById(id);attach(id,node,label,'bottom',()=>[32,Math.min(300,innerHeight*.3)],()=>Math.min(130,innerHeight*.16));
  }
  const commit=document.querySelector('#commitBox');if(commit)attach('commit',commit,'提交区域高度','top',stackMax(commit,155),()=>158);
  const inspector=document.querySelector('#graphInspector');if(inspector)attach('graphInspector',inspector,'提交详情高度','top',stackMax(inspector,155),()=>height(inspector.parentElement)*.46);
  const info=document.querySelector('#graphInfo');if(info)attach('graphInfo',info,'提交说明高度','bottom',stackMax(info,90),()=>85);
  const terminal=document.querySelector('#terminalPanel');attach('terminalHeight',terminal,'终端高度','top',()=>[120,height(workspace)-2],()=>height(workspace)-2,true);
  const detail=document.querySelector('.detail-panel');attach('detailHeight',detail,'文件详情高度','bottom',()=>[120,height(workspace)-2],()=>height(workspace)-2,true);
  for(const entry of entries.values())entry.apply();
 }
 const observer=new MutationObserver(request);observer.observe(document.querySelector('.workspace'),{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
 observer.observe(document.querySelector('.sidebar'),{childList:true,subtree:true});
 const sizes=new ResizeObserver(request);sizes.observe(document.querySelector('.workspace'));sizes.observe(document.querySelector('.sidebar'));
 window.addEventListener('resize',request);update();
})();
