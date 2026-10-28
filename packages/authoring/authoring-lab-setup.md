# ChainCraft Authoring Lab — Setup Guide

Purpose: measure how well off-the-shelf coding agents (GitHub Copilot in VS Code, Claude Code)
can author ChainCraft games, and what each costs — in an environment that looks like a real
creator's machine, not our dev monorepo.

> **Status:** step 1 is in place: the `chaincraft` command (`init`, `validate`, `compile`) ships in
> `@chaincraft/authoring` and is packed with the other tarballs by `npm run pack:packages`.
> `playtest` and `docs` arrive in later steps.

---

## 1. Principles

- **Representative:** the agent sees only what a real creator would — installed ChainCraft
  packages, the files `chaincraft init` writes, and the game request. No monorepo checkout, no
  personal instructions/skills/memory.
- **Reproducible:** every run starts from an identical clean folder, pinned engine version.
- **Measured:** every run produces one row in `results.csv` (cost + outcome).
- **One paid account:** tiers are emulated by model choice + request counting, not by
  buying extra subscriptions.

---

## 2. Folder layout

```
~/cc-lab/
  packages/        # npm pack tarballs (@chaincraft/*), one engine version per batch
  briefs/          # game requests: high-card.md, liars-dice.md, <novel>.md
  runs/            # one fresh folder per run (created by new-run.sh)
  claude-config/   # isolated Claude Code config dir
  new-run.sh
  results.csv
```

Keep `briefs/` **outside** run folders — each run gets a copy of only its own brief.

```bash
mkdir -p ~/cc-lab/{packages,briefs,runs,claude-config}
```

---

## 3. VS Code + GitHub Copilot

### 3.1 Create an isolated profile
1. Command Palette → **Profiles: New Profile…**
2. Name it **CC Lab**, start from **Empty** (do not copy your default profile).
3. In the CC Lab profile, install only: **GitHub Copilot** and **GitHub Copilot Chat**.
   Do not install other AI or language extensions unless a real creator would have them.
4. Sign in with your normal GitHub account.

### 3.2 Remove personal customizations
In the CC Lab profile:
- Make sure there are **no user-level** instructions, prompt files, custom agents, or skills
  (Chat view → Configure / gear menu → check each list is empty at user scope).
- **Disable Copilot memory** (Settings → search "memory").
- Leave **workspace-level** instruction files enabled — `chaincraft init` writes `AGENTS.md` and
  skills into the project, and those are part of what we're testing.

### 3.3 Verify
Open an empty folder in the CC Lab profile, start Agent mode, and ask:
"List every instruction file, skill, and memory you have loaded." Expect: nothing.

### 3.4 Opening a run
Always open run folders with the CC Lab profile:
```bash
code --profile "CC Lab" ~/cc-lab/runs/<run-folder>
```

---

## 4. Claude Code

### 4.1 Isolate config
Point Claude Code at a lab-only config dir so your personal `~/.claude` (user `CLAUDE.md`,
skills, settings) is not loaded:

```bash
# ~/cc-lab/lab-env.sh — source this before any Claude Code lab run
export CLAUDE_CONFIG_DIR="$HOME/cc-lab/claude-config"
```

### 4.2 Billing: use an API key for exact cost
For cost measurement, run Claude Code against a **dedicated lab API key** (pay-as-you-go)
rather than a subscription. That gives exact token and dollar figures per run, which we then
map onto subscription tiers.

```bash
# add to lab-env.sh (never commit this file)
export ANTHROPIC_API_KEY="sk-ant-..."   # lab-only key
```

Confirm inside Claude Code with `/status` that it is using the API key, and use `/cost` at
the end of each run.

### 4.3 Verify
```bash
source ~/cc-lab/lab-env.sh
cd "$(mktemp -d)" && claude
```
Ask: "What instructions, memory files, or skills do you have loaded?" Expect: nothing.

---

## 5. Creating a run

