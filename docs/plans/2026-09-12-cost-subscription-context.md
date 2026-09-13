# Cost, subscription, and context accounting

## Findings

- `~/.claude/scripts/status-line.sh` receives live Claude Code status JSON on stdin. Its `context_window.used_percentage` value is the best source for the currently active process, but it is not persisted in the JSONL session records.
- Historical JSONL records contain token usage (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, and cache-creation fields), which can support a context estimate but cannot reproduce the status-line percentage exactly for old turns.
- Claude Code `cost-state` records provide API-equivalent `totalCostUSD`, but that is not the amount paid under Pro or Max subscriptions.
- Public subscription plan descriptions identify Pro, Max 5x, and Max 20x usage tiers, but do not publish a deterministic conversion from tokens/API-equivalent dollars to subscription consumption or remaining quota.
- Therefore the application must not invent a subscription discount or claim that API-equivalent dollars are the user's bill.

## Proposed integration

1. Add an explicit per-profile account configuration for subscription tier (`pro`, `max-5x`, `max-20x`) rather than inferring it from local files or login state.
2. Capture live status-line JSON from sessions launched by claude-run and persist the latest `context_window` values with the session/profile identity.
3. Use historical token usage as a clearly labeled fallback estimate when live status data is unavailable.
4. Display both values:
   - API-equivalent usage: derived from provider rates or Claude Code `cost-state`.
   - Subscription usage: only once Anthropic publishes or the user supplies a quota/accounting rule.
5. Keep subscription-adjusted cost nullable until a verified rule exists. Never divide API cost by 5 or 20; those labels are usage multipliers, not billing discounts.

## Configuration boundary

A future profile configuration should bind the Claude data root and subscription tier together, for example:

```json
{
  "profiles": [
    { "name": "default", "claudeDir": "~/.claude", "subscription": "max-20x" },
    { "name": "nix", "claudeDir": "~/.claude-nix", "subscription": "pro" }
  ]
}
```

The current dual-root scan remains useful for discovery, but it is not sufficient to identify the subscription account. Explicit configuration is required before showing discounted subscription cost.
