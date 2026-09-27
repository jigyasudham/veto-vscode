// The always-on Veto "pulse" in the VS Code status bar.
// UX budget (per council): icon + verdict + ONE metric. Everything else in the tooltip.

import * as vscode from 'vscode';
import { maxRatePct, topPattern, type VetoSnapshot } from '../core/snapshot';
import { relativeTime } from './format';

export class StatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor(private readonly version: string) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'veto.openHud';
    this.item.show();
  }

  render(snap: VetoSnapshot): void {
    if (!snap.installed) {
      this.item.text = '$(circle-slash) Veto';
      this.item.tooltip = snap.compatibilityWarning ?? 'Veto database unavailable — click for setup details';
      this.item.command = 'veto.openHud';
      return;
    }

    const pct = maxRatePct(snap);
    const metric = pct !== null ? ` · ${pct}%` : '';
    const staleMark = snap.stale ? ' $(sync~spin)' : '';

    const v = snap.council?.verdict?.toUpperCase();
    let icon = '$(circle-outline)';
    let label = snap.session?.platform ?? 'veto';
    if (v === 'GREEN')       { icon = '$(check)';   label = 'GREEN'; }
    else if (v === 'DEADLOCK'){ icon = '$(stop)';    label = 'DEADLOCK'; }
    else if (v === 'RED')    { icon = '$(error)';   label = 'RED'; }
    else if (v === 'YELLOW') { icon = '$(warning)'; label = 'YELLOW'; }

    this.item.text = `${icon} Veto · ${label}${metric}${staleMark}`;
    this.item.tooltip = this.buildTooltip(snap);
  }

  private buildTooltip(snap: VetoSnapshot): vscode.MarkdownString {
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = false;
    md.appendMarkdown(`**Veto v${this.version}**\n\n`);

    if (snap.session) {
      const s = snap.session;
      const client = s.active_client ?? s.platform ?? 'unknown';
      md.appendMarkdown(`**Saved session:** \`${s.id.slice(0, 8)}…\` · `);
      md.appendText(client);
      md.appendMarkdown('\n\n');
      if (s.summary) {
        md.appendMarkdown('_');
        md.appendText(s.summary.slice(0, 80));
        md.appendMarkdown('_\n\n');
      }
    } else {
      md.appendMarkdown(`_No saved session for this workspace_\n\n`);
    }

    if (snap.council) {
      md.appendMarkdown(`**Council:** `);
      md.appendText(snap.council.verdict ?? 'unknown');
      md.appendMarkdown(` · ${relativeTime(snap.council.debated_at)}\n\n`);
      if (snap.council.task) {
        md.appendMarkdown('_');
        md.appendText(snap.council.task.slice(0, 80));
        md.appendMarkdown('_\n\n');
      }
    }

    const top = topPattern(snap);
    if (top) {
      md.appendMarkdown(`**Router:** `);
      md.appendText(`${top.pattern_key} → ${top.pattern_val}`);
      md.appendMarkdown(` · ${Math.round(top.confidence * 100)}% (${top.seen_count}×)\n\n`);
    }

    if (snap.rate.length) {
      const parts = snap.rate
        .filter(r => r.token_count > 0)
        .map(r => `${r.platform} ${Math.round((r.token_count / Math.max(1, r.daily_token_budget)) * 100)}%`);
      if (parts.length) md.appendMarkdown(`**Today:** ${parts.join(' · ')}\n\n`);
    }

    if (snap.health) {
      md.appendMarkdown(`**DB:** ${snap.health.dbSizeMb}MB · ${snap.health.memoryCount} memories · ${snap.health.patternCount} patterns\n\n`);
    }

    if (snap.stale) {
      md.appendMarkdown(`\n_⟳ showing last-good data`);
      if (snap.staleReason) {
        md.appendMarkdown(` — `);
        md.appendText(snap.staleReason);
      }
      md.appendMarkdown(`_`);
    }
    md.appendMarkdown(`\n\nClick to open the Veto HUD.`);
    return md;
  }

  dispose(): void {
    this.item.dispose();
  }
}
