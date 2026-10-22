'use strict';
const $=id=>document.getElementById(id);const api=window.gitdesk;let state=null,view='changes',selection=null,loading=false,detailSeq=0,toastTimer;const colors=['#b7ed91','#84bde7','#d6a0dd','#f1be7e','#79d7c2'];
const collapsedFolders=new Set();
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
function toast(text,error=false){$('toast').textContent=text;$('toast').className=error?'error':'';$('toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').style.display='none',error?16000:6000);}
async function task(fn,label='处理中…'){if(loading)return;loading=true;$('statusText').textContent=label;document.body.setAttribute('aria-busy','true');try{return await fn();}catch(e){toast(e.message,true);return null;}finally{loading=false;document.body.removeAttribute('aria-busy');$('statusText').textContent=state?'就绪 · '+state.branch:'就绪 · 请打开仓库';}}
function modal(title,description,fields=[],confirm='确认'){if($('modal').open||loading)return Promise.resolve(null);return new Promise(resolve=>{const box=$('modalFields');box.replaceChildren();$('modalTitle').textContent=title;$('modalDescription').textContent=description;$('modalConfirm').textContent=confirm;for(const field of fields){const label=el('label','',field.label);let input;if(field.type==='select'){input=el('select');for(const option of field.options){const o=el('option','',option);o.value=option;input.append(o);}}else{input=el('input');input.type=field.type||'text';input.value=field.value||'';input.placeholder=field.placeholder||'';input.checked=!!field.checked;}input.name=field.name;input.required=!!field.required;label.append(input);box.append(label);}const dialog=$('modal');const finish=value=>{dialog.close();$('modalForm').onsubmit=null;$('modalCancel').onclick=null;dialog.oncancel=null;resolve(value);};$('modalForm').onsubmit=e=>{e.preventDefault();const values={};for(const field of fields){const n=$('modalForm').elements.namedItem(field.name);values[field.name]=field.type==='checkbox'?n.checked:n.value;}finish(values);};$('modalCancel').onclick=()=>finish(null);dialog.oncancel=e=>{e.preventDefault();finish(null);};dialog.showModal();box.querySelector('input,select')?.focus();});}
async function recent(){const repos=await api.recent();$('recent').replaceChildren();for(const folder of repos.slice(0,4)){const b=el('button','',folder.split(/[\\/]/).pop());b.title=folder;b.onclick=async()=>{if(!await window.projectEditor?.leave())return;await task(async()=>{const s=await api.open(folder);await opened(s);},'打开仓库…');};$('recent').append(b);}}
async function opened(s){saveDraft();repoEpoch++;collapsedFolders.clear();$('search').value='';window.terminalPanel?.reset();window.projectEditor?.reset();detailSeq++;state=s;selection=null;loadDraft();render();resetDetail();await recent();}
async function choose(){if(!await window.projectEditor?.leave())return;await task(async()=>{const s=await api.choose();if(s)await opened(s);},'选择仓库…');}
async function refresh(){
 if(!state)return;if($('modal').open||$('reviewDialog').open||$('recoveryDialog').open){requestRefresh();return;}const epoch=repoEpoch,repo=state.repo,ticket=++refreshTicket;
 const next=await api.snapshot();if(epoch!==repoEpoch||ticket!==refreshTicket||next.repo!==repo)return;
 if($('modal').open||$('reviewDialog').open||$('recoveryDialog').open){requestRefresh();return;}
 state=next;render();
 if(view==='project'){await window.projectEditor?.externalRefresh();return;}
 if(!selection||$('modal').open||$('detailBody').querySelector('textarea'))return;
 const key=selection,top=$('detailBody').scrollTop,left=$('detailBody').scrollLeft;
 if(view==='changes'){const split=key.indexOf(':'),kind=key.slice(0,split),file=state.files.find(f=>f.path===key.slice(split+1)&& (kind==='staged'?f.x!==' '&&f.x!=='?':kind==='conflict'?f.conflict:f.y!==' '||f.x==='?'));if(file)await selectFile(file,kind,key);else{selection=null;resetDetail();}}
 else if(view==='history'){const c=state.commits.find(c=>c.hash===key);if(c)await selectCommit(c);else{selection=null;resetDetail();}}
 else if(view==='stash'){const st=state.stashes.find(s=>s.ref===key);if(st)await selectStash(st);else{selection=null;resetDetail();}}
 if(epoch===repoEpoch&&selection===key){$('detailBody').scrollTop=top;$('detailBody').scrollLeft=left;}
}
async function act(action,args={},success='操作完成'){if(!await window.projectEditor?.leave())return;if(!state){toast('请先打开仓库',true);return;}return await task(async()=>{let error;let result;try{result=await api.action(action,args);}catch(e){error=e;}await refresh();selection=null;resetDetail();if(error)throw error;toast(success+(result?'\n'+result.trim():''));return true;},'正在执行 '+action+'…');}
function button(text,fn,cls=''){const b=el('button',cls,text);b.onclick=fn;return b;}
function branchList(){for(const [id,remote] of [['branches',false],['remoteBranches',true]]){$(id).replaceChildren();const branches=state.branches.filter(b=>b.remote===remote&&!b.name.endsWith('/HEAD'));for(const branch of branches){const b=button((branch.current?'● ':'⑂ ')+branch.name,async()=>{const options=await modal(remote?'远程分支':'分支操作',remote?'从远程分支建立本地跟踪分支，或将其合并到当前分支。':'切换分支会改变工作区；未提交修改可能阻止操作。',[{name:'operation',label:'操作',type:'select',options:remote?['合并到当前分支','创建本地跟踪分支']:['切换到此分支','合并到当前分支']}]);if(!options)return;if(options.operation==='合并到当前分支')await act('merge',{name:branch.name},'分支合并完成');else if(options.operation==='创建本地跟踪分支')await act('track',{name:branch.name},'已切换分支');else await act('switch',{name:branch.name},'已切换分支');},'branch'+(branch.current?' current':''));b.title=branch.name+(branch.upstream?' → '+branch.upstream:'');$(id).append(b);}}}
function render(){if(!state)return;const name=state.repo.split(/[\\/]/).pop();$('repoName').textContent=name;$('breadcrumb').textContent=name;$('repoPath').textContent=state.repo;$('currentBranch').textContent='⑂ '+state.branch;$('changesCount').textContent=state.files.length;$('historyCount').textContent=state.commits.length;$('stashCount').textContent=state.stashes.length;$('sync').textContent=state.counts?state.counts.split(/\s+/).map((n,i)=>(i?'↓ ':'↑ ')+n).join('  '):'无上游分支';$('mergeBanner').classList.toggle('hidden',!state.merging);$('stagedCount').textContent=state.files.filter(f=>f.x!==' '&&f.x!=='?'&&!f.conflict).length+' 个已暂存文件';branchList();renderList();}
async function setView(v){if(!await window.projectEditor?.leave())return;view=v;selection=null;$('search').value='';document.querySelectorAll('[data-view]').forEach(n=>n.classList.toggle('active',n.dataset.view===v));const titles={project:['项目文件','直接编辑工作区 · 保存不会自动暂存。','项目文件'],changes:['工作区','每一次修改，都值得清晰掌握。','工作区'],history:['提交历史','沿着分支，读懂代码的来路。','提交历史'],stash:['Stash 储藏室','暂存未完成的修改，让思路自在切换。','Stash 储藏室']};$('viewTitle').replaceChildren(document.createTextNode(titles[v][0]),el('span','accent','.'));$('viewSubtitle').textContent=titles[v][1];$('listTitle').textContent=titles[v][2];$('commitBox').classList.toggle('hidden',v!=='changes');renderList();resetDetail();}
function resetDetail(){detailSeq++;if(view==='project'){window.projectEditor?.show();return;}$('detailType').textContent='CHANGE INSPECTOR';$('detailTitle').textContent=view==='stash'?'Stash 修改详情':view==='history'?'提交详情':'修改检查器';$('detailActions').replaceChildren();const d=el('div','empty');d.append(el('div','empty-icon',view==='stash'?'▣':'⑂'),el('h2','',state?'选择一项，查看完整细节。':'为下一次提交，理清思路。'),el('p','',state?'从左侧选择文件、提交或 Stash。\n所有内容直接读取自你的本地 Git 仓库。':'打开一个本地 Git 仓库，开始管理代码。'));if(!state)d.append(button('打开仓库 ↗',choose,'primary'));$('detailBody').replaceChildren(d);}
function renderList(){const items=$('items');const top=items.scrollTop;drawList();items.scrollTop=top;}
function workspaceFolders(expand){
 if(expand)collapsedFolders.clear();else for(const f of state.files){const kinds=f.conflict?['conflict']:[...((f.y!==' '||f.x==='?')?['worktree']:[]),...((f.x!==' '&&f.x!=='?')?['staged']:[])];const parts=f.path.split('/');parts.pop();for(const kind of kinds)for(let i=1;i<=parts.length;i++)collapsedFolders.add(kind+':'+parts.slice(0,i).join('/')+'/');}renderList();
}
function drawList(){if(view==='project'){window.projectEditor?.tree();return;}const items=$('items');items.replaceChildren();$('listActions').replaceChildren();if(!state){items.append(el('div','no-items','尚未打开仓库'));return;}const q=$('search').value.toLowerCase();if(view==='changes'){
 $('listMeta').textContent=state.files.length+' 个文件';$('listActions').append(button('全部折叠',()=>workspaceFolders(false)),button('全部展开',()=>workspaceFolders(true)),button('＋ 全部暂存',()=>act('stage',{files:state.files.filter(f=>!f.conflict&&(f.y!==' '||f.x==='?')).map(f=>f.path)},'已暂存文件')),button('－ 全部取消暂存',()=>act('unstage',{files:state.files.filter(f=>f.x!==' '&&f.x!=='?'&&!f.conflict).map(f=>f.path)},'已取消暂存')),button('▣ 保存到 Stash',stashSave));
 const groups=[['冲突文件',f=>f.conflict,'conflict'],['已暂存 · 将进入提交',f=>!f.conflict&&f.x!==' '&&f.x!=='?','staged'],['未暂存 · 仅工作区',f=>!f.conflict&&(f.y!==' '||f.x==='?'),'worktree']];for(const [title,filter,kind] of groups){const files=state.files.filter(filter).filter(f=>f.path.toLowerCase().includes(q));if(!files.length)continue;items.append(el('div','group-label',title+' / '+files.length));const tree=FileTree.build(files);const draw=(node,parent,prefix)=>{for(const [name,child] of node.dirs){const folder=prefix+name+'/';const id=kind+':'+folder;const group=el('div','folder-group');const toggle=button((collapsedFolders.has(id)?'▸ ':'▾ ')+name+' / '+child.count,()=>{if(collapsedFolders.has(id))collapsedFolders.delete(id);else collapsedFolders.add(id);renderList();},'folder-toggle');toggle.dataset.folder=id;toggle.setAttribute('aria-expanded',String(!collapsedFolders.has(id)));group.append(toggle);if(!collapsedFolders.has(id)){const contents=el('div','folder-contents');draw(child,contents,folder);group.append(contents);}parent.append(group);}for(const f of node.files){const key=kind+':'+f.path;const b=button('',()=>selectFile(f,kind,key),'item'+(selection===key?' selected':''));b.title=f.path;const body=el('span','item-main');body.append(el('span','item-title',f.path.split('/').pop()),el('span','item-sub',f.path));b.append(el('span','badge'+(f.conflict?' conflict':''),f.conflict?'!':kind==='staged'?f.x:f.x==='?'?'U':f.y),body);parent.append(b);}};draw(tree,items,'');}}
 if(view==='history'){$('listMeta').textContent=state.commits.length+' 条';const graphs=buildGraph(state.commits);state.commits.forEach((c,index)=>{if(!(c.subject+c.author+c.hash+c.refs).toLowerCase().includes(q))return;const b=button('',()=>selectCommit(c),'item'+(selection===c.hash?' selected':''));b.append(graphs[index]);const body=el('span','item-main');body.append(el('span','item-title',c.subject),el('span','item-sub',c.hash.slice(0,7)+' · '+c.author+' · '+new Date(c.date).toLocaleDateString()+(c.refs?' · '+c.refs:'')));b.append(body);b.title=c.refs||c.subject;items.append(b);});}
 if(view==='stash'){$('listMeta').textContent=state.stashes.length+' 项';$('listActions').append(button('＋ 保存当前修改',stashSave));for(const stash of state.stashes.filter(s=>(s.ref+s.subject).toLowerCase().includes(q))){const b=button('',()=>selectStash(stash),'item'+(selection===stash.ref?' selected':''));const body=el('span','item-main');body.append(el('span','item-title',stash.subject),el('span','item-sub',stash.ref+' · '+stash.date));b.append(el('span','badge','▣'),body);items.append(b);}}
 if(!items.children.length)items.append(el('div','no-items',q?'没有匹配项':view==='changes'?'✓ 工作区干净，没有待处理修改':view==='stash'?'储藏室为空，保存修改后会显示在这里':'尚无提交'));}
