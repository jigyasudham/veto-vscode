const fs=require('node:fs');
const {connect,hostCommand,sleep}=require('./audit-cdp.cjs');
(async()=>{const c=await connect();try{
 await hostCommand({type:'setting',key:'dbPath',value:''});
 await c.eval("switchTab('explorer');explorerSearchQuery='SYNTHETIC';setExplorerKind('transcripts')");
 await sleep(1800);
 const text=await c.eval("document.getElementById('explorerItems').innerText");
 const notifications=await c.main.eval("Array.from(document.querySelectorAll('.notification-list-item')).map(e=>e.innerText)");
 fs.writeFileSync('docs/audit-evidence/auth-transcripts.json',JSON.stringify({text,notifications},null,2));
 console.log(JSON.stringify({text,notifications},null,2));
}finally{c.close()}})().catch(e=>{console.error(e);process.exitCode=1});
