'use strict';
(()=>{
 const palette=['#b7ed91','#84bde7','#d6a0dd','#f1be7e','#79d7c2','#ed93a9','#a8a9f6'];
 let logSeq=0,commitSeq=0,fileSeq=0,ref='',limit=300,data=null,selected=null,selectedFile=null;
 const active=()=>state&&view==='graph';
 const current=(epoch,repo)=>active()&&repoEpoch===epoch&&state.repo===repo;
 function invalidate(){logSeq++;commitSeq++;fileSeq++;}
 function clearDetail(){selected=null;selectedFile=null;commitSeq++;fileSeq++;$('graphInfo').replaceChildren(document.createTextNode('选择提交，查看提交信息、修改文件与 Diff。'));$('graphFiles').replaceChildren();$('graphDiff').replaceChildren();}
 function reset(){invalidate();ref='';limit=300;data=null;clearDetail();$('graphRows').replaceChildren();$('graphCount').textContent='';$('graphMore').disabled=true;const option=el('option','','所有本地及远程跟踪分支');option.value='';$('graphRef').replaceChildren(option);}
 const svgNode=(tag,attrs)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value]of Object.entries(attrs))node.setAttribute(key,String(value));return node;};
 function render(){
  const layout=window.GraphLayout.build(data.commits),rows=$('graphRows'),top=rows.scrollTop,left=rows.scrollLeft,fragment=document.createDocumentFragment();
  const width=layout.width*18+22;
  data.commits.forEach((commit,index)=>{
   const row=layout.rows[index],b=button('',()=>select(commit.hash),'graph-row'+(selected===commit.hash?' selected':''));b.dataset.hash=commit.hash;b.setAttribute('aria-pressed',String(selected===commit.hash));
   const svg=svgNode('svg',{width,height:48,viewBox:`0 0 ${width} 48`,'aria-hidden':'true'});svg.classList.add('graph-topology');
   const x=column=>14+column*18;
   for(const edge of row.segments)svg.append(svgNode('path',{d:`M ${x(edge.from)} ${edge.start} C ${x(edge.from)} ${(edge.start+edge.end)/2}, ${x(edge.to)} ${(edge.start+edge.end)/2}, ${x(edge.to)} ${edge.end}`,fill:'none',stroke:palette[edge.color%palette.length],'stroke-width':2}));
   svg.append(svgNode('circle',{cx:x(row.column),cy:24,r:4.5,fill:palette[row.color%palette.length],stroke:'#18201d','stroke-width':1.5}));
   const main=el('span','graph-message'),badges=el('span','graph-badges');
   if(commit.hash===data.head)badges.append(el('span','graph-badge graph-head','HEAD'));
   for(const name of commit.refs||[])badges.append(el('span','graph-badge'+(name.startsWith('refs/remotes/')?' graph-remote':''),name.replace(/^refs\/(heads|remotes)\//,'')));
   main.append(badges,el('span','graph-subject',commit.subject||'（无提交说明）'));
   const meta=el('span','graph-meta',commit.hash.slice(0,8)+' · '+commit.author+' · '+new Date(commit.date).toLocaleDateString());
   b.append(svg,main,meta);b.title=commit.subject+'\n'+commit.hash+'\n'+commit.author;b.style.minWidth=(width+500)+'px';fragment.append(b);
  });
  if(!data.commits.length)fragment.append(el('div','no-items','当前范围内没有提交。'));
  rows.replaceChildren(fragment);rows.scrollTop=top;rows.scrollLeft=left;
  $('graphCount').textContent=data.commits.length+' 条提交'+(data.hasMore?' · 下方仍有历史':'');
  $('graphMore').disabled=!data.hasMore||limit>=2000;$('graphMore').textContent=limit>=2000&&data.hasMore?'已达 2000 条上限':'加载更多';
 }
 async function load(){
  if(!active()){if(!state)$('graphRows').replaceChildren(el('div','no-items','请先打开一个本地 Git 仓库。'));return;}
  const epoch=repoEpoch,repo=state.repo,ticket=++logSeq,requestedRef=ref;
  // Refresh invalidates pending detail requests even when the selected hash survives.
  commitSeq++;fileSeq++;$('graphCount').textContent='正在读取拓扑…';$('graphMore').disabled=true;
  try{
   let next;try{next=await api.graphLog({ref:requestedRef,limit});}catch(error){
    if(!current(epoch,repo)||ticket!==logSeq)return;
    if(!requestedRef)throw error;
    const all=await api.graphLog({ref:'',limit:300});
    if(!current(epoch,repo)||ticket!==logSeq)return;
    if(all.branches.some(branch=>branch.ref===requestedRef))throw error;
    ref='';limit=300;next=all;
   }
   if(!current(epoch,repo)||ticket!==logSeq)return;
   data=next;const options=[el('option','','所有本地及远程跟踪分支')];options[0].value='';
   for(const branch of data.branches){const o=el('option','',(branch.remote?'远程 · ':'本地 · ')+branch.name+(branch.current?'（当前）':''));o.value=branch.ref;options.push(o);}
   $('graphRef').replaceChildren(...options);$('graphRef').value=ref;render();
   if(selected&&data.commits.some(c=>c.hash===selected))await select(selected,selectedFile);else clearDetail();
  }catch(error){if(current(epoch,repo)&&ticket===logSeq){data=null;$('graphCount').textContent='读取失败';$('graphRows').replaceChildren(el('div','no-items',error.message));clearDetail();$('graphMore').textContent='重试';$('graphMore').disabled=false;}}
 }
 function markSelection(){for(const row of $('graphRows').querySelectorAll('.graph-row')){const yes=row.dataset.hash===selected;row.classList.toggle('selected',yes);row.setAttribute('aria-pressed',String(yes));}}
 async function select(hash,previousFile=null){
  if(!active())return;selected=hash;selectedFile=null;const epoch=repoEpoch,repo=state.repo,ticket=++commitSeq;fileSeq++;markSelection();
  $('graphInfo').textContent='正在读取提交…';$('graphFiles').replaceChildren();$('graphDiff').replaceChildren();
  try{
   const detail=await api.graphCommit({hash});if(!current(epoch,repo)||ticket!==commitSeq||selected!==hash)return;
   const title=el('strong','',detail.subject||'（无提交说明）'),meta=el('div','graph-commit-meta',detail.hash+' · '+detail.author+' · '+new Date(detail.date).toLocaleString());
   const comparison=detail.parents.length>1?'合并提交：仅与第一父提交 '+detail.parents[0].slice(0,8)+' 比较，不是所有父提交的合并差异。':detail.parents.length?'与父提交 '+detail.parents[0].slice(0,8)+' 比较。':'根提交：与空树比较。';
   const body=el('pre','graph-commit-body',detail.body||'');
   $('graphInfo').replaceChildren(title,meta,el('div','graph-comparison',comparison+' '+detail.files.length+' 个修改文件'),body);
   const all=button('全部文件',()=>showDiff(detail,null),'graph-file selected');all.dataset.file='';$('graphFiles').append(all);
   for(const file of detail.files){const label=file.status+'  '+(file.oldPath?file.oldPath+' → ':'')+file.path;const b=button(label,()=>showDiff(detail,file.path),'graph-file');b.dataset.file=file.path;b.title=label;$('graphFiles').append(b);}
   if(previousFile&&detail.files.some(file=>file.path===previousFile))await showDiff(detail,previousFile);else diffText(detail.diff,$('graphDiff'));
  }catch(error){if(current(epoch,repo)&&ticket===commitSeq){$('graphInfo').textContent='提交读取失败：'+error.message;}}
 }
 async function showDiff(detail,file){
  if(!active()||selected!==detail.hash)return;selectedFile=file;const epoch=repoEpoch,repo=state.repo,ticket=++fileSeq,commitTicket=commitSeq;
  for(const node of $('graphFiles').querySelectorAll('button'))node.classList.toggle('selected',node.dataset.file===(file||''));
  if(file===null){diffText(detail.diff,$('graphDiff'));return;}
  $('graphDiff').textContent='正在读取文件 Diff…';
  try{const result=await api.graphCommit({hash:detail.hash,file});if(current(epoch,repo)&&ticket===fileSeq&&commitTicket===commitSeq&&selected===detail.hash)diffText(result.diff,$('graphDiff'));}
  catch(error){if(current(epoch,repo)&&ticket===fileSeq&&commitTicket===commitSeq)$('graphDiff').textContent='Diff 读取失败：'+error.message;}
 }
 $('graphRef').onchange=()=>{ref=$('graphRef').value;limit=300;clearDetail();$('graphRows').replaceChildren();void load();};
 $('graphMore').onclick=()=>{if(data?.hasMore)limit=Math.min(2000,limit+300);void load();};
 window.branchGraph={load,reset,invalidate};
})();
