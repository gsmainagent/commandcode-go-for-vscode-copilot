# Command Code Go for VS Code

Use the models included with the [Command Code Go plan](https://commandcode.ai/docs/plans/go) directly in GitHub Copilot Chat.

Originally maintained by [Ho Trung Nhan](https://github.com/hotrungnhan), whose fork this is. The current source and issue tracker are hosted at [gsmainagent/commandcode-go-for-vscode-copilot](https://github.com/gsmainagent/commandcode-go-for-vscode-copilot).

The model list is discovered at runtime rather than hardcoded. A model your account cannot call is listed anyway and fails when you select it, rather than being hidden — see [No entitlement probing](#no-entitlement-probing).

Requests go through a vendored copy of [`commandcode-proxy`](https://github.com/MAXeaglet/commandcode-proxy), which presents them as ordinary Command Code CLI traffic. It handles the request envelope, the device fingerprint and the startup lifecycle handshake, and it is maintained upstream so protocol changes are tracked there rather than here. This extension contributes the VS Code side: the model list, the picker, token budgets and the OpenAI-shaped client.

## What it provides

- Every model your account can actually call, in Copilot Chat's model picker
- New models appear as soon as Command Code lists them — no extension update
- Models from other plans (Pro/Max) and geo-restricted regions are filtered out
- Live context-window values from the catalog, not compiled-in estimates
- Vision and reasoning flags taken from the vendor's own plan documentation
- Copilot agent mode, tools, MCP servers, instructions, and skills
- Streaming text and reasoning responses
- API-token storage through VS Code SecretStorage

## How the model list is built

**`https://commandcode.ai/docs/plans/go` decides which models exist.** It is the
supported surface for Go subscribers: it states exactly what the plan includes,
and each model's display name, capabilities, per-million-token prices, an
intelligence score and context window. It is scraped HTML, and it broke three
ways during development — an off-peak tooltip leaked into the model name, the
`Caps` label collided with the `input:` price label, and most rows label their
price column only `N context price bands`, so columns have to be resolved from
the table header. It is therefore treated as recoverable, not authoritative.

**Ids come from Go-supported sources.** The plan page links models by slug
(`kimi-k3`) while requests need `moonshotai/Kimi-K3`, and the vendor
prefix cannot be derived from a slug — a bare slug is refused with
`403 Model/provider not recognized`. Ids are resolved in this order:

1. the compiled registry in `src/models.ts` — offline, always available
2. the mapping cached from earlier runs
3. `https://commandcode.ai/docs/reference/cli/models`, which lists ids the way
   the CLI addresses them
4. `GET /provider/v1/models` — **last resort, and unsupported on Go**

Step 4 deserves explanation. An earlier build made `/provider/v1` the
foundation. That was wrong: `docs/provider` states *"Every plan except the Go
plan has API access"*, and its request endpoints answer
`403 Your Go plan doesn't include API access`. Only the model-list GET is
ungated, so depending on it is a bet that an excluded endpoint stays open. It is
still consulted last, because it resolves the one slug the supported sources
miss, and every failure mode is silent.

A slug nothing resolves to keeps its bare slug and **still appears in the
picker**. Selecting it fails, but hiding a model the plan says you have is the
worse error.

| Situation | Result |
| --- | --- |
| all sources up | 53 models, 53 with capabilities and prices, 1 bare slug |
| CLI reference down | 53 models, 52 from the registry, 1 bare slug |
| every id source down | 53 models, 52 bare slugs |
| plan page down, snapshot exists | 53 models, previous metadata replayed |
| plan page down, nothing cached | the curated registry |

A source outage never empties the picker, and never silently strips vision
support from models that have it.

Capabilities resolve strongest-evidence-first: the plan page's live
declaration, then the compiled table in `src/capabilities.ts` (generated from
that same page), then conservative defaults. This matters because Copilot Chat
sends images whenever `imageInput` is true — marking a text-only model as
vision-capable hands it image bytes it cannot read.

### Token budgets

The number reported to Copilot and the number sent as `max_tokens` both come
from `src/token-budget.ts`, so they cannot drift.

The output budget is capped at **the model's own ceiling**, which is usually
lower than the endpoint's. The endpoint accepts `max_tokens` up to 200000, but
each model declares its own maximum and refuses anything above it:

```
Range of max_tokens should be [1, 131072]
```

Those are measured, not assumed: `src/output-ceiling.ts` records the ceiling each
model was observed to accept. An earlier build sent 200000 to everything, which
was correct for the four models it had been tested against and wrong for the
rest — the refusal is a deterministic `400`, so it returned the same error five
times over about fifteen seconds.

Because the catalog gains models between refreshes and their ceilings are not
published anywhere, an **unmeasured model is sent the lowest confirmed ceiling**
(131072) rather than the highest. Every model measured accepts it, so a new entry
works immediately; one that turns out to want less fails visibly instead of
costing a retry storm. A ceiling is raised only after a request at that value
succeeds, keyed by exact model id — the Qwen family is not uniform here, with
`Qwen3.8-27B` accepting 200000 while `Qwen3.8-Max` stops at 131072.

A model's context window is *not* a usable output budget, because the window
covers input and output together: Kimi K3 reports 1M, and sending
`max_tokens: 1000000` for it is refused outright. The window is split, so large
models get their own ceiling for output and the remainder for input; smaller ones
take a quarter of their window so input keeps the majority.

### No entitlement probing

The picker lists every model the Go plan includes. If your account cannot
actually call one, the request fails when you select it — that is the intended
tradeoff. Probing each model first would cost one request per model on every
cold start, and when the probe endpoint was misconfigured it silently marked the
entire catalog callable, which is worse than listing a model that turns out to
be unavailable.

### Refresh

The merged list is stored in extension global state with a timestamp and
refetched once it is older than `commandcode-copilot.catalogRefreshMinutes`
(default 30). Queries inside that window are served from storage and make no
requests at all. Run **Command Code Go: Refresh Models** to re-sync on demand.

A cold start is two requests: the plan page and the CLI reference page. A third
is made only when some slug is still unresolved and the unsupported catalog can
settle it. A warm start is zero requests.

> Two earlier mistakes are worth recording, because both silently produced wrong
> capabilities. First, an older build inferred vision support by probing models
> with a solid-red PNG and got 10 models wrong, every Kimi among them: the probes
> went through an OpenAI-compatible proxy that does not forward image parts, so
> every model looked text-only. Second, the compiled registry's hand-written
> annotations had drifted from the vendor's on 20 of 51 models. Both are now
> replaced by the plan page's own declaration.

## Setup

### 1. Install Command Code and sign in

Install the CLI globally:

```bash
bun add --global command-code@latest
```

Start the browser-based login flow:

```bash
command-code login
```

Complete the authorization flow and retrieve the API token created for your Command Code account. If the CLI does not print it, copy it from `~/.commandcode/auth.json` or from Command Code Studio's API Keys page. Keep the token private.

### 2. Add the token to VS Code

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. Run **Command Code Go: Set API Key**.
3. Paste the token and confirm.

The extension stores it in VS Code SecretStorage and does not write it to the repository.

### 3. Choose a model

Open Copilot Chat, choose a Command Code model, and start chatting.

The first picker query reads the plan page and the CLI reference page — two or
three requests, about two seconds. The result is cached, so later picker queries
are instant and work offline. Run **Command Code Go: Refresh Models** to re-sync
on demand.

## Requirements

- VS Code 1.116 or newer
- GitHub Copilot Chat
- An active [Command Code Go plan](https://commandcode.ai/docs/plans/go)
- Bun (only needed to install and authenticate the Command Code CLI)

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `commandcode-copilot.planBaseUrl` | `https://commandcode.ai/docs/plans` | Base URL of the plan docs pages. The plan slug itself is fixed to `go`. |
| `commandcode-copilot.cliReferenceBaseUrl` | `https://commandcode.ai/docs/reference/cli` | CLI reference pages, read for canonical model ids. |
| `commandcode-copilot.catalogBaseUrl` | `https://api.commandcode.ai/provider/v1` | Last-resort id source. Unsupported on the Go plan; only its model-list endpoint is reachable. |
| `commandcode-copilot.generateBaseUrl` | `https://api.commandcode.ai/alpha` | Endpoint serving chat requests. |
| `commandcode-copilot.catalogRefreshMinutes` | `30` | Minutes before the stored model list is refetched from the plan page. |
| `commandcode-copilot.modelSource` | `dynamic` | `dynamic` (build from the plan page) or `static` (only the compiled-in registry, no network). |
| `commandcode-copilot.modelBlacklist` | `[]` | Model ids to hide, applied after discovery. |
| `commandcode-copilot.maxContextTokens` | `0` | Override every model's reported input window; `0` uses the plan page figure. |
| `commandcode-copilot.maxTokens` | `0` | Output-token cap; `0` uses the discovered window. |
| `commandcode-copilot.zdr` | `false` | Request zero-data-retention routing when available. |
| `commandcode-copilot.apiKey` | unset | Optional fallback token source; SecretStorage takes precedence. |
| `commandcode-copilot.debugMode` | `minimal` | Control diagnostic logging in the Command Code output channel. |

Requests carry the protocol headers Command Code expects, supplied by the vendored proxy.

The request envelope is built by the proxy rather than collected from your workspace. Two reasons, both requirements rather than tradeoffs: the upstream CLI always sends a working directory, while VS Code can run with no folder open at all; and a real local path, branch name and commit subjects are precisely the identifying detail that the request fingerprint exists to keep out. The same synthetic profile serves both purposes, so the git context an earlier build collected — branch, main branch, status, recent commits — is no longer sent upstream.

## Problems or missing models

Check **Command Code Go: Show Logs** first — it reports where the model list came
from (plan page or cache), how many models it holds, and whether it is serving a
stale snapshot because the page could not be reached. `commandcode-copilot.debugMode: "verbose"`
adds the parse and mapping details.

If the list is wrong after that, please [create an issue](https://github.com/gsmainagent/commandcode-go-for-vscode-copilot/issues) with the model name and the relevant output-channel error. Never include your API token.

To refresh the capability table after a plan page changes, re-run the generator.
It reads the docs page and the model catalog — one request each, not one per
model:

```bash
node tools/generate-capabilities.mjs
node tools/generate-capabilities.mjs --plan pro --out src/capabilities.ts
```

Never edit `src/capabilities.ts` by hand — the file header says so, and a wrong
capability flag makes Copilot send images to a text-only model.

## Attribution

This project is a fork of the original [Command Code Copilot Provider](https://github.com/Tyrannmisu/commandcode-copilot-provider) by Tyrannmisu, maintained and published by [Ho Trung Nhan](https://github.com/hotrungnhan).

It bundles [`commandcode-proxy`](https://github.com/MAXeaglet/commandcode-proxy) by MAXeaglet (MIT), vendored unmodified at a pinned commit. `tools/vendor-proxy.mjs` refreshes it and verifies the copy's digest; `npm run verify:proxy` re-checks what is on disk, and `npm run package` runs that check before shipping.

## License

[MIT](LICENSE)
