# Plan A — veto-vscode v1.0 "Veto HUD" (extension rewrite)

**Repo:** `D:\veto-vscode`  ·  **Owner:** this session  ·  **Council verdict:** GREEN
**Scope:** extension only. Statusline lives in the Veto CLI (see Plan B). No server changes here.

## Goal
Replace the 7-panel sidebar + god-function `activate()` + `claude`-CLI shell strings with:
- one **live status-bar pulse**,
- one **Webview HUD**,
- a clean, layered architecture,
- safe `spawn(argv)` actions (no shell).
Fixes the `veto_code_review` 58/100 findings (CWE-78 shell injection, connection churn, duplication).

## Target structure
```
src/
├── extension.ts          ~40 lines: wire deps + register disposables only
├── core/
│   ├── VetoStore.ts      ONE long-lived read-only node:sqlite conn; fs.watch + rowid/mtime
│   │                     change-detection; emits typed VetoSnapshot; SQLITE_BUSY → last-good
│   ├── snapshot.ts       VetoSnapshot type (see Data Contract in Plan B)
│   └── paths.ts          db-path resolve + Windows path normalization (port verbatim)
├── ui/
│   ├── StatusBar.ts      pulse: ⬡ Veto · GREEN · router 94% · 42%  (+ rich tooltip)
│   ├── HudPanel.ts       Webview controller (lifecycle, message bus, snapshot push)
│   └── webview/          index.html + hud.js + hud.css  (nonce-CSP, escaped DB strings)
├── commands/
│   ├── index.ts          registers all commands
│   └── veto.ts           actions via spawn(argv), NO shell:true
└── data/
    └── queries.ts        SQL reused from old db/reader.ts (behavior preserved)
```

## Build order
1. **core/** — `snapshot.ts` (types) → `paths.ts` → `data/queries.ts` (lift SQL from `src/db/reader.ts`) → `VetoStore.ts` (single connection, change-detection, snapshot emitter, BUSY/last-good guard, table feature-detection).
2. **ui/StatusBar.ts** — subscribe to VetoStore; strict width budget (icon + verdict + ONE metric), everything else in tooltip; click → focus HUD.
3. **ui/HudPanel.ts + webview/** — render snapshot: verdict + 7 agent votes, router patterns w/ confidence, rate bars, session (click-to-resume), memory search box. Nonce CSP, HTML-escape every DB value.
4. **commands/** — port actions (resume, council, review file/PR, scan secrets, search memory) to `spawn('claude', [argv...])` with NO shell; keep inline diagnostics.
5. **extension.ts** — wire VetoStore → StatusBar + HudPanel + commands; register disposables. Nothing else.
6. **package.json** — replace 7 `views` with 1 webview view + status bar; trim/rename commands; keep config keys still used.
7. **esbuild.js** — copy `src/ui/webview/*` into `dist/` (or inline) so assets ship.
8. **Safety net** — add minimal `npm test` (vitest or node:test): VetoStore opens a fixture DB → returns a valid snapshot; commands build correct argv arrays (no shell metachars).
9. **Docs/version** — rewrite README around the HUD; bump to `1.0.0`.

## Council mitigations (mandatory — Webview + full-rewrite are the riskier picks)
- **XSS:** nonce-based CSP, no inline JS, HTML-escape every DB-sourced string in the Webview.
- **DB resilience:** open read-only; `SQLITE_BUSY`/WAL mid-write → return last-good snapshot, never throw.
- **Schema drift:** feature-detect tables (like the existing `scan_diagnostics` guard) → degrade gracefully.
- **No regressions:** keep click-to-resume Sessions, Memory search, inline diagnostics from v0.7.0.

## Done when
- `npm run build` clean; HUD + status bar render live from `~/.veto/veto.db`.
- Zero `shell:true` / string-interpolated CLI calls remain.
- Smoke test passes; README reflects v1.0.
- Statusline is intentionally ABSENT (owned by Plan B).
```
```
