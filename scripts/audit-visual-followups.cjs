const fs = require('node:fs');
const path = require('node:path');
const { connect, hostCommand, sleep } = require('./audit-cdp.cjs');
const out = 'docs/audit-evidence';
(async()=>{
 const c=await connect();
 try{
  const {dir}=JSON.parse(fs.readFileSync(out+'/live-host.json'));
  await hostCommand({type:'setting',key:'dbPath',value:path.join(dir,'fixture.db')});
  await hostCommand({type:'theme',value:'Default High Contrast Light'});
  await c.eval("switchTab('explorer');setExplorerKind('sessions');window.scrollTo(0,0)");await sleep(800);
  await c.eval("document.querySelector('.explorer-card').classList.add('selected')");await sleep(400);
  const colors=await c.eval(`['.explorer-card.selected .explorer-card-title span','.explorer-card.selected .explorer-card-meta','.explorer-card:not(.selected) .explorer-card-title','.logo'].map(s=>{const e=document.querySelector(s),c=getComputedStyle(e);return {selector:s,foreground:c.color,background:c.backgroundColor,selectionVar:getComputedStyle(document.body).getPropertyValue('--vscode-list-activeSelectionForeground'),titleVar:getComputedStyle(document.body).getPropertyValue('--vscode-sideBarTitle-foreground')}})`);
  await c.eval("document.querySelector('.explorer-card').click()");await sleep(400);
  await c.web.send('Accessibility.enable');
  const ax=await c.web.send('Accessibility.getFullAXTree');
  const dialogs=ax.nodes.filter(n=>n.role?.value==='dialog').map(n=>({ignored:n.ignored,name:n.name?.value,role:n.role.value}));
  fs.writeFileSync(out+'/visual-a11y.json',JSON.stringify({colors,dialogs},null,2));
  await c.eval("closeDetailDrawer()");
  await hostCommand({type:'theme',value:'Light Modern'});
  await hostCommand({type:'zoom',value:3.8});await sleep(600);
  await c.eval("switchTab('settings');window.scrollTo(0,180)");await sleep(300);
  const zoom=await c.eval("({width:innerWidth,height:innerHeight,bodyWidth:document.body.scrollWidth,settings:document.getElementById('panel-settings').getBoundingClientRect().toJSON(),text:document.body.innerText.slice(-900)})");
  const screenshot=await c.main.send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(out+'/light-zoom200-full-window.png',Buffer.from(screenshot.data,'base64'));
  fs.writeFileSync(out+'/zoom-full-window.json',JSON.stringify(zoom,null,2));
  await hostCommand({type:'zoom',value:0});
  console.log(JSON.stringify({colors,dialogs,zoom},null,2));
 }finally{c.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
