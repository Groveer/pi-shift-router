# Troubleshooting

## Judge unparseable warning

- **The reasoning model ran out of tokens** — DeepSeek Reasoner emits `reasoning_content` first, then JSON in `content`. The router sets `max_tokens: 4000`; very long prompts may overflow. Run `/router verbose` to inspect the raw response.
- **The provider doesn't support JSON mode** — some custom OpenAI-compatible endpoints ignore `response_format`.
- **Invalid API key** — check pi-agent's `auth.json`.

## "Judge fetch failed for … : TypeError: Cannot read 'slice' of undefined"

Fixed in v0.8.0 (commit `de6073a`+). Root cause: `JSON.stringify(undefined)` returns `undefined`, not the string `"undefined"`. When the Judge endpoint returned 200 with an error-shaped body (no `choices[]`), the verbose log crashed on `content.slice(...)`. Now wrapped in a `jsonStr()` helper that returns `"undefined"` for undefined input.

If you still see this on an older install, reinstall: `pi remove pi-shift-router && pi install <path-to-this-repo>` (e.g. `pi install .` from the repo root).

## "No models match" in the wizard

Models come from pi-agent's `models-store.json`. Restart pi-agent after adding a new provider so it re-discovers the list.

## Status bar shows `⛔`

The router is disabled — run `/router on`. If `enabled: true` in the config but the badge still shows `⛔`, check the `Config:` line in `/router status` to confirm which config path is being read.

## "Model not found" warning

The model ID doesn't exist in the provider. Update the ID or re-pick via `/router config` (the wizard only lists real models).

## Router keeps downgrading to Fast

Either the Judge is misclassifying (inspect with `/router verbose`) or the threshold is too aggressive. Raise it:

```json
"routing": { "window": { "size": 5, "threshold": 0.8, "minConfidence": 0.5 } }
```
