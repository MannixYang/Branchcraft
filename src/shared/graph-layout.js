(function(root){
 'use strict';
 function validHash(hash){return typeof hash==='string'&&hash.length>0&&hash.trim()===hash;}
 function hashColor(hash){let color=2166136261;for(let i=0;i<hash.length;i++)color=Math.imul(color^hash.charCodeAt(i),16777619);return color>>>0;}
 function build(commits){
  if(!Array.isArray(commits))throw new TypeError('Expected an array of commits');
  const positions=new Map();
  for(let i=0;i<commits.length;i++){
   const commit=commits[i];
   if(!commit||typeof commit!=='object'||!validHash(commit.hash))throw new TypeError('Expected a non-empty commit hash');
   if(positions.has(commit.hash))throw new Error('Duplicate commit hash: '+commit.hash);
   positions.set(commit.hash,i);
  }
  for(let i=0;i<commits.length;i++){
   const parents=commits[i].parents===undefined?[]:commits[i].parents;
   if(!Array.isArray(parents)||parents.some(parent=>!validHash(parent)))throw new TypeError('Expected an array of parent hashes');
   if(new Set(parents).size!==parents.length)throw new Error('Duplicate parent hash');
   for(const parent of parents)if(positions.has(parent)&&positions.get(parent)<=i)throw new Error('Expected child-before-parent topological order');
  }
  const lanes=[],rows=[];let width=1;
  function freeColumn(){const column=lanes.indexOf(null);return column<0?lanes.length:column;}
  for(const commit of commits){
   const incoming=[];
   for(let column=0;column<lanes.length;column++)if(lanes[column]&&lanes[column].hash===commit.hash)incoming.push(column);
   const column=incoming.length?incoming[0]:freeColumn();
   const color=incoming.length?lanes[column].color:hashColor(commit.hash);
   const segments=[];
   for(let from=0;from<lanes.length;from++){
    const lane=lanes[from];if(!lane)continue;
    if(lane.hash===commit.hash)segments.push({from,to:column,start:0,end:24,color:lane.color});
    else segments.push({from,to:from,start:0,end:48,color:lane.color});
   }
   for(const from of incoming)lanes[from]=null;
   const parents=commit.parents||[];
   for(let i=0;i<parents.length;i++){
    const to=i===0?column:freeColumn(),edgeColor=i===0?color:hashColor(parents[i]);
    lanes[to]={hash:parents[i],color:edgeColor};
    segments.push({from:column,to,start:24,end:48,color:edgeColor});
   }
   while(lanes.length&&lanes[lanes.length-1]===null)lanes.pop();
   width=Math.max(width,column+1,lanes.length);
   rows.push({hash:commit.hash,column,segments,color});
  }
  return {rows,width};
 }
 const api={build};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.GraphLayout=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:this);
