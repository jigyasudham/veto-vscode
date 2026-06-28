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
      this.item.tooltip = 'Veto not installed — click to set up';
      this.item.command = 'veto.openHud';
      return;
    }

    const pct = maxRatePct(snap);
    const metric = pct !== null ? ` · ${pct}%` : '';
    const staleMark = snap.stale ? ' $(sync~spin)' : '';

    const v = snap.council?.verdict?.toUpperCase();
    let icon = '$(circle-outline)';
    let label = snap.session?.platform ?? 'veto';
    if (v === 'GREEN')  { icon = '$(check)';   label = 'GREEN'; }
    else if (v === 'RED')    { icon = '$(error)';   label = 'RED'; }
    else if (v === 'YELLOW') { icon = '$(warning)'; label = 'YELLOW'; }

    this.item.text = `${icon} Veto · ${label}${metric}${staleMark}`;
    this.item.tooltip = this.buildTooltip(snap);
  }

  private buildTooltip(snap: VetoSnapshot): vscode.MarkdownString {
    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown(`**Veto v${this.version}**\n\n`);

    if (snap.session) {
      const s = snap.session;
      md.appendMarkdown(`**Session:** \`${s.id.slice(0, 8)}…\` · ${s.active_client ?? s.platform}\n\n`);
      if (s.summary) md.appendMarkdown(`_${s.summary.slice(0, 80)}_\n\n`);
    } else {
      md.appendMarkdown(`_No active session for this workspace_\n\n`);
    }

    if (snap.council) {
      md.appendMarkdown(`**Council:** ${snap.council.verdict} · ${relativeTime(snap.council.debated_at)}\n\n`);
    }

    const top = topPattern(snap);
    if (top) {
      md.appendMarkdown(`**Router:** ${top.pattern_key} → ${top.pattern_val} · ${Math.round(top.confidence * 100)}% (${top.seen_count}×)\n\n`);
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

    if (snap.stale) md.appendMarkdown(`\n_⟳ showing last-good data — Veto DB busy_`);
    md.appendMarkdown(`\n\nClick to open the Veto HUD.`);
    return md;
  }

  dispose(): void {
    this.item.dispose();
  }
}
