'use strict';
(()=>{
 const storageKey='branchcraft.layout.v1';let saved={};
 try{saved=JSON.parse(localStorage.getItem(storageKey)||'{}')||{};if(typeof saved!=='object'||Array.isArray(saved))saved={};}catch{}
 const entries=new Map();let scheduled=false;
 const width=node=>node.getBoundingClientRect().width;
 function persist(key,value){saved[key]=value;try{localStorage.setItem(storageKey,JSON.stringify(saved));}catch{}}
 function attach(key,node,side,bounds,initial){
  if(!node||entries.get(key)?.node===node)return;
  const old=entries.get(key);if(old){old.observer.disconnect();old.handle.remove();}
  const handle=document.createElement('div');handle.className='panel-splitter splitter-'+side;handle.tabIndex=0;
  handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');
  handle.setAttribute('aria-label',({sidebar:'侧栏宽度',list:'文件列表宽度',terminal:'终端宽度',editor:'代码与差异分隔'})[key]);
  handle.title='拖拽调整 · 方向键微调 · Home/End 最小/最大 · 双击重置';node.classList.add('resizable-panel');node.append(handle);
  let preferred=Number.isFinite(saved[key])?saved[key]:initial(),drag=null;
  function apply(value,remember=false){const [min,max]=bounds();if(max<=0)return;const next=Math.round(Math.max(Math.min(min,max),Math.min(max,value)));const basis=next+'px';if(node.style.width!==basis)node.style.width=basis;if(node.style.flexBasis!==basis)node.style.flex='0 0 '+basis;handle.setAttribute('aria-valuemin',String(Math.min(min,max)));handle.setAttribute('aria-valuemax',String(Math.floor(max)));handle.setAttribute('aria-valuenow',String(next));if(remember){preferred=next;persist(key,next);}}
  handle.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();drag={x:e.clientX,start:width(node),id:e.pointerId};handle.setPointerCapture(e.pointerId);document.body.classList.add('panel-resizing');};
  handle.onpointermove=e=>{if(drag)apply(drag.start+(e.clientX-drag.x)*(side==='left'?-1:1),true);};
  function finish(){drag=null;document.body.classList.remove('panel-resizing');}
  handle.onpointerup=finish;handle.onpointercancel=finish;handle.onlostpointercapture=finish;
  handle.onkeydown=e=>{const [min,max]=bounds();let next=width(node);const delta=(e.shiftKey?40:10)*(side==='left'?-1:1);if(e.key==='ArrowLeft')next-=delta;else if(e.key==='ArrowRight')next+=delta;else if(e.key==='Home')next=min;else if(e.key==='End')next=max;else return;e.preventDefault();apply(next,true);};
  handle.ondblclick=()=>apply(initial(),true);
  const observer=new ResizeObserver(()=>request());observer.observe(node.parentElement);
  entries.set(key,{node,handle,observer,apply:()=>apply(preferred)});apply(preferred);
 }
 function update(){scheduled=false;const workspace=document.querySelector('.workspace'),terminal=document.getElementById('terminalPanel');if(!workspace)return;
  attach('sidebar',document.querySelector('.sidebar'),'right',()=>[180,Math.min(400,innerWidth-760)],()=>240);
  attach('terminal',terminal,'left',()=>[220,Math.max(220,width(workspace)-(entries.get('list')?width(entries.get('list').node):320)-240)],()=>340);
  attach('list',document.querySelector('.list-panel'),'right',()=>[180,Math.max(180,width(workspace)-(terminal.classList.contains('hidden')?0:width(terminal))-240)],()=>320);
  const left=document.querySelector('.editor-left');if(left)attach('editor',left,'right',()=>[120,Math.max(120,width(left.parentElement)-120)],()=>width(left.parentElement)/2);
  for(const [key,entry] of entries){if(!entry.node.isConnected){entry.observer.disconnect();entries.delete(key);}else{entry.apply();if(key==='editor'){const hidden=document.getElementById('editorDiff')?.classList.contains('hidden')??true;if(entry.handle.classList.contains('hidden')!==hidden)entry.handle.classList.toggle('hidden',hidden);entry.node.style.flex=hidden?'1 1 0px':'0 0 '+entry.node.style.width;}}}
 }
 function request(){if(!scheduled){scheduled=true;requestAnimationFrame(update);}}
 new MutationObserver(request).observe(document.querySelector('.workspace'),{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
 window.addEventListener('resize',request);update();
})();
