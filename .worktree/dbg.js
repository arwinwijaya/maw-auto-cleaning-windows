const path = require('node:path');
const cleanupTargets = require('../lib/cleanup-targets.js');
const cleanupEngine = require('../lib/cleanup-engine.js');

const orig = [...cleanupTargets.TARGETS];
cleanupTargets.TARGETS.length = 0;
cleanupTargets.TARGETS.push({ id: 'test-temp-a', internalPath: '/cleanup/test-temp-a', enabled: true });

const now = Date.now();
const old = now - 48*60*60*1000;
const recent = now - 1*60*60*1000;
const dirs = {
  '/cleanup/test-temp-a': [{name:'old.txt',isDir:false},{name:'recent.txt',isDir:false},{name:'sub1',isDir:true}],
  '/cleanup/test-temp-a/sub1': [{name:'old2.txt',isDir:false},{name:'sub2',isDir:true}],
  '/cleanup/test-temp-a/sub1/sub2': [],
};
const stats = {
  '/cleanup/test-temp-a': {isDirectory:()=>true,isFile:()=>false,isSymbolicLink:()=>false,isReparsePoint:()=>false},
  '/cleanup/test-temp-a/old.txt': {size:1024,mtimeMs:old,isFile:()=>true,isDirectory:()=>false,isSymbolicLink:()=>false,isReparsePoint:()=>false},
  '/cleanup/test-temp-a/recent.txt': {size:512,mtimeMs:recent,isFile:()=>true,isDirectory:()=>false,isSymbolicLink:()=>false,isReparsePoint:()=>false},
  '/cleanup/test-temp-a/sub1': {isDirectory:()=>true,isFile:()=>false,isSymbolicLink:()=>false,isReparsePoint:()=>false},
  '/cleanup/test-temp-a/sub1/old2.txt': {size:2048,mtimeMs:old,isFile:()=>true,isDirectory:()=>false,isSymbolicLink:()=>false,isReparsePoint:()=>false},
  '/cleanup/test-temp-a/sub1/sub2': {isDirectory:()=>true,isFile:()=>false,isSymbolicLink:()=>false,isReparsePoint:()=>false},
};
const fs = {
  async readdir(p){ if(!dirs[p]){const e=new Error('ENOENT');e.code='ENOENT';throw e;} return dirs[p].map(i=>({name:i.name,isDirectory:()=>i.isDir,isFile:()=>!i.isDir,isSymbolicLink:()=>false,isReparsePoint:()=>false})); },
  async lstat(p){ if(!stats[p]){const e=new Error('ENOENT');e.code='ENOENT';throw e;} return stats[p]; },
  async stat(p){ return this.lstat(p); },
  async realpath(p){ return p; },
};
(async()=>{
  const r = await cleanupEngine.preview(['test-temp-a'], { minAgeHours: 24, fs, now: () => old + 48*60*60*1000 });
  console.log(JSON.stringify(r,null,2));
})().catch(e=>{console.error(e); process.exit(1);});