`~/cc-lab/new-run.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
agent="$1"; model="$2"; brief="$3"
run="$HOME/cc-lab/runs/$(date +%Y%m%d-%H%M)-$agent-$model-$brief"
mkdir -p "$run" && cd "$run"
npm init -y >/dev/null
npm install "$HOME"/cc-lab/packages/*.tgz
npx chaincraft init
cp "$HOME/cc-lab/briefs/$brief.md" REQUEST.md
printf "node_modules/\n" > .gitignore
git init -q && git add -A && git commit -qm "baseline"
echo "$run"
```

```bash
chmod +x ~/cc-lab/new-run.sh
~/cc-lab/new-run.sh copilot base high-card
```

`git diff baseline` at the end of a run shows exactly what the agent wrote.

---

## 6. Run protocol

Same opening prompt for every run (paste verbatim):

> Read REQUEST.md and build the game it describes using ChainCraft. Use the `chaincraft`
> commands to check your work. Stop when `chaincraft compile` passes, or when you are blocked
> and need a decision from me.

Until `chaincraft playtest` exists (step 2), record `playtest_passed` as `n/a` in `results.csv`.

Rules:
- **One run at a time** — so usage counter deltas belong to a single run.
- Record the usage counter **before** and **after** (see §7).
- Only intervene to answer the agent's questions or unblock a stall. **Log every
  intervention** (count + one-line note).
- Don't fix the spec yourself. If the agent is stuck for good, stop and record "blocked".
- After a successful build, do one **edit scenario** in a new chat session (e.g. "Change the
  rules so a tie gives both players a point"). Log it as a separate row — editing is most of
  a creator's time and costs differently from initial creation.

---

## 7. Cost tracking

| Agent | Where to read usage |
|---|---|
| Copilot | GitHub → Settings → Billing/Copilot premium request usage (exportable report), plus the Copilot usage indicator in VS Code. Note value before/after each run. |
| Claude Code | `/cost` at end of session; Anthropic Console usage for the lab API key. |
| Both | `.chaincraft/log.jsonl` in the run folder — every `chaincraft` call (gate calls, fix cycles, time to first compile / first playtest pass). |

### `results.csv` columns
```
date,agent,model,plan_assumed,brief,scenario,engine_version,
agent_requests,premium_requests,tokens_in,tokens_out,cost_usd,
gate_calls,compiled,playtest_passed,interventions,wall_minutes,outcome,notes
```
- `plan_assumed`: which plan this run emulates (e.g. "Free", "Pro", "Pro+") and the quota
  numbers you assumed — plans change, so record what was true on the run date.
- `scenario`: `create` or `edit`.
- `outcome`: `pass` / `blocked` / `quota-exhausted` / `gave-up`.

---

## 8. Emulating tiers with one paid account

| Config | Emulates | Notes |
|---|---|---|
| Copilot, base model only (no premium multiplier) | Free-tier quality; Pro without premium | Pick only models the Free plan offers on the run date. Compare request count to the Free monthly quota. |
| Copilot, premium model (e.g. Claude Sonnet) | Pro / Pro+ | Record premium requests incl. model multiplier. |
| Claude Code + API key | Claude subscriptions | Exact $ per game → compare to plan limits. |
| **One run on a real free Copilot account** | Ground truth for Free | Borrow a teammate/partner's account. **Don't create a second free GitHub account yourself** — GitHub's terms allow one free personal account per person. |

**Weekly burn estimate:**
`(new games/week × cost per create run) + (edit sessions/week × cost per edit run)`,
compared against each plan's monthly quota ÷ 4.

---

## 9. First batch

- Briefs: High Card, Liar's Dice, one novel game not in our examples.
- Configs: Copilot base model, Claude Code (API key).
- = 6 create runs + edit runs for any that pass.
- Then one run on a borrowed free Copilot account.

That's enough to tell whether the free tier is viable before spending more.