function buildGraph(commits){let lanes=[];return commits.map(c=>{let col=lanes.indexOf(c.hash);if(col<0){col=lanes.length;lanes.push(c.hash);}const before=[...lanes];lanes.splice(col,1,...c.parents.filter(p=>!lanes.includes(p)));lanes=[...new Set(lanes)];const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('graph');svg.setAttribute('viewBox','0 0 88 48');const x=i=>8+Math.min(i,5)*13;const line=(a,b,y1,y2,color)=>{const n=document.createElementNS(svg.namespaceURI,'line');for(const [k,v] of Object.entries({x1:x(a),x2:x(b),y1,y2,stroke:color}))n.setAttribute(k,v);svg.append(n);};before.forEach((hash,i)=>{if(hash===c.hash){line(i,col,0,24,colors[col%5]);return;}const target=lanes.indexOf(hash);if(target>=0)line(i,target,0,48,colors[i%5]);});c.parents.forEach(p=>{const target=lanes.indexOf(p);if(target>=0)line(col,target,24,48,colors[col%5]);});const circle=document.createElementNS(svg.namespaceURI,'circle');for(const [k,v] of Object.entries({cx:x(col),cy:24,r:4.5,fill:colors[col%5]}))circle.setAttribute(k,v);svg.append(circle);svg.setAttribute('aria-label','提交图，父提交 '+c.parents.map(p=>p.slice(0,7)).join(', '));return svg;});}
function diffText(text,target=$('detailBody')){const pre=el('pre','diff');const lines=(text||'没有文本差异（可能是二进制文件、仅权限变化，或该区域没有修改）。').split('\n');let truncated=false;for(let i=0;i<Math.min(lines.length,18000);i++){const text=lines[i];const cls=text.startsWith('+++')||text.startsWith('---')?'meta':text.startsWith('+')?'add':text.startsWith('-')?'del':text.startsWith('@@')?'hunk':text.startsWith('diff ')||text.startsWith('commit ')?'meta':'';const row=el('span','diff-line '+cls);row.append(el('span','line-num',String(i+1)),document.createTextNode(text));pre.append(row);}truncated=lines.length>18000;if(truncated)pre.append(el('span','diff-line meta','预览截断：仅显示前 18000 行。'));target.replaceChildren(pre);return pre;}
async function showDiff(args,title,type,actions=[]){const seq=++detailSeq;$('detailTitle').textContent=title;$('detailType').textContent=type;$('detailActions').replaceChildren(...actions);$('detailBody').replaceChildren(el('div','detail-note','正在读取差异…'));try{const text=await api.diff(args);if(seq===detailSeq)diffText(text);}catch(e){if(seq===detailSeq)$('detailBody').replaceChildren(el('div','detail-note',e.message));}}
async function selectFile(file,kind,key){
 selection=key;renderList();if(kind==='conflict'){await showConflict(file);return;}
 const seq=++detailSeq,staged=kind==='staged';const current=()=>seq===detailSeq&&selection===key&&view==='changes';
 $('detailTitle').textContent=file.path;$('detailType').textContent=staged?'STAGED / INDEX':'WORKING TREE';
 $('detailActions').replaceChildren(button(staged?'取消暂存':'＋ 暂存文件',()=>act(staged?'unstage':'stage',{files:[file.path]},staged?'已取消暂存，代码保留':'已暂存')));
 $('detailBody').replaceChildren(el('div','detail-note','正在读取差异…'));
 let preview,text,reason;
 try{preview=await api.diff({file:file.path,staged,hunks:true});text=preview.diff;}catch(e){reason=e.message;try{text=await api.diff({file:file.path,staged});}catch(error){if(current())$('detailBody').replaceChildren(el('div','detail-note',error.message));return;}}
 if(!current())return;
 const pre=diffText(text);pre.classList.add('actionable-diff');
 let rollback;
 if(!staged){try{rollback=await api.rollbackPreview(file.path);}catch(e){reason=reason||e.message;}if(!current())return;}
 const finish=async(fn,message)=>{if(!current())return;await task(async()=>{await fn();await refresh();if(current()){selection=null;resetDetail();}toast(message);});};
 const restore=async(hunk)=>{if(!current())return;if(!await modal(hunk===undefined?'恢复文件未暂存修改':'恢复此代码块','操作前会创建本地恢复记录（7天 / 总计100MiB，自动清理）：'+file.path+'\n'+(rollback.untracked?'未跟踪文件将被删除。':'仅恢复未暂存修改，已暂存内容保留。'),[],'确认恢复'))return;await finish(()=>api.rollback({file:file.path,token:rollback.token,...(hunk===undefined?{}:{hunk})}),'未暂存修改已恢复');};
 if(rollback)$('detailActions').append(button('恢复文件修改…',()=>restore(undefined),'danger'));
 const rows=[...pre.querySelectorAll('.diff-line')];let index=-1;
 // Added/deleted files are indivisible: expose file actions once, not misleading hunk actions.
 const wholeFile=!file.conflict&&!file.oldPath&&(staged?/[AD]/.test(file.x):file.x==='?'||file.y==='D'||/^(new file mode|deleted file mode) /m.test(text));
 const fileRow=wholeFile&&(rows.find(row=>row.classList.contains('hunk'))||rows[0]);
 for(const row of rows){const gutter=el('span','hunk-actions');row.prepend(gutter);
 if(wholeFile){if(row===fileRow){
 const b=button(staged?'−':'＋',()=>finish(()=>api.action(staged?'unstage':'stage',{files:[file.path]}),staged?'已取消整个文件的暂存，工作区保持不变':'已暂存整个文件'),'hunk-action');b.dataset.scope='file';b.dataset.action=staged?'unstage':'stage';b.title=staged?'取消整个文件的暂存（保留工作区修改）':'暂存整个文件';b.setAttribute('aria-label',b.title);gutter.append(b);
 if(rollback){const r=button('↶',()=>restore(undefined),'hunk-action danger');r.dataset.scope='file';r.dataset.action='restore';r.title=rollback.untracked?'恢复整个文件：删除此新增文件…':'恢复整个文件的未暂存修改…';r.setAttribute('aria-label',r.title);gutter.append(r);}
 }continue;}
 if(!row.classList.contains('hunk'))continue;const hunk=++index;
 if(preview?.hunks?.some(h=>h.index===hunk)){
 const b=button(staged?'−':'＋',()=>finish(()=>api.action(staged?'unstageHunk':'stageHunk',{file:file.path,token:preview.hunkToken,hunk}),staged?'已取消暂存此块，工作区保持不变':'已暂存此块，工作区保持不变'),'hunk-action');b.dataset.hunk=String(hunk);b.dataset.action=staged?'unstage':'stage';b.title=staged?'取消暂存此代码块（保留工作区修改）':'暂存此代码块';b.setAttribute('aria-label',b.title);gutter.append(b);
 }
 if(rollback&&rollback.diff===text&&rollback.hunks[hunk]){const b=button('↶',()=>restore(hunk),'hunk-action danger');b.dataset.hunk=String(hunk);b.dataset.action='restore';b.title='恢复此代码块的未暂存修改…';b.setAttribute('aria-label',b.title);gutter.append(b);}
 }
 if(reason&&!wholeFile)$('detailBody').prepend(el('div','detail-note','代码块操作不可用：'+reason+'。可使用上方整文件操作。'));
}
async function selectCommit(c){selection=c.hash;renderList();await showDiff({commit:c.hash},c.subject,'COMMIT / '+c.hash.slice(0,12));}
async function selectStash(s){selection=s.ref;renderList();let hash;try{hash=await api.stashHash(s.ref);}catch(e){toast(e.message,true);return;}if(selection!==s.ref)return;const operation=async(action,title,description)=>{if(await modal(title,description,[],title))await act(action,{ref:s.ref,hash},title+'完成');};await showDiff({stash:s.ref},s.ref+' · '+s.subject,'STASH / SAVED CHANGES',[button('应用',()=>operation('stashApply','应用 Stash','把储藏修改应用到当前工作区，保留 Stash。可能出现冲突。')),button('恢复并移除',()=>operation('stashPop','恢复并移除','应用成功后移除此 Stash；如果冲突，Git 会保留储藏。')),button('删除…',()=>operation('stashDrop','删除 Stash','此操作会删除所选储藏，可能永久丢失尚未提交的修改。\n确认删除 '+s.ref+'？'),'danger')]);}
async function stashSave(){if(!state)return toast('请先打开仓库',true);const values=await modal('保存到 Stash','储藏已跟踪文件的修改，并从工作区移除。可选择同时保存未跟踪文件；忽略文件不会保存。',[{name:'message',label:'储藏说明',placeholder:'例如：进行中的登录界面'},{name:'includeUntracked',label:'同时保存未跟踪文件',type:'checkbox',checked:true}],'保存修改');if(values)await act('stashSave',values,'修改已存入 Stash');}
async function showConflict(file){const seq=++detailSeq,epoch=repoEpoch,repo=state.repo;const valid=()=>seq===detailSeq&&epoch===repoEpoch&&repo===state?.repo;$('detailTitle').textContent=file.path;$('detailType').textContent='CONFLICT RESOLVER';$('detailActions').replaceChildren();$('detailBody').replaceChildren(el('div','detail-note','读取冲突内容…'));try{const c=await api.conflict(file.path);if(seq!==detailSeq)return;const pane=el('div','conflict-pane');const columns=el('div','conflict-columns');for(const [title,text] of [['当前分支 / OURS',c.ours],['传入修改 / THEIRS',c.theirs]]){const col=el('div');col.append(el('h3','',title),el('pre','',text||'（该侧无文件内容）'));columns.append(col);}const editor=el('textarea');editor.value=c.content;editor.setAttribute('aria-label','冲突解决结果');editor.spellcheck=false;const tools=el('div','detail-actions');tools.append(button('使用当前版本',()=>editor.value=c.ours),button('使用传入版本',()=>editor.value=c.theirs));pane.append(columns,el('h3','','最终结果 · 可手动编辑'),tools,el('p','hint','编辑并清除所有冲突标记后保存。保存会覆盖此工作区文件并将其暂存；空内容会生成空文件，而不是删除文件。删除/重命名和二进制冲突请用外部 Git 工具处理。'),editor);$('detailBody').replaceChildren(pane);$('detailActions').append(button('保存并标记已解决',async()=>{if(!valid()||!await modal('保存冲突解决结果','覆盖工作区文件并暂存：'+file.path+'\n请确认最终编辑结果正确。',[],'保存并暂存')||!valid())return;await task(async()=>{if(!valid())return;await api.resolve({file:file.path,content:editor.value});if(!valid())return;await refresh();resetDetail();toast('冲突结果已保存并暂存；请完成提交。');},'保存解决结果…');},'primary'));}catch(e){if(seq===detailSeq)$('detailBody').replaceChildren(el('div','detail-note',e.message));}}
$('openRepo').onclick=choose;$('emptyOpen').onclick=choose;document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));$('search').oninput=renderList;$('refresh').onclick=()=>task(refresh,'刷新仓库…');$('reveal').onclick=()=>task(()=>api.reveal());$('newBranch').onclick=async()=>{if(!state)return toast('请先打开仓库',true);const v=await modal('创建分支','从当前 HEAD 创建并立即切换到新分支。',[{name:'name',label:'分支名',required:true,placeholder:'feature/my-change'}],'创建并切换');if(v)await act('createBranch',v,'已创建分支');};
for(const action of ['fetch','pull','push'])$(action).onclick=async()=>{if(!state)return toast('请先打开仓库',true);if(action!=='fetch'&&!await modal(action==='push'?'推送提交':'拉取更新',action==='push'?'推送当前分支到配置的上游远程仓库。不会强制推送。':'从当前上游拉取，仅允许快进更新；分叉时不会自动合并。',[],action==='push'?'推送':'拉取'))return;await act(action,{},'远程操作完成');};
$('commit').onclick=reviewCommit;$('abortMerge').onclick=async()=>{if(await modal('中止合并','撤销本次合并的结果。手动编辑的冲突解决内容可能丢失；合并前的未提交修改也可能无法恢复。',[],'中止合并'))await act('abortMerge',{},'已中止合并');};
document.addEventListener('keydown',e=>{if(e.target.closest?.('#terminalPanel'))return;if((e.ctrlKey||e.metaKey)&&e.key==='o'){e.preventDefault();if(!$('modal').open)choose();}if(e.key==='F5'){e.preventDefault();task(refresh,'刷新仓库…');}});window.addEventListener('focus',()=>{if(state&&!loading&&!$('modal').open)task(refresh,'同步工作区…');});recent().catch(e=>toast(e.message,true));renderList();

