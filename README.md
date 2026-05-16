# Veto for VS Code

> Live dashboard for the [Veto MCP server](https://github.com/jigyasudham/veto) — right inside your sidebar.

Veto is a local MCP server that gives every AI (Claude, Gemini, Codex) a council of specialist agents, persistent memory, and a self-learning router. This extension surfaces what Veto knows directly in VS Code — no terminal, no AI session required.

---

## What it shows

The sidebar has 7 panels, all updated every 5 seconds (or instantly via DB watcher) from `~/.veto/veto.db`.

### Session
- Session ID, which AI created it (`Created by`), and which AI is currently using it (`Active in`)
- Start time (relative), connection type, project directory, summary
- **Workspace-scoped** — each VS Code window shows the session matching its open folder
- Tokens (last save): `16K/200K █░░░░ 8%` — reflects token count at the last `veto_session_save` call, not a live counter
- **Save Session** button (toolbar) — prompts for a summary and saves via `veto_session_save`

### Sessions
- Last 10 sessions listed with summary and relative time
- Click any session to resume it — dispatches to Claude, Gemini, or Codex depending on which AI last used it

### Memory
- Total memory count — automatically scoped to your current workspace folder
- Last 3 stored entries with their type tag
- **Search Memory** button (toolbar) — fuzzy search by keyword or tag, copy result to clipboard

### Last Council
- Verdict badge: `GREEN` / `YELLOW` / `RED` with colour icons
- Each agent's vote (Lead Dev, PM, Architect, UX, Devil, Legal, Security)
- Recommendation and time of last debate
- **Council Debate** button (toolbar) — opens an input box, then runs `veto_council_debate` via Claude CLI
- **Review File** button (toolbar) — runs `veto_code_review` on the currently open file
- **PR Review** button (toolbar) — runs `veto_pr_review` on the current git branch

### Router Stats
- Top learned routing patterns: `*.ts → reviewer · 94% (12x)`
- Updated as you use `veto_record_outcome`

### Health
- DB size, session count, memory count, pattern count, learning entries

### Learning Stats
- Total outcomes recorded, average quality per tier
- Top agents by performance score
- Updated automatically — no manual recording needed (auto-hooks fire after every council/scan/workflow)

---

## Inline Diagnostics (v0.7.0)

When you call `veto_code_review`, `veto_security_scan`, or `veto_secrets_scan` with a `file_path` parameter, findings are stored in the Veto DB and surfaced as VS Code squiggles (inline diagnostics) directly in the editor — no separate panel needed.

- Red squiggles for critical/high findings
- Yellow squiggles for medium findings
- Clears automatically when the next passing scan runs on the same file

---

## Auto-Triggers

Four optional auto-triggers run silently in the background (all off by default, enable in Settings):

| Setting | Trigger | What runs |
|---|---|---|
| `veto.autoRefreshOnSave` | Any file save | Dashboard refresh |
| `veto.autoReview` | File save | `veto_code_review` via Claude CLI |
| `veto.autoCiGate` | Git stage (`.git/index` change) | `veto_ci_gate` via Claude CLI |
| `veto.autoSecretsOnStage` | Git stage | `veto_secrets_scan` via Claude CLI |

---

## Status Bar

The bottom status bar shows the active session platform + council verdict:

- `$(check) Veto · GREEN · 8%` — last council passed, 8% of today's token budget used
- `$(warning) Veto · YELLOW · 42%` — council warned
- `$(error) Veto · RED · 91%` — council blocked

Click the status bar item to focus the Veto sidebar.

---

## Requirements

| Requirement | Details |
|---|---|
| **VS Code** | 1.97 or higher |
| **Node.js** | 22 or higher (uses built-in `node:sqlite`) |
| **Veto MCP server** | `npm i -g @jigyasudham/veto` — must be installed and used at least once |

The extension reads `~/.veto/veto.db` directly — no server process needed while browsing the dashboard.

---

## Installation

### From the Marketplace
Search **Veto MCP Dashboard** in the VS Code Extensions panel and click Install.

### From source
```bash
git clone https://github.com/jigyasudham/veto-vscode
cd veto-vscode
npm install
npm run package       # produces veto-vscode-x.x.x.vsix
code --install-extension veto-vscode-0.7.0.vsix
```

---

## Multi-AI support

If you run Claude in VS Code and Gemini CLI in another tool simultaneously on different projects, the Memory panel automatically shows only memories scoped to the currently open workspace — no cross-project contamination.

Each session tracks:
- **Created by** — which AI originally saved it
- **Active in** — which AI last resumed it

So if you hand off from Claude to Gemini mid-task via `veto_handoff`, the Session panel updates to show `Active in: gemini` on the next poll.

---

## Changelog

### v0.7.0
- **feat:** Inline diagnostics — `veto_code_review`, `veto_security_scan`, `veto_secrets_scan` with `file_path` store findings to DB; extension shows squiggles in the editor, clears on passing scan
- **fix:** CI bumped to Node 22 (required for `node:sqlite`); `package-lock.json` regenerated

### v0.6.0
- **feat:** Status bar — platform + council verdict + token % at a glance
- **feat:** Auto-triggers: file save → `veto_code_review`, git stage → `veto_ci_gate` + `veto_secrets_scan`
- **feat:** PR Review command — detects current branch, runs `veto_pr_review`
- **feat:** Learning Stats panel — surfaces what Veto has learned about your codebase
- **feat:** Sessions panel — last 10 sessions with click-to-restore

### v0.5.6
- **fix:** Cast `candidates.all()` through `unknown` to satisfy stricter `@types/node` (CI fix)

### v0.5.5
- **fix:** Window-scoped session — no fallback to global when workspace has no session

### v0.5.4
- **fix:** Window-scoped session matching; remove misleading Rate panel

### v0.5.3
- **feat:** Workspace-scoped sessions — each VS Code window tracks its own project session
- **feat:** SVG activity bar icon; renamed panels for clarity

---

## Development

```bash
git clone https://github.com/jigyasudham/veto-vscode
cd veto-vscode
npm install
```

Press **F5** in VS Code to launch the Extension Development Host with the extension live.

```bash
npm run watch    # rebuild on file change
npm run build    # one-shot build
```

---

## Related

- [Veto MCP server](https://www.npmjs.com/package/@jigyasudham/veto) — the server this extension reads from
- [Veto GitHub](https://github.com/jigyasudham/veto)

---

## License

MIT © 2026 Jigyasu Dham
