# Veto for VS Code

> Live dashboard for the [Veto MCP server](https://github.com/jigyasudham/veto) — right inside your sidebar.

Veto is a local MCP server that gives every AI (Claude, Gemini, Codex) a council of specialist agents, persistent memory, and a self-learning router. This extension surfaces what Veto knows directly in VS Code — no terminal, no AI session required.

---

## What it shows

The sidebar has 4 panels, all updated every 5 seconds from `~/.veto/veto.db`.

### Session
- Session ID, which AI created it (`Created by`), and which AI is currently using it (`Active in`)
- Start time (relative), token count, summary

### Memory
- Total memory count — automatically scoped to your current workspace folder
- Last 3 stored entries with their type tag

### Last Council
- Verdict badge: `GREEN` / `YELLOW` / `RED` with colour icons
- Each agent's vote (Lead Dev, PM, Architect, UX, Devil, Legal, Security)
- Recommendation and time of last debate

### Router Stats
- Top learned routing patterns: `*.ts → reviewer · 94% (12x)`
- Updated as you use `veto_record_outcome`

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
Search **Veto** in the VS Code Extensions panel and click Install.

### From source
```bash
git clone https://github.com/jigyasudham/veto-vscode
cd veto-vscode
npm install
npm run package       # produces veto-vscode-x.x.x.vsix
code --install-extension veto-vscode-0.1.0.vsix
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