// Repository-scoped drafts never leave this machine.
let repoEpoch=0,refreshTicket=0,pendingRefresh=false,refreshRunning=false;
function draftKey(){return 'branchcraft.commit.'+state?.repo;}
function saveDraft(){if(!state)return;try{localStorage.setItem(draftKey(),$('commitMessage').value);}catch(e){toast('草稿无法写入本机存储：'+e.message,true);}}
function loadDraft(){try{$('commitMessage').value=localStorage.getItem(draftKey())||'';}catch{$('commitMessage').value='';}}
$('commitMessage').addEventListener('input',saveDraft);
function requestRefresh(){pendingRefresh=true;}
setInterval(async()=>{if(!pendingRefresh||refreshRunning||loading||!state||$('modal').open||$('reviewDialog').open||$('recoveryDialog').open)return;pendingRefresh=false;refreshRunning=true;try{await refresh();}catch(e){toast('自动刷新失败：'+e.message,true);}finally{refreshRunning=false;}},350);
api.onRepositoryChanged(event=>{if(state&&event.repo===state.repo)requestRefresh();});
async function reviewCommit(){
 if(!state||loading)return;const message=$('commitMessage').value;if(!message.trim())return toast('请填写提交说明',true);
 if(state.files.some(f=>f.conflict))return toast('请先解决所有冲突',true);
 if($('reviewDialog').open)return;const epoch=repoEpoch,repo=state.repo;const preview=await task(()=>api.commitPreview(),'读取提交审阅…');if(!preview||epoch!==repoEpoch)return;
 if(!preview.files.length)return toast('没有已暂存文件',true);
 const additions=preview.diff.split('\n').filter(l=>l.startsWith('+')&&!l.startsWith('+++')).length,deletions=preview.diff.split('\n').filter(l=>l.startsWith('-')&&!l.startsWith('---')).length;
 $('reviewMessage').textContent=message;$('reviewFiles').replaceChildren(el('li','',preview.files.length+' 个文件 · +'+additions+' / −'+deletions+' 行（不含二进制）'),...preview.files.map(f=>el('li','',f.path+(f.y!==' '?' · 另有未暂存修改':''))));
 diffText(preview.diff,$('reviewDiff'));$('reviewFeedback').textContent='只提交下列暂存内容；未暂存修改不会进入本次提交。';
 const dialog=$('reviewDialog');dialog.oncancel=e=>{if(loading)e.preventDefault();};dialog.onclose=requestRefresh;dialog.showModal();$('reviewCancel').onclick=()=>{if(!loading)dialog.close();};
 $('reviewConfirm').onclick=async()=>{if(loading||epoch!==repoEpoch||repo!==state.repo)return;
  $('reviewConfirm').disabled=true;$('reviewCancel').disabled=true;$('reviewFeedback').textContent='正在执行 Git 提交与 hooks…';
  const ok=await task(async()=>{try{const output=await api.action('commit',{message,token:preview.token});if(epoch!==repoEpoch)return false;$('commitMessage').value='';saveDraft();await refresh();toast('提交已创建'+(output?'\n'+output:''));return true;}catch(e){$('reviewFeedback').textContent='提交失败，草稿已保留。请检查以下 Git / hook 输出；暂存内容变化后需取消并重新审阅。\n'+e.message;throw e;}},'执行 Git / hooks…');
  $('reviewConfirm').disabled=false;$('reviewCancel').disabled=false;if(ok)dialog.close();
 };
}
$('recoveryOpen').onclick=()=>openRecovery().catch(e=>toast(e.message,true));
let recoverySession=0;
async function openRecovery(){
 if(!state||loading||$('recoveryDialog').open)return;
 const epoch=repoEpoch,repo=state.repo,session=++recoverySession,dialog=$('recoveryDialog');
 const valid=()=>session===recoverySession&&epoch===repoEpoch&&repo===state?.repo;
 const rows=await api.recoveryList();if(!valid())return;
 $('recoveryRows').replaceChildren();$('recoveryContent').textContent='选择记录预览。预览内容是原始备份，不是当前文件。';$('recoveryRestore').disabled=true;
 let chosen=null,previewSeq=0;
 for(const row of rows){const b=button(row.file+' · '+new Date(row.createdAt).toLocaleString()+' · '+row.operation+' / '+row.outcome+' · '+row.bytes+' B',async()=>{
  const ticket=++previewSeq;chosen=null;$('recoveryRestore').disabled=true;$('recoveryContent').textContent='正在读取备份…';
  try{const data=await api.recoveryPreview(row.id);if(!valid()||!dialog.open||ticket!==previewSeq)return;
   chosen=data;$('recoveryRestore').disabled=false;
   if(!data.exists)$('recoveryContent').textContent='备份状态：文件不存在。恢复将删除当前工作区文件。';
   else{const bytes=Uint8Array.from(atob(data.content),c=>c.charCodeAt(0));$('recoveryContent').textContent=new TextDecoder('utf-8').decode(bytes.slice(0,524288))+(bytes.length>524288?'\n（预览截断；恢复仍使用完整字节）':'');}
  }catch(e){if(valid()&&ticket===previewSeq)toast(e.message,true);}
 },'recovery-row');$('recoveryRows').append(b);}
 if(!rows.length)$('recoveryRows').append(el('p','muted','当前仓库暂无恢复记录。'));
 dialog.onclose=()=>{previewSeq++;chosen=null;requestRefresh();};
 $('recoveryClose').onclick=()=>dialog.close();
 $('recoveryRestore').onclick=async()=>{
  if(!chosen||!valid()||loading)return;const backup=chosen;dialog.close();
  if(!await modal('恢复此备份？','覆盖工作区文件：'+backup.file+'。暂存区保持不变。覆盖前会再备份当前内容。',[],'恢复备份')||!valid())return;
  await task(async()=>{if(!valid())return;await api.recoveryRestore({id:backup.id,token:backup.token});if(!valid())return;await refresh();toast('备份已恢复到工作区，未修改暂存区。');});if(valid())await openRecovery();
 };
 $('recoveryClear').onclick=async()=>{
  if(!valid()||loading)return;dialog.close();
  if(await modal('清空当前仓库恢复记录？','这些本地备份将永久删除。不会删除其他仓库的记录或当前工作区文件。',[],'永久清空')&&valid())await task(async()=>{if(!valid())return;await api.recoveryClear();toast('当前仓库恢复记录已清空');});
  if(valid())await openRecovery();
 };
 dialog.showModal();
}
