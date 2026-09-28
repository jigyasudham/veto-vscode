const fs = require('node:fs');
const { connect, hostCommand, sleep } = require('./audit-cdp.cjs');
const out = 'docs/audit-evidence';
const themes = [ ['dark', 'Dark Modern'], ['light', 'Light Modern'], ['hc-dark', 'Default High Contrast'], ['hc-light', 'Default High Contrast Light'] ];
async function resize(c, desired) {
  const r = await c.main.eval("document.querySelector('.primary-sidebar-sash').getBoundingClientRect().toJSON()");
  const w = await c.eval('innerWidth');
  const x = r.x + r.width / 2, y = r.y + 150;
  await c.main.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await c.main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + desired - w, y, button: 'left', buttons: 1 });
  await c.main.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + desired - w, y, button: 'left', clickCount: 1 });
  await sleep(200);
}
async function screenshot(c, name) {
  const r = await c.main.eval("document.querySelector('iframe.webview').getBoundingClientRect().toJSON()");
  const image = await c.main.send('Page.captureScreenshot', { format: 'png', clip: { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 } });
  fs.writeFileSync(out + '/' + name + '.png', Buffer.from(image.data, 'base64'));
}
const measure = `(() => {
 const visible = e => {const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&r.bottom>0&&r.top<innerHeight};
 const selectors=['.tab-btn.active','.badge.yellow','.badge.green','.sub-pill.active','.explorer-card.selected','.explorer-card.selected .explorer-card-meta','.btn','.btn.sec'];
 const colors=selectors.flatMap(sel=>{const e=document.querySelector(sel);if(!e||!visible(e))return [];const s=getComputedStyle(e);let chain=[];for(let n=e;n;n=n.parentElement){const cs=getComputedStyle(n);chain.push({color:cs.backgroundColor,opacity:cs.opacity})}return [{selector:sel,text:e.textContent.slice(0,45),fg:s.color,bg:s.backgroundColor,fontSize:s.fontSize,opacity:s.opacity,backgrounds:chain}]});
 return {width:innerWidth,height:innerHeight,theme:document.body.dataset.vscodeThemeId,themeKind:document.body.className,bodyWidth:document.body.scrollWidth,
  overflowControls:Array.from(document.querySelectorAll('button,input,select,textarea')).filter(e=>visible(e)&&!e.closest('#tabsNav')).filter(e=>{const r=e.getBoundingClientRect();return r.right>innerWidth+1||r.left < -1}).map(e=>({id:e.id,text:e.textContent.slice(0,40),rect:e.getBoundingClientRect().toJSON()})),colors};
})()`;
(async () => {
 const c=await connect(), results=[];
 try {
  for(const [theme,id] of themes){
   await hostCommand({type:'theme',value:id}); await sleep(500);
   for(const width of [220,300,480]){
    await resize(c,width);
    for(const tab of ['dashboard','explorer','workflows','console','settings']){
     await c.eval(`switchTab('${tab}');window.scrollTo(0,0)`); await sleep(350);
     if(tab==='explorer') {await c.eval("setExplorerKind('sessions')");await sleep(150);await c.eval("document.querySelector('.explorer-card')?.classList.add('selected')");}
     const name=`${theme}-${width}-${tab}`;
     const m=await c.eval(measure); results.push({name,...m});
     await screenshot(c,name);
    }
    console.log('Captured',theme,width);
   }
  }
  // Drawer stacking, keyboard, tab scroll, and zoom on the actual rendered HUD.
  await hostCommand({type:'theme',value:'Light Modern'});await resize(c,300);
  await c.eval("switchTab('explorer');setExplorerKind('sessions');window.scrollTo(0,0)");await sleep(350);
  await c.eval("document.querySelector('.explorer-card').focus()");
  await c.web.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await c.web.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  const enterOpens=await c.eval("!document.getElementById('detailDrawer').classList.contains('hidden')");
  await c.eval("document.querySelector('.explorer-card').click()");await sleep(350);
  const drawer=await c.eval("({ariaHidden:document.getElementById('detailDrawer').getAttribute('aria-hidden'),focus:document.activeElement.className,hitAtNav:(()=>{const r=document.getElementById('tabsNav').getBoundingClientRect();return document.elementFromPoint(r.x+20,r.y+10)?.outerHTML.slice(0,200)})()})");
  await screenshot(c,'light-300-drawer');
  await c.web.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  const escapeCloses=await c.eval("document.getElementById('detailDrawer').classList.contains('hidden')");
  await c.eval("closeDetailDrawer();switchTab('dashboard');document.getElementById('tabsNav').scrollLeft=0");await sleep(300);
  const before=await c.eval("document.getElementById('tabsNav').scrollLeft");
  await c.eval("document.getElementById('tabScrollNext').click()");await sleep(400);
  const after=await c.eval("document.getElementById('tabsNav').scrollLeft");
  await hostCommand({type:'zoom',value:3.8});await sleep(400);
  await c.eval("switchTab('settings');window.scrollTo(0,0)");await sleep(300);
  await screenshot(c,'light-zoom200-settings');
  const zoom=await c.eval(measure);
  await hostCommand({type:'zoom',value:0});
  fs.writeFileSync(out+'/visual-results.json',JSON.stringify({results,interactions:{enterOpens,escapeCloses,drawer,tabScroll:{before,after}},zoom},null,2));
  console.log('Visual matrix complete:',results.length,'screenshots plus drawer and zoom');
 }finally{c.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
