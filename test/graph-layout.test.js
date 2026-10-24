const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const modulePath=path.join(__dirname,'..','src','shared','graph-layout.js');
const {build}=require(modulePath);
const node=(hash,...parents)=>({hash,parents});
function boundary(row,top){return row.segments.filter(s=>top?s.start===0:s.end===48).map(s=>[top?s.from:s.to,s.color]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);}
function verify(commits){
 const before=JSON.stringify(commits),layout=build(commits),{rows,width}=layout;
 assert.deepEqual(build(commits),layout);assert.equal(JSON.stringify(commits),before);
 assert.equal(rows.length,commits.length);assert.ok(Number.isInteger(width)&&width>=1);
 let maxColumn=0;
 rows.forEach((row,i)=>{
  assert.equal(row.hash,commits[i].hash);assert.ok(Number.isInteger(row.column)&&row.column>=0&&row.column<width);
  assert.ok(Number.isInteger(row.color)&&row.color>=0);maxColumn=Math.max(maxColumn,row.column);
  for(const s of row.segments){
   assert.deepEqual(Object.keys(s).sort(),['color','end','from','start','to']);
   assert.ok(Number.isInteger(s.color)&&s.color>=0);
   for(const key of ['from','to']){assert.ok(Number.isInteger(s[key])&&s[key]>=0&&s[key]<width);maxColumn=Math.max(maxColumn,s[key]);}
   assert.ok([0,24,48].includes(s.start)&&[0,24,48].includes(s.end)&&s.start<s.end);
   if(s.start===24)assert.equal(s.from,row.column);
   if(s.end===24)assert.equal(s.to,row.column);
  }
  assert.equal(row.segments.filter(s=>s.start===24).length,(commits[i].parents||[]).length);
  if(i)assert.deepEqual(boundary(rows[i-1],false),boundary(row,true));
  for(const top of [true,false]){const cols=boundary(row,top).map(s=>s[0]);assert.equal(new Set(cols).size,cols.length);}
 });
 assert.equal(width,maxColumn+1);
 rows.forEach((row,i)=>row.segments.filter(s=>s.start===24).forEach((edge,j)=>{
  const parent=commits[i].parents[j];let column=edge.to;
  const target=commits.findIndex(c=>c.hash===parent),last=target<0?rows.length-1:target;
  for(let k=i+1;k<=last;k++){
   const matches=rows[k].segments.filter(s=>s.start===0&&s.from===column&&s.color===edge.color);
   assert.equal(matches.length,1);const s=matches[0];
   assert.equal(s.end,k===target?24:48);column=s.to;
   if(k===target)assert.equal(column,rows[k].column);
  }
 }));
 return layout;
}
test('empty input and independent roots',()=>{
 assert.deepEqual(build([]),{rows:[],width:1});
 const {rows,width}=verify([node('a'),node('b'),node('c')]);
 assert.equal(width,1);assert.deepEqual(rows.map(r=>[r.column,r.segments]),[[0,[]],[0,[]],[0,[]]]);
});
test('linear history exact half-row segments and inherited color',()=>{
 const {rows,width}=verify([node('a','b'),node('b','c'),node('c')]);const color=rows[0].color;
 assert.equal(width,1);assert.ok(rows.every(r=>r.color===color));
 assert.deepEqual(rows.map(r=>r.segments),[
  [{from:0,to:0,start:24,end:48,color}],
  [{from:0,to:0,start:0,end:24,color},{from:0,to:0,start:24,end:48,color}],
  [{from:0,to:0,start:0,end:24,color}]
 ]);
});
test('fork keeps both child edges until common parent',()=>{
 const {rows,width}=verify([node('left','base'),node('right','base'),node('base')]);
 assert.equal(width,2);assert.deepEqual(rows.map(r=>r.column),[0,1,0]);
 assert.deepEqual(rows[2].segments.map(s=>[s.from,s.to,s.start,s.end]),[[0,0,0,24],[1,0,0,24]]);
});
test('merge diamond preserves all paths',()=>{
 assert.equal(verify([node('m','l','r'),node('l','b'),node('r','b'),node('b')]).width,2);
});
test('40-parent octopus has no forced lane cap',()=>{
 const parents=Array.from({length:40},(_,i)=>'p'+i);
 const {rows,width}=verify([node('octopus',...parents),...parents.map(p=>node(p,'base')),node('base')]);
 assert.equal(width,40);assert.deepEqual(rows[0].segments.map(s=>s.to),parents.map((_,i)=>i));
});
test('unrelated root preserves crossing lane',()=>{
 const {rows}=verify([node('tip','base'),node('other'),node('base')]);
 assert.equal(rows[1].column,1);assert.deepEqual(rows[1].segments,[{from:0,to:0,start:0,end:48,color:rows[0].color}]);
});
test('truncated parents remain open through final boundary',()=>{
 const {rows,width}=verify([node('m','missing-a','missing-b'),node('tip','missing-c'),node('root')]);
 assert.equal(width,4);assert.equal(boundary(rows[2],false).length,3);
});
test('reuse holes without moving live lanes',()=>{
 const {rows,width}=verify([node('m','a','b'),node('a'),node('new','c'),node('b'),node('c')]);
 assert.equal(width,2);assert.deepEqual(rows.map(r=>r.column),[0,0,0,1,0]);
});
test('immutable input and independent results',()=>{
 const input=Object.freeze([Object.freeze({hash:'a',parents:Object.freeze(['b'])}),Object.freeze(node('b'))]);
 const first=verify(input),second=build(input);first.rows[0].segments[0].to=100;assert.notDeepEqual(first,second);assert.deepEqual(build(input),second);
 assert.deepEqual(build([{hash:'root'}]).rows[0].segments,[]);
});
test('reject malformed nodes, duplicates and invalid topology',()=>{
 for(const input of [null,{},'a',[null],[{}],[{hash:''}],[{hash:7}],[{hash:' a'}],[{hash:'a',parents:null}],[{hash:'a',parents:'b'}],[{hash:'a',parents:['']}],[{hash:'a',parents:[null]}]])assert.throws(()=>build(input),TypeError);
 assert.throws(()=>build([node('a'),node('a')]),{message:'Duplicate commit hash: a'});
 assert.throws(()=>build([node('a','b','b')]),{message:'Duplicate parent hash'});
 for(const input of [[node('a','a')],[node('a'),node('b','a')],[node('a','b'),node('b','a')]])assert.throws(()=>build(input),{message:'Expected child-before-parent topological order'});
});
test('UMD browser, CommonJS and worker exports without dependencies',()=>{
 const source=fs.readFileSync(modulePath,'utf8');
 const browser={window:{}};vm.runInNewContext(source,browser);assert.equal(typeof browser.window.GraphLayout.build,'function');
 assert.equal(JSON.stringify(browser.window.GraphLayout.build([node('a','b'),node('b')])),JSON.stringify(build([node('a','b'),node('b')])));
 const common={module:{exports:{}}};vm.runInNewContext(source,common);assert.equal(typeof common.module.exports.build,'function');
 const worker={};vm.runInNewContext(source,worker);assert.equal(typeof worker.GraphLayout.build,'function');
});
test('seeded DAGs verify every edge and row boundary',()=>{
 let seed=123456789;function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
 for(let run=0;run<80;run++){
  const commits=Array.from({length:25},(_,i)=>node('n'+i));
  for(let i=0;i<commits.length;i++)for(let j=i+1;j<commits.length+2;j++)if(random()<0.09)commits[i].parents.push('n'+j);
  verify(commits);
 }
});
