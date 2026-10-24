'use strict';

// Read-only GitService.git queries (execFile, no shell or repository writes).
// head: full OID or null; refs: full local or remote-tracking references.
// comparison: {type: root|parent|first-parent, base: OID|null, description}.
// diff-tree --root compares against the empty tree without creating it.

class GraphService {
 constructor(service){this.service=service;}
 git(args,allowFailure=false){return this.service.git(args,allowFailure);}
 async references(){
  const raw=await this.git(['for-each-ref','--format=%(refname)%00%(objectname)','refs/heads/','refs/remotes/']);
  const current=(await this.git(['symbolic-ref','--quiet','HEAD'],true)).trim();
  return raw.split('\n').filter(Boolean).map(line=>{const [ref,hash]=line.split('\0');const remote=ref.startsWith('refs/remotes/');return {ref,hash,name:ref.slice(remote?13:11),remote,current:ref===current};});
 }
 async graphLog(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid graph query');
  const {ref='',limit=300}=input;
  if(typeof ref!=='string'||!Number.isInteger(limit)||limit<1||limit>2000)throw Error('Invalid ref or limit (integer 1..2000)');
  const refs=await this.references();
  if(ref&&!refs.some(r=>r.ref===ref))throw Error('Expected an existing full branch ref');
  const head=(await this.git(['rev-parse','--verify','--quiet','HEAD^{commit}'],true)).trim()||null;
  const branches=refs.map(({hash,...branch})=>branch);
  const tips=[...new Set(ref?[refs.find(r=>r.ref===ref).hash]:[...refs.map(r=>r.hash),head].filter(Boolean))];
  if(!tips.length)return {commits:[],branches,hasMore:false,head};
  const raw=await this.git(['log','--topo-order',`--max-count=${limit+1}`,'-z','--format=%H%x00%P%x00%an%x00%aI%x00%s',...tips,'--']);
  const fields=raw.split('\0');if(fields.at(-1)==='')fields.pop();
  const commits=[];
  for(let i=0;i<fields.length;i+=5){const [hash,parents,author,date,subject]=fields.slice(i,i+5);commits.push({hash,parents:parents?parents.split(' '):[],author,date,subject,refs:refs.filter(r=>r.hash===hash).map(r=>r.ref)});}
  return {commits:commits.slice(0,limit),branches,hasMore:commits.length>limit,head};
 }
 async graphCommit(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid commit query');
  const {hash,file}=input;
  if(typeof hash!=='string'||!new RegExp('^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$').test(hash))throw Error('Expected full commit OID');
  if(file!==undefined&&(typeof file!=='string'||!file||file.includes('\0')))throw Error('Invalid file');
  const type=(await this.git(['cat-file','-t',hash],true)).trim();
  if(type!=='commit')throw Error('Commit does not exist or is not a commit');
  const raw=await this.git(['log','--no-walk','-1','-z','--format=%H%x00%P%x00%an%x00%aI%x00%s%x00%b',hash,'--']);
  const [oid,parentText,author,date,subject,body]=raw.split('\0');
  const parents=parentText?parentText.split(' '):[];
  const revisions=parents.length?[parents[0],oid]:[oid];
  const common=['diff-tree','-r','--root','--no-commit-id','--no-ext-diff','--no-textconv','-M'];
  const names=await this.git([...common,'--name-status','-z',...revisions,'--']);
  const tokens=names.split('\0');if(tokens.at(-1)==='')tokens.pop();
  const files=[];
  for(let i=0;i<tokens.length;){const status=tokens[i++];if(new RegExp('^[RC]').test(status)){const oldPath=tokens[i++],path=tokens[i++];files.push({status,path,oldPath});}else files.push({status,path:tokens[i++]});}
  if(file!==undefined&&!files.some(f=>f.path===file))throw Error('File is not in commit changes');
  const selected=file===undefined?null:files.find(f=>f.path===file);
  const paths=selected?[...new Set([selected.oldPath,selected.path].filter(x=>x!==undefined))].map(x=>`:(literal)${x}`):[];
  const diff=await this.git([...common,'--patch','--no-color',...revisions,'--',...paths]);
  const comparison={type:parents.length>1?'first-parent':parents.length?'parent':'root',base:parents[0]||null,description:parents.length>1?'Merge: compared with first parent':parents.length?'Compared with parent':'Root: compared with empty tree'};
  return {hash:oid,parents,author,date,subject,body,files,diff,comparison};
 }
}
module.exports={GraphService};
