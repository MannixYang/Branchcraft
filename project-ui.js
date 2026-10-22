'use strict';
(()=>{
 const folderChoices=new Map();
 let files=[],doc=null,dirty=false,seq=0,treeSeq=0,base='HEAD',showDiff=true,saving=false,diffSeq=0,editVersion=0;
 async function leave(){if(saving){toast('文件正在保存，请稍候再切换。',true);return false;}if(!dirty){seq++;diffSeq++;return true;}const ok=await modal('放弃未保存修改？','编辑内容尚未写入磁盘。取消可返回编辑器继续保存。',[],'放弃修改');if(!ok)return false;seq++;diffSeq++;dirty=false;doc=null;$('detailBody').replaceChildren();return true;}
 function reset(){seq++;treeSeq++;diffSeq++;files=[];folderChoices.clear();doc=null;dirty=false;$('detailBody').replaceChildren();}
 function drawTree(){
  const items=$('items'),top=items.scrollTop,query=$('search').value.toLowerCase();
  items.replaceChildren();$('listMeta').textContent=files.length+' 个文件';
  const draw=(node,depth,prefix='')=>{
   for(const [name,folder] of node.dirs){
    const path=prefix+name+'/',expanded=folderChoices.get(path)===true;
    const row=button('',()=>{folderChoices.set(path,!expanded);drawTree();},'folder-row tree-row');row.append(el('span','tree-chevron',expanded?'▾':'▸'),el('span','tree-icon tree-folder'),el('span','tree-name',name),el('span','tree-count',String(folder.count)));row.title=path;
    row.type='button';row.dataset.folder=path;row.setAttribute('aria-expanded',String(expanded));
    row.style.paddingLeft=(10+depth*16)+'px';
    items.append(row);if(expanded)draw(folder,depth+1,path);
   }
   for(const entry of node.files){const file=entry.path;const row=button('',()=>open(file),'file-row tree-row'+(doc?.file===file?' selected':''));row.append(el('span','tree-chevron'),el('span','tree-icon tree-file'),el('span','tree-name',file.split('/').pop()));row.style.paddingLeft=(10+depth*16)+'px';row.title=file;items.append(row);}
  };
  draw(FileTree.build(files.filter(f=>f.toLowerCase().includes(query)).map(path=>({path}))),0);items.scrollTop=top;
 }
 function expandAll(expanded){
  for(const file of files){const parts=file.split('/');parts.pop();let path='';for(const part of parts){path+=part+'/';folderChoices.set(path,expanded);}}
  drawTree();
 }
 async function tree(){
  const ticket=++treeSeq;$('listActions').replaceChildren();$('listMeta').textContent='读取目录…';
  if(!state){$('items').replaceChildren(el('p','muted','请先打开仓库'));return;}
  try{const next=await api.projectTree();if(ticket!==treeSeq||view!=='project')return;files=next;
   $('listActions').replaceChildren(button('全部折叠',()=>expandAll(false)),button('全部展开',()=>expandAll(true)));drawTree();
  }catch(e){if(ticket===treeSeq&&view==='project')toast(e.message,true);}
 }
 async function open(file){if(doc?.file===file){show();return;}if(!await leave())return;const ticket=++seq;try{const next=await api.projectRead(file);if(ticket!==seq||view!=='project')return;doc=next;dirty=false;$('detailBody').replaceChildren();show();tree();}catch(e){toast(e.message,true);}}
 async function updateDiff(){
  const node=$('editorDiff');if(!node||!doc||!showDiff)return;
  const ticket=seq,request=++diffSeq,file=doc.file;
  const current=()=>ticket===seq&&request===diffSeq&&view==='project'&&showDiff&&node===$('editorDiff');
  node.textContent='读取磁盘 Diff…';
  try{const diff=await api.projectDiff({file,base});if(!current())return;
   diffText(diff||'与基准相同。',node);
   if(dirty)node.prepend(el('div','detail-note','尚有未保存修改；以下为磁盘内容的 Diff。'));
  }catch(e){if(current())node.textContent=e.message;}
 }
 async function save(){if(saving||!doc||!dirty)return;const textarea=$('projectText');if(!textarea)return;const ticket=seq;const text=textarea.value;saving=true;try{const saved=await api.projectSave({file:doc.file,text,token:doc.token});if(ticket!==seq)return;doc={...saved,text};dirty=textarea.value!==text;status();await updateDiff();await refresh();toast('已保存到工作区（未自动暂存）');}catch(e){toast('保存失败，编辑内容已保留：'+e.message,true);}finally{saving=false;}}
 function status(){if($('editorStatus'))$('editorStatus').textContent=dirty?'● 未保存':'已保存 · UTF-8';}
 function show(){if(view!=='project')return;$('detailType').textContent='PROJECT EDITOR';$('detailTitle').textContent=doc?.file||'项目文件编辑器';if($('projectText')&&doc)return;$('detailActions').replaceChildren();if(!doc){$('detailBody').replaceChildren(el('div','empty','从左侧选择 UTF-8 文本文件进行编辑。'));return;}if($('projectText'))return;const actions=$('detailActions');const select=el('select');select.id='diffBase';select.setAttribute('aria-label','Diff 基准');for(const value of ['HEAD','index']){const option=el('option','',value==='index'?'暂存区':'当前 HEAD');option.value=value;select.append(option);}select.value=base;select.onchange=()=>{base=select.value;updateDiff();};const toggle=button(showDiff?'隐藏 Diff':'显示 Diff',()=>{showDiff=!showDiff;diffSeq++;$('editorDiff').classList.toggle('hidden',!showDiff);toggle.textContent=showDiff?'隐藏 Diff':'显示 Diff';updateDiff();});actions.append(select,toggle,button('重新载入',async()=>{const file=doc.file;if(await leave()){doc=null;open(file);}}),button('保存 Ctrl+S',save,'primary'));const wrap=el('div','project-editor');const left=el('div','editor-left');const info=el('div','editor-status');info.id='editorStatus';const area=el('textarea','project-text');area.id='projectText';area.spellcheck=false;area.setAttribute('aria-label','文件内容');area.value=doc.text;area.oninput=()=>{editVersion++;dirty=area.value!==doc.text;status();updateDiff();};area.onkeydown=e=>{if(e.key==='Tab'){e.preventDefault();area.setRangeText('  ',area.selectionStart,area.selectionEnd,'end');area.dispatchEvent(new Event('input'));}};left.append(info,area);const right=el('div','editor-diff'+(showDiff?'':' hidden'));right.id='editorDiff';wrap.append(left,right);$('detailBody').replaceChildren(wrap);status();updateDiff();}
 window.projectEditor={leave,reset,tree,show};
 document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'&&view==='project'){e.preventDefault();save();}});
 window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';toast('请先保存编辑内容，或切换视图确认放弃。',true);}});
 async function externalRefresh(){if($('modal').open||$('reviewDialog').open||$('recoveryDialog').open){requestRefresh();return;}if(!doc||view!=='project')return;const ticket=seq,revision=editVersion,node=$('projectText');if(!node||saving)return;try{const current=await api.projectRead(doc.file);if(ticket!==seq||revision!==editVersion||view!=='project'||node!==$('projectText')||saving)return;if($('modal').open||$('reviewDialog').open||$('recoveryDialog').open){requestRefresh();return;}if(current.token!==doc.token){if(dirty)toast('文件已被外部修改；保存会拒绝覆盖，请先备份编辑内容再重新载入。',true);else{const start=node.selectionStart,end=node.selectionEnd,top=node.scrollTop,left=node.scrollLeft;doc=current;node.value=doc.text;node.setSelectionRange(Math.min(start,node.value.length),Math.min(end,node.value.length));node.scrollTop=top;node.scrollLeft=left;status();updateDiff();}}}catch(e){toast(e.message,true);}}
 window.projectEditor.externalRefresh=externalRefresh;
 window.addEventListener('focus',externalRefresh);
})();
