const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

(async () => {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    // vscode — provided by the extension host at runtime
    // node:* — built-in Node modules, available in the extension host
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    sourcemap: true,
  });

  if (watch) {
    await ctx.watch();
    console.log('Watching...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log('Build complete.');
  }
})();
