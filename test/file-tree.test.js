const test=require('node:test'),assert=require('node:assert/strict');
const {build}=require('../src/shared/file-tree');
test('folder tree preserves nested, Unicode, root and duplicate status paths',()=>{
 const input=[{path:'src/中文/a.js'},{path:'root.txt'},{path:'src/z.js'},{path:'a/b.js'},{path:'src/z.js'}];
 const tree=build(input);assert.equal(tree.count,5);assert.deepEqual([...tree.dirs.keys()],['a','src']);assert.equal(tree.files[0].path,'root.txt');assert.equal(tree.dirs.get('src').count,3);assert.equal(tree.dirs.get('src').dirs.get('中文').files[0].path,'src/中文/a.js');assert.equal(input[0].path,'src/中文/a.js');assert.equal(build([]).count,0);
});
