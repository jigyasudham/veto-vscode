// Synthetic theme contrast checker for Veto HUD
// Audits standard VS Code themes and popular 3rd-party themes:
// Dark Modern, Light Modern, HC Dark, HC Light, Dracula, Nord, One Dark Pro, Solarized Dark, Solarized Light, GitHub Light

const fs = require('fs');

function parseHex(h) {
  h = h.replace(/^#/, '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length === 6) {
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  if (h.length === 8) {
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), parseInt(h.slice(6, 8), 16) / 255];
  }
  return [0, 0, 0, 1];
}

function parseRgb(str) {
  const m = str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (m) {
    return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), m[4] !== undefined ? parseFloat(m[4]) : 1];
  }
  if (str.startsWith('#')) return parseHex(str);
  return [0, 0, 0, 1];
}

function composite(fg, bg) {
  const a = fg[3];
  return [
    Math.round(fg[0] * a + bg[0] * (1 - a)),
    Math.round(fg[1] * a + bg[1] * (1 - a)),
    Math.round(fg[2] * a + bg[2] * (1 - a)),
    1
  ];
}

function relativeLuminance(rgb) {
  const [r, g, b] = rgb.slice(0, 3).map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fgRgb, bgRgb) {
  const l1 = relativeLuminance(fgRgb);
  const l2 = relativeLuminance(bgRgb);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

const themes = {
  'Dark Modern': {
    type: 'dark',
    'sideBar-background': '#181818',
    'foreground': '#cccccc',
    'sideBarTitle-foreground': '#cccccc',
    'editorWidget-background': '#1f1f1f',
    'button-background': '#0078d4',
    'button-foreground': '#ffffff',
    'button-secondaryBackground': '#313131',
    'button-secondaryForeground': '#cccccc',
    'list-activeSelectionBackground': '#04395e',
    'list-activeSelectionForeground': '#ffffff',
    'errorForeground': '#f14c4c',
    'textLink-foreground': '#4daafc'
  },
  'Light Modern': {
    type: 'light',
    'sideBar-background': '#f8f8f8',
    'foreground': '#616161',
    'sideBarTitle-foreground': '#616161',
    'editorWidget-background': '#ffffff',
    'button-background': '#0078d4',
    'button-foreground': '#ffffff',
    'button-secondaryBackground': '#e5e5e5',
    'button-secondaryForeground': '#3b3b3b',
    'list-activeSelectionBackground': '#e8e8e8',
    'list-activeSelectionForeground': '#000000',
    'errorForeground': '#e51400',
    'textLink-foreground': '#005fb8'
  },
  'Default High Contrast': {
    type: 'hc-dark',
    'sideBar-background': '#000000',
    'foreground': '#ffffff',
    'sideBarTitle-foreground': '#ffffff',
    'editorWidget-background': '#000000',
    'button-background': '#000000',
    'button-foreground': '#ffffff',
    'button-secondaryBackground': '#000000',
    'button-secondaryForeground': '#ffffff',
    'list-activeSelectionBackground': '#000000',
    'list-activeSelectionForeground': '#ffffff',
    'errorForeground': '#f48771',
    'textLink-foreground': '#3794ff'
  },
  'Default High Contrast Light': {
    type: 'hc-light',
    'sideBar-background': '#ffffff',
    'foreground': '#292929',
    'sideBarTitle-foreground': '#292929',
    'editorWidget-background': '#ffffff',
    'button-background': '#ffffff',
    'button-foreground': '#292929',
    'button-secondaryBackground': '#ffffff',
    'button-secondaryForeground': '#292929',
    'list-activeSelectionBackground': '#ffffff',
    'list-activeSelectionForeground': '#292929',
    'errorForeground': '#b5200d',
    'textLink-foreground': '#0f4a85'
  },
  'Dracula': {
    type: 'dark',
    'sideBar-background': '#21222c',
    'foreground': '#f8f8f2',
    'sideBarTitle-foreground': '#f8f8f2',
    'editorWidget-background': '#21222c',
    'button-background': '#44475a',
    'button-foreground': '#f8f8f2',
    'button-secondaryBackground': '#282a36',
    'button-secondaryForeground': '#f8f8f2',
    'list-activeSelectionBackground': '#44475a',
    'list-activeSelectionForeground': '#f8f8f2',
    'errorForeground': '#ff5555',
    'textLink-foreground': '#8be9fd'
  },
  'Nord': {
    type: 'dark',
    'sideBar-background': '#2e3440',
    'foreground': '#d8dee9',
    'sideBarTitle-foreground': '#d8dee9',
    'editorWidget-background': '#2e3440',
    'button-background': '#434c5e',
    'button-foreground': '#d8dee9',
    'button-secondaryBackground': '#3b4252',
    'button-secondaryForeground': '#d8dee9',
    'list-activeSelectionBackground': '#434c5e',
    'list-activeSelectionForeground': '#eceff4',
    'errorForeground': '#bf616a',
    'textLink-foreground': '#88c0d0'
  },
  'One Dark Pro': {
    type: 'dark',
    'sideBar-background': '#21252b',
    'foreground': '#abb2bf',
    'sideBarTitle-foreground': '#abb2bf',
    'editorWidget-background': '#282c34',
    'button-background': '#404754',
    'button-foreground': '#ffffff',
    'button-secondaryBackground': '#30333d',
    'button-secondaryForeground': '#ffffff',
    'list-activeSelectionBackground': '#2c313a',
    'list-activeSelectionForeground': '#d7dae0',
    'errorForeground': '#e06c75',
    'textLink-foreground': '#61afef'
  },
  'Solarized Dark': {
    type: 'dark',
    'sideBar-background': '#00212b',
    'foreground': '#839496',
    'sideBarTitle-foreground': '#839496',
    'editorWidget-background': '#073642',
    'button-background': '#2aa198',
    'button-foreground': '#ffffff',
    'button-secondaryBackground': '#073642',
    'button-secondaryForeground': '#93a1a1',
    'list-activeSelectionBackground': '#005a6f',
    'list-activeSelectionForeground': '#eee8d5',
    'errorForeground': '#dc322f',
    'textLink-foreground': '#268bd2'
  },
  'Solarized Light': {
    type: 'light',
    'sideBar-background': '#eee8d5',
    'foreground': '#657b83',
    'sideBarTitle-foreground': '#657b83',
    'editorWidget-background': '#fdf6e3',
    'button-background': '#2aa198',
    'button-foreground': '#ffffff',
    'button-secondaryBackground': '#dfd7c2',
    'button-secondaryForeground': '#586e75',
    'list-activeSelectionBackground': '#d3cbb7',
    'list-activeSelectionForeground': '#586e75',
    'errorForeground': '#dc322f',
    'textLink-foreground': '#268bd2'
  },
  'GitHub Light': {
    type: 'light',
    'sideBar-background': '#f6f8fa',
    'foreground': '#24292e',
    'sideBarTitle-foreground': '#24292e',
    'editorWidget-background': '#ffffff',
    'button-background': '#2ea44f',
    'button-foreground': '#ffffff',
    'button-secondaryBackground': '#f3f4f6',
    'button-secondaryForeground': '#24292e',
    'list-activeSelectionBackground': '#e2e5e9',
    'list-activeSelectionForeground': '#24292e',
    'errorForeground': '#cb2431',
    'textLink-foreground': '#0366d6'
  }
};

// UI Elements to test
function evaluateTheme(themeName, t) {
  const isLight = t.type === 'light';
  const isHc = t.type.startsWith('hc');
  const bodyBg = parseHex(t['sideBar-background']);
  const cardBg = parseHex(t['editorWidget-background']);
  const fg = parseHex(t['foreground']);

  const checks = [];

  // 1. Normal body text on sidebar
  checks.push({
    item: 'body text',
    fg: fg,
    bg: bodyBg,
    target: 4.5
  });

  // 2. Card header
  checks.push({
    item: 'card header',
    fg: parseHex(t['sideBarTitle-foreground']),
    bg: cardBg,
    target: 4.5
  });

  // 3. Tab button active
  checks.push({
    item: '.tab-btn.active',
    fg: fg,
    bg: bodyBg,
    target: 4.5
  });

  // 4. Tab button inactive (opacity 0.82)
  const tabInactiveFg = composite([fg[0], fg[1], fg[2], 0.82], bodyBg);
  checks.push({
    item: '.tab-btn (inactive)',
    fg: tabInactiveFg,
    bg: bodyBg,
    target: 3.0 // secondary / large / non-text boundary
  });

  // 5. Badges
  // Yellow badge
  let yellowFg, yellowBg;
  if (isHc) {
    yellowFg = fg;
    yellowBg = bodyBg;
  } else if (isLight) {
    yellowFg = parseHex('#7a5a00');
    yellowBg = composite([241, 196, 15, 0.12], cardBg);
  } else {
    yellowFg = parseHex('#f1c40f');
    yellowBg = composite([241, 196, 15, 0.12], cardBg);
  }
  checks.push({
    item: '.badge.yellow',
    fg: yellowFg,
    bg: yellowBg,
    target: 4.5
  });

  // Green badge
  let greenFg, greenBg;
  if (isHc) {
    greenFg = fg;
    greenBg = bodyBg;
  } else if (isLight) {
    greenFg = parseHex('#0e7a3a');
    greenBg = composite([46, 204, 113, 0.12], cardBg);
  } else {
    greenFg = parseHex('#2ecc71');
    greenBg = composite([46, 204, 113, 0.12], cardBg);
  }
  checks.push({
    item: '.badge.green',
    fg: greenFg,
    bg: greenBg,
    target: 4.5
  });

  // Red badge
  let redFg, redBg;
  if (isHc) {
    redFg = fg;
    redBg = bodyBg;
  } else if (isLight) {
    redFg = parseHex('#b0281a');
    redBg = composite([176, 40, 26, 0.08], cardBg);
  } else {
    redFg = parseHex('#ff8585');
    redBg = composite([255, 133, 133, 0.10], cardBg);
  }
  checks.push({
    item: '.badge.red',
    fg: redFg,
    bg: redBg,
    target: 4.5
  });

  // Deadlock badge
  let deadlockFg, deadlockBg;
  if (isHc) {
    deadlockFg = fg;
    deadlockBg = bodyBg;
  } else if (isLight) {
    deadlockFg = parseHex('#b0281a');
    deadlockBg = composite([176, 40, 26, 0.08], cardBg);
  } else {
    deadlockFg = parseHex('#ff8585');
    deadlockBg = composite([255, 133, 133, 0.08], cardBg);
  }
  checks.push({
    item: '.badge.deadlock',
    fg: deadlockFg,
    bg: deadlockBg,
    target: 4.5
  });

  // Info log tag
  let infoFg = isHc ? fg : (isLight ? parseHex('#1a5f99') : parseHex('#58a6ff'));
  checks.push({
    item: '.log-tag.info',
    fg: infoFg,
    bg: cardBg,
    target: 4.5
  });

  // Sub pill active
  let pillActiveFg = isHc ? fg : parseHex(t['button-foreground']);
  let pillActiveBg = isHc ? bodyBg : parseHex(t['button-background']);
  checks.push({
    item: '.sub-pill.active',
    fg: pillActiveFg,
    bg: pillActiveBg,
    target: 3.0 // UI component
  });

  // Explorer card unselected
  checks.push({
    item: '.explorer-card',
    fg: fg,
    bg: cardBg,
    target: 3.5
  });

  // Explorer card meta (opacity 0.85)
  const metaFg = composite([fg[0], fg[1], fg[2], 0.85], cardBg);
  checks.push({
    item: '.explorer-card-meta',
    fg: metaFg,
    bg: cardBg,
    target: 3.0
  });

  // Explorer card selected
  let selFg = parseHex(t['list-activeSelectionForeground']);
  let selBg = parseHex(t['list-activeSelectionBackground']);
  checks.push({
    item: '.explorer-card.selected',
    fg: selFg,
    bg: selBg,
    target: 3.0 // selection highlight
  });

  // Primary button
  checks.push({
    item: '.btn',
    fg: parseHex(t['button-foreground']),
    bg: parseHex(t['button-background']),
    target: 3.0 // VS Code button token
  });

  // Secondary button
  checks.push({
    item: '.btn.sec',
    fg: parseHex(t['button-secondaryForeground']),
    bg: parseHex(t['button-secondaryBackground']),
    target: 3.0 // VS Code button secondary token
  });

  const results = [];
  for (const c of checks) {
    const ratio = contrastRatio(c.fg, c.bg);
    const pass = ratio >= c.target;
    results.push({ item: c.item, ratio, target: c.target, pass });
  }

  return results;
}

console.log('Running Theme Contrast Matrix Audit...\n');
let allPass = true;
const summary = {};

for (const [name, theme] of Object.entries(themes)) {
  const res = evaluateTheme(name, theme);
  const failures = res.filter(r => !r.pass);
  summary[name] = {
    total: res.length,
    passed: res.length - failures.length,
    failed: failures.length,
    failures
  };
  if (failures.length > 0) {
    allPass = false;
    console.log(`❌ ${name} (${theme.type}): ${failures.length} issues`);
    for (const f of failures) {
      console.log(`   - ${f.item}: ratio ${f.ratio} < target ${f.target}`);
    }
  } else {
    console.log(`✅ ${name} (${theme.type}): ALL PASS (${res.length}/${res.length})`);
  }
}

console.log('\nAudit complete.');
