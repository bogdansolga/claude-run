# Settings: subscription and context accounting

## Future feature

Extend the minimal Settings pane into the explicit configuration boundary for multiple Claude Code accounts/profiles.

Each profile should bind:

- a display name;
- a Claude data root, initially `~/.claude` or `~/.claude-nix`;
- a subscription tier: `pro`, `max-5x`, or `max-20x`;
- optional user-supplied quota/accounting metadata when a reliable source is available.

## Accounting rules

Keep API-equivalent usage separate from subscription usage. Claude Code `cost-state` and token-derived prices are API-equivalent values, not subscription bills. Do not infer a tier from local login state and do not convert API-equivalent dollars by dividing by 5 or 20. Those are usage multipliers, not dollar discounts.

Subscription-adjusted cost remains unavailable until a documented and verifiable quota/accounting rule is configured. The UI should say why rather than display `$0` or a fabricated discount.

## Context measurement

Use the live status-line JSON emitted to `~/.claude/scripts/status-line.sh` as the model for active context telemetry. In particular:

- `context_window.used_percentage` is the preferred live context signal;
- the active model and session/profile identity should be retained with the reading;
- historical JSONL token usage can provide a labeled fallback estimate, but cannot reproduce the exact status-line percentage.

Future session launches should capture this telemetry and persist the latest context percentage/window for display in the session view and Settings diagnostics.

## Initial implementation sequence

1. Add profile configuration types and persistence without changing existing dual-root discovery.
2. Add Settings controls for root and tier selection, clearly marking tier as user-provided metadata.
3. Add a status-line telemetry ingestion path for claude-run-launched sessions.
4. Show API-equivalent cost, context usage, and subscription metadata as separate fields.
5. Add subscription quota arithmetic only when its source and formula are documented.
