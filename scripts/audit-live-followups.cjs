const fs = require('node:fs');
const { connect, hostCommand, sleep } = require('./audit-cdp.cjs');
const out = 'docs/audit-evidence';
async function result(c, timeout = 140000) {
 const start=Date.now();
 while(Date.now()-start<timeout){await sleep(500);const s=await c.eval(`({running:!document.getElementById('activeProgressCard').classList.contains('hidden'),visible:!document.getElementById('workflowResultCard').classList.contains('hidden'),action:document.getElementById('resultActionName').textContent,verdict:document.getElementById('resultVerdict').textContent,body:document.getElementById('resultBody').textContent})`);if(!s.running&&s.visible)return s;}
 return {timeout:true};
}
(async()=>{
 const c=await connect();
 try{
  await hostCommand({type:'setting',key:'dbPath',value:''});
  await hostCommand({type:'setting',key:'cliPath',value:''});
  await c.eval("switchTab('settings');document.getElementById('btnRunDiagnostics').click()");
  const diagnostics=await result(c);
  fs.writeFileSync(out+'/auth-diagnostics-default.json',JSON.stringify(diagnostics,null,2));
  console.log('Default DB diagnostics:',diagnostics.verdict,diagnostics.body?.slice(0,180));
  await c.eval("switchTab('explorer');setExplorerKind('sessions')");await sleep(800);
  const sessions=await c.eval("Array.from(document.querySelectorAll('.explorer-card')).map(e=>e.innerText)");
  const checkpoint=JSON.parse(JSON.parse(fs.readFileSync(out+'/auth-checkpoint.json')).result.body).session_id;
  await c.eval(`openResumeModal(${JSON.stringify(checkpoint)},'claude');document.getElementById('btnResumeConsole').click()`);
  const resume=await result(c);
  fs.writeFileSync(out+'/auth-resume.json',JSON.stringify({sessionsBefore:sessions,...resume},null,2));
  console.log('Actual saved session resume:',resume.verdict,resume.body?.slice(0,200));
  // Use a real timer-triggered process timeout through the settings/UI path.
  await hostCommand({type:'setting',key:'actionTimeoutMs',value:1000});
  await hostCommand({type:'openFile'});
  await c.eval("switchTab('workflows');document.getElementById('btnReviewActiveFile').click()");
  const timed=await result(c,15000);
  fs.writeFileSync(out+'/auth-timeout.json',JSON.stringify(timed,null,2));
  console.log('One-second timeout result:',timed);
  await hostCommand({type:'setting',key:'actionTimeoutMs',value:120000});
  await hostCommand({type:'openFile'});
  await c.eval("document.getElementById('btnReviewActiveFile').click()");await sleep(1000);
  await c.eval("document.getElementById('btnCancelAction').click()");await sleep(1500);
  const cancelled=await c.eval("({badge:document.getElementById('resultVerdict').textContent,result:document.getElementById('resultBody').textContent,visible:!document.getElementById('workflowResultCard').classList.contains('hidden'),logs:document.getElementById('consoleViewport').innerText})");
  fs.writeFileSync(out+'/auth-cancel.json',JSON.stringify(cancelled,null,2));
  console.log('Cancelled action display:',cancelled.badge,cancelled.result);
  // Backend config failure through the visible Auto-Detect control.
  await c.eval("switchTab('settings')");await sleep(400);
  await c.eval("document.getElementById('btnDetectCli').click();document.getElementById('btnSaveSettings').click()");await sleep(600);
  await c.eval("document.getElementById('btnRunDiagnostics').click()");
  const invalidCli=await result(c);
  fs.writeFileSync(out+'/auth-cli-autodetect.json',JSON.stringify(invalidCli,null,2));
  console.log('Auto-detected CLI result:',invalidCli.verdict,invalidCli.body);
  await hostCommand({type:'setting',key:'cliPath',value:''});
  // Authentic transcript search for only the synthetic fixture's saved content.
  await c.eval("switchTab('explorer');setExplorerKind('transcripts');document.getElementById('explorerSearch').value='SYNTHETIC';document.getElementById('explorerSearch').dispatchEvent(new Event('input'))");
  await sleep(5000);
  const transcript=await c.eval("document.getElementById('explorerItems').innerText");
  fs.writeFileSync(out+'/auth-transcripts.json',JSON.stringify({text:transcript},null,2));
  console.log('Transcript query:',transcript.slice(0,250));
 }finally{c.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
