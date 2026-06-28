# Veto HUD for VS Code

> A single, live heads-up display for the [Veto MCP server](https://github.com/jigyasudham/veto) — right in your sidebar and status bar.

Veto is a local MCP server that gives every AI (Claude, Gemini, Codex) a **council of specialist agents**, **persistent memory**, and a **self-learning router**. This extension surfaces what Veto knows — verdict, routing confidence, session, memory, rate — in one focused HUD. No terminal, no AI session required to read it.

---

## The HUD

One sidebar view (and one status-bar pulse) replaces the old seven panels. Everything updates instantly via a file watcher, with a polling fallback.

```
⬡ VETO        ● GREEN
Session   claude · 16K/200K ▓░░░ 8%   [Resume] [Save]
Council   GREEN · just now
          ✓ Lead ✓ PM ⚠ Arch ✓ UX ⚠ Devil ✓ Legal ✓ Sec
          → ship it
Router    *.ts → reviewer   94% · 12×
Today     claude  ▓▓▓▓▓░░░░░ 50%
Memory    15 entries · this project   [ search… ]
Health    0.7 MB · 10 sessions · 24 patterns
```

- **Session** — the session matching your open workspace; created-by / active-in AI, token gauge, click **Resume** to continue it in Claude/Gemini/Codex.
- **Council** — last verdict (GREEN/YELLOW/RED) with each agent's vote and the recommendation. Buttons run a fresh **Debate**, **Review file**, or **Review PR**.
- **Router** — the strongest learned routing patterns and their confidence — *why* Veto routes the way it does.
- **Today** — per-platform token-budget usage.
- **Memory** — workspace-scoped count + inline search.
- **Health** — DB size and counts.

## Status-bar pulse

Always-on, one glance: `$(check) Veto · GREEN · 50%` — verdict + today's peak token-budget use. Hover for session, router, rate, and DB detail. Click to focus the HUD. Shows `⟳` when serving last-good data because the DB is mid-write.

## Inline diagnostics

When you run `veto_code_review`, `veto_security_scan`, or `veto_secrets_scan` with a `file_path`, findings are stored in the Veto DB and shown as squiggles in the editor — cleared automatically on the next passing scan.

---

## Architecture (v1.0)

A clean, layered rewrite — no god-function, one DB connection, no shell strings.

```
src/
├── extension.ts     wiring only
├── core/            VetoStore (single long-lived read-only connection + change-detection
│                    + typed snapshot emitter), snapshot types, path/budget helpers
├── data/            pure SQL queries against the open handle
├── ui/              StatusBar pulse + HudView (nonce-CSP webview, DB strings never run as HTML)
└── commands/        actions via spawn(argv) — no shell, no string interpolation
```

- **One read-only connection** for the whole extension (no per-query open/close churn).
- **Resilient:** when the DB is locked mid-WAL-write it serves the last-good snapshot instead of blanking; missing tables are feature-detected for forward-compat.
- **Safe by construction:** the webview renders DB values with `textContent` only (no `innerHTML`); the one interactive `claude` call validates its inputs against an allowlist and all one-shot tools run via `spawn(argv)` with `shell:false`.
- **Tested:** `npm test` runs a smoke suite over the data path against a fixture DB.

---

## Requirements

| Requirement | Details |
|---|---|
| **VS Code** | 1.97 or higher |
| **Node.js** | 22 or higher (uses built-in `node:sqlite`) |
| **Veto MCP server** | `npm i -g @jigyasudham/veto` — installed and used at least once |

The extension reads `~/.veto/veto.db` directly (read-only) — no server process needed to browse the HUD.

### Settings

| Setting | Default | Description |
|---|---|---|
| `veto.pollInterval` | `5000` | Fallback poll interval (ms); the HUD also updates instantly via a file watcher. |
| `veto.dbPath` | `""` | Override the Veto DB path. Empty = `~/.veto/veto.db`. |

---

## Install

**Marketplace:** search **Veto MCP Dashboard** in the Extensions panel.

**From source:**
```bash
git clone https://github.com/jigyasudham/veto-vscode
cd veto-vscode
npm install
npm run build        # bundle
npm test             # smoke tests
npm run package      # produce the .vsix
code --install-extension veto-vscode-1.0.0.vsix
```

Press **F5** to launch the Extension Development Host with the extension live.

---

## Want the same stats in your terminal?

The "stats below the CLI" statusline lives in the **Veto CLI itself** (so every Veto user gets it, not just VS Code users):

```bash
veto statusline install
```

renders a compact `⬡ veto GREEN · router 94% · claude 50% · mem 15` line beneath your Claude Code prompt. See the [Veto server](https://github.com/jigyasudham/veto).

---

## Changelog

### v1.0.0 — "Veto HUD"
- **Rewrite:** seven tree panels → one live HUD (sidebar webview) + a status-bar pulse.
- **Architecture:** layered `core` / `data` / `ui` / `commands`; a single long-lived read-only SQLite connection with change-detection and last-good fallback replaces 8 connections per poll.
- **Security:** removed all `claude` CLI shell-string building (CWE-78); one-shot tools now run via `spawn(argv)` with `shell:false`; webview uses nonce CSP + `textContent`.
- **Focus:** surfaces council verdict, agent votes, and router confidence prominently; dropped the off-by-default auto-triggers (the same actions remain on-demand).
- **Tests:** added a smoke suite over the data path.
- **Moved out:** the terminal statusline now ships with the Veto CLI (`veto statusline install`).

<details><summary>Earlier (0.x)</summary>

- **0.7.0** — inline diagnostics; session browser
- **0.6.0** — status bar token %, auto-triggers, PR review, learning stats, sessions panel
- **0.5.x** — workspace-scoped sessions; SVG icon; panel renames
</details>

---

## License

MIT © 2026 Jigyasu Dham
