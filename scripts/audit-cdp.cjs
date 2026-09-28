const fs = require('node:fs');
const path = require('node:path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
class CDP {
  constructor(url) {
    this.ws = new WebSocket(url); this.next = 0; this.pending = new Map(); this.events = [];
    this.ready = new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    this.ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id) { const p = this.pending.get(m.id); if (p) { clearTimeout(p.timer); this.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } }
      else this.events.push(m);
    };
  }
  async send(method, params = {}) {
    await this.ready;
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
      this.pending.set(id, { resolve, reject, timer }); this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression, contextId) {
    const r = await this.send('Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  }
  close() { this.ws.close(); }
}
async function connect() {
  const list = await (await fetch('http://127.0.0.1:9337/json/list')).json();
  const main = new CDP(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  const web = new CDP(list.find(t => t.type === 'iframe' && t.url.includes('jigyasudham.veto-vscode')).webSocketDebuggerUrl);
  await web.send('Runtime.enable'); await sleep(100);
  let context;
  for (const event of web.events.filter(e => e.method === 'Runtime.executionContextCreated')) {
    const id = event.params.context.id;
    if (await web.eval('!!document.getElementById("tabsNav")', id).catch(() => false)) context = id;
  }
  if (!context) throw new Error('HUD execution context not found');
  return { main, web, context, eval: expr => web.eval(expr, context), close: () => { main.close(); web.close(); } };
}
async function hostCommand(c) {
  const { dir } = JSON.parse(fs.readFileSync('docs/audit-evidence/live-host.json', 'utf8'));
  const id = Date.now() + '-' + Math.random();
  fs.writeFileSync(path.join(dir, 'command.json'), JSON.stringify({ ...c, id }));
  for (let i = 0; i < 100; i++) {
    await sleep(200);
    try { const res = JSON.parse(fs.readFileSync(path.join(dir, 'response.json'), 'utf8')); if (res.id === id) { if (res.error) throw new Error(res.error); return res; } } catch(e) { if (e.message.startsWith('Error:')) throw e; }
  }
  throw new Error('Host command timeout');
}
module.exports = { CDP, connect, hostCommand, sleep };
if (require.main === module) (async () => {
  const c = await connect();
  try {
    if (process.argv[2] === 'main') console.log(JSON.stringify(await c.main.eval(process.argv[3]), null, 2));
    else if (process.argv[2] === 'eval') console.log(JSON.stringify(await c.eval(process.argv[3]), null, 2));
    else console.log(JSON.stringify({ contexts: c.web.events.filter(e => e.method === 'Runtime.executionContextCreated'), hud: await c.eval('({width:innerWidth,height:innerHeight,title:document.title,projects:document.getElementById("projectSelect").options.length,text:document.body.innerText.slice(0,1000)})') }, null, 2));
  } finally { c.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
