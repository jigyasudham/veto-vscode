const fs = require('node:fs');
const out = 'docs/audit-evidence';
const files = fs.readdirSync(out).filter(x => x.endsWith('.png') && !x.includes('zoom200-settings'));
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Veto 1.2.0 visual audit</title>
<style>body{font:15px system-ui;margin:24px;background:#e9edf2;color:#18212f}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:20px}figure{margin:0;padding:12px;background:white;border-radius:8px}img{max-width:100%;height:400px;object-fit:contain;object-position:top}figcaption{font-weight:600;margin-bottom:8px}</style></head>
<body><h1>Veto 1.2.0 visual audit</h1><p>Real packaged extension in VS Code 1.139.1. Four themes, three sidebar widths, five tabs. Click an image for full resolution. Labels give requested CSS sidebar width; actual widths and measurements are in visual-results.json. The zoom view uses a full-window capture because cropped coordinates change with Electron zoom.</p><main>
${files.map(f => `<figure><figcaption>${f.replace('.png','')}</figcaption><a href="${f}"><img loading="lazy" src="${f}" alt="${f}"></a></figure>`).join('\n')}
</main></body></html>`;
fs.writeFileSync(out+'/index.html',html);
console.log(files.length+' gallery images');
