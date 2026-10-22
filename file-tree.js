/* Shared pure tree builder: exact Git paths, folders first, stable ordering. */
(function(root){
 'use strict';
 function build(files){
  const tree={dirs:new Map(),files:[],count:0};
  for(const file of files){let node=tree;node.count++;const parts=file.path.split('/');parts.pop();for(const part of parts){if(!node.dirs.has(part))node.dirs.set(part,{dirs:new Map(),files:[],count:0});node=node.dirs.get(part);node.count++;}node.files.push(file);}
  function sort(node){node.dirs=new Map([...node.dirs].sort(([a],[b])=>a.localeCompare(b)));node.files.sort((a,b)=>a.path.localeCompare(b.path));for(const child of node.dirs.values())sort(child);return node;}
  return sort(tree);
 }
 const api={build};if(typeof module!=='undefined')module.exports=api;else root.FileTree=api;
})(typeof globalThis!=='undefined'?globalThis:this);
