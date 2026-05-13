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

### Router Stats
- Top learned routing patterns: `*.ts → reviewer · 94% (12x)`
- Updated as you use `veto_record_outcome`

### Daily Tool Usage
- Tokens consumed today by Veto tool calls (council debate, parallel exec) per platform vs. daily budget
- Visual progress bar: `Claude  16K / 500K █░░░░ 3%`
- Not a context window meter — tracks Veto's own tool invocations only

### Health
- DB size, session count, memory count, pattern count, learning entries

---

## Requirements

| Requirement | Details |
|---|---|
| **VS Code** | 1.97 or higher (uses Node 22 built-in SQLite) |
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
code --install-extension veto-vscode-0.5.3.vsix
```

---

## Multi-AI support

If you run Claude in VS Code and Gemini CLI in another tool simultaneously on different projects, the Memory panel automatically shows only memories scoped to the currently open workspace — no cross-project contamination.

Each session tracks:
- **Created by** — which AI originally saved it
- **Active in** — which AI last resumed it

So if you hand off from Claude to Gemini mid-task via `veto_handoff`, the Session panel updates to show `Active in: gemini` on the next poll.

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
