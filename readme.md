# Game Wave Pong

Game Wave Pong is a fast, arcade-style browser Pong game with wave weapons, XP progression, multiball chaos, instant powerups, and head-to-head stats. It runs as a static browser game with the runtime kept under `runtime/`, so it can be opened locally or packaged for itch.io as an HTML5 game.

## What the game is

At its core, this is Pong with two big twists:

1. **You are not limited to paddle contact.** Each paddle has a wave cannon with three wave types driven by a shared charge bar.
2. **Matches escalate over time.** Waves gain XP, powerups appear mid-match, XP minions can be farmed, and long rallies can eventually trigger multiball.

The result is part Pong, part arena control game.

## How to play

Open `runtime/index.html` in a modern desktop browser.

## Project layout

- `version.json` contains the current release/build version.
- `runtime/index.html` contains the game UI markup and is the local browser entrypoint.
- `runtime/js/version.js` exposes the current build version to the runtime UI.
- `runtime/js/runtime-env.js` contains the browser-consumed online endpoint config and keeps the client static-host friendly.
- `runtime/js/config.js` contains the primary gameplay tuning surface and static definitions.
- `runtime/js/env.js` resolves optional API and WebSocket endpoints for online play without changing the static client deployment model.
- `runtime/js/shared/` contains browser-loadable shared multiplayer modules that are also re-exported for Node under `shared/`.
- `runtime/js/controllers.js` contains the human, scripted CPU, and neural bot controller adapters.
- `runtime/js/sim-core.js` contains the deterministic simulation, physics, rendering, replay, and UI runtime.
- `runtime/js/bot-roster.js` contains the published ML bot roster used by the CPU selector.
- `runtime/js/online.js` contains the static-client session, queue, match socket, and reconciliation layer for online play.
- `runtime/js/app.js` bootstraps the browser runtime, wires the menu/bot-info UI, swaps between classic CPU and ML bots, and owns the multiplayer menu surface.
- `runtime/styles/main.css` contains the presentation layer.
- `runtime/wave_pong.html` is a legacy entry that redirects to `runtime/index.html`.
- `shared/multiplayer/config.js`, `shared/protocol/index.js`, and `shared/sim/engine.js` expose Node entrypoints for the shared multiplayer modules that still ship inside `runtime/`.
- `backend/control-plane/` contains the queue, auth, chat, leaderboard, and match-ticket service.
- `backend/match-worker/` contains the authoritative match host built on the deterministic simulation core.
- `backend/config.js` centralizes environment loading for local `.env`, cloud env vars, and generated runtime endpoint config.
- `backend/dev-server.js` runs a local control-plane plus match-worker pair for end-to-end multiplayer testing.
- `docker-compose.yml` starts local Postgres and Redis for persistence-shaped development.
- `infra/terraform/` contains the provider-neutral deployment contract that generates backend env files and static runtime config.
- `training/evolve-bots.js` runs the offline training pipeline and writes reports, checkpoints, exports, and auto-promotion snapshots.
- `training/publish-bots.js` validates and publishes trained candidates into `runtime/js/bot-roster.js`.
- `training/promote-live-training.js` snapshots a still-running trainer process and optionally publishes the live candidates.
- `training/workbench/` contains the interactive training workbench server and browser UI for live run control, replay browsing, and ratings persistence.
- `training/readme.md` documents the training workspace layout and leaves room for future standalone training runtime code.
- `tools/write-runtime-env.js` writes `runtime/js/runtime-env.js` from the current `.env` values so the static client can follow local or cloud endpoints without query params.
- `tools/serve-runtime.js` serves the static runtime locally on `http://127.0.0.1:8080/runtime/index.html` and writes request plus browser debug logs under `logging/`.
- `tools/browser-smoke-test.ps1` launches the Windows smoke test browser and cleans it up.
- `tools/browser-smoke-test.js` contains the DevTools-driven smoke assertions and can also attach to an already-launched browser.
- `tools/package.json` contains tooling-only Node metadata.

## itch.io packaging

Versioning is tracked in `version.json`. The current repo version is `0.7.0`.

Version rules:

- increment the third number for minor rebuilds and small changes
- increment the second number and reset the third for bigger change sets
- increment the first number for a major release or redesign

Rebuilds do not auto-increment the version. Bump the version explicitly first, then package the build.

Version bump commands from `tools/`:

```bash
npm.cmd run version:patch
npm.cmd run version:minor
npm.cmd run version:major
```

Those commands update both `version.json` and `runtime/js/version.js`, so the in-game menu version stays in sync with packaging and deploy metadata.

Recommended release flow:

1. run the appropriate version bump command
2. run `npm.cmd run smoke`
3. run `powershell -ExecutionPolicy Bypass -File ..\tools\build-itch-zip.ps1`
4. deploy with the local butler helper

For itch.io uploads, build the self-contained artifact first:

```bash
node tools/build-itch-html.js
```

That generates `itch-build/`, which contains a single-file `index.html` with the runtime CSS and JS inlined for safer iframe deployment on itch.io.

If you are uploading a zip manually, zip the **contents** of `itch-build/`, not the folder itself.

Recommended command on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\build-itch-zip.ps1
```

That command:

- rebuilds `itch-build/`
- creates the single current deploy zip as `wave-pong-itchio-v<version>.zip`
- verifies the archived `index.html` matches `itch-build/index.html`

## Smoke testing

Run the default Windows smoke test with:

```bash
npm.cmd run smoke
```

That script uses `tools/browser-smoke-test.ps1` to launch Edge headlessly through PowerShell, attach the Node-based DevTools checks, and clean up the browser/profile directory afterward.

If you specifically want the raw Node launcher, use:

```bash
npm.cmd run smoke:node
```

For local multiplayer debugging, you can also serve the runtime through the repo-local webserver:

```bash
cd tools
npm.cmd run serve:runtime
```

That serves `runtime/index.html` from `http://127.0.0.1:8080/runtime/index.html` and writes access logs plus browser-reported fetch/websocket errors to `logging/`.

## Runtime architecture

The browser runtime is split into small layers instead of one giant script:

- `runtime/index.html` loads the version, config, online env, shared multiplayer helpers, controllers, simulation core, shared engine wrapper, published bot roster, online client layer, and browser bootstrap in that order.
- `runtime/js/app.js` creates the runtime, populates the CPU selector with both classic scripted difficulties and published ML bots, exposes the bot dossier overlay, and wires the multiplayer control surface.
- `runtime/js/sim-core.js` owns the deterministic match simulation. It is still the source of truth for world state, tick stepping, controller input queuing, rendering, replay serialization, and state hashing, but it now also supports pluggable live input so the online client can drive prediction and reconciliation.
- `runtime/js/shared/engine.js` wraps the deterministic runtime with authoritative-match helpers and serializable state snapshots for the backend.
- `runtime/js/shared/protocol.js` and `runtime/js/shared/multiplayer.js` define the canonical queues, regions, rulesets, and message validation shared by browser and backend.
- `runtime/js/online.js` manages guest sessions, control-plane and match-worker sockets, queueing, lobby chat, match quick-chat, and snapshot application.
- `runtime/js/controllers.js` turns either player input, scripted heuristics, or a trained neural network into the same `{ moveAxis, fire }` action shape.

## Multiplayer foundation

Wave Pong now includes the first production-minded multiplayer foundation while keeping the shipped client browser-only and static:

- `backend/control-plane/` exposes guest auth, local-dev account verification, queue joins/leaves, seasons, leaderboards, reconnect tickets, and lobby chat over HTTP plus a minimal WebSocket control channel.
- `backend/match-worker/` runs authoritative 120 Hz matches using the same deterministic simulation core as the browser and offline bot tooling.
- `backend/dev-server.js` starts both services locally. With the defaults, the control-plane listens on `http://127.0.0.1:8787` and the match-worker listens on `http://127.0.0.1:8788`.
- The browser client can opt into online mode by opening `runtime/index.html` with query params like `?api=http://127.0.0.1:8787&controlWs=ws://127.0.0.1:8787/ws/control`.
- Ranked, standard, and chaos playlists now live in `runtime/js/config.js` under `multiplayer`, so the same canonical ruleset data can be consumed by browser, backend, and future tooling.

Local backend flow:

```bash
cd backend
npm.cmd run dev
```

Then open the static client with the query params above from `runtime/index.html`.

## Local online infrastructure

The online stack can now be developed fully locally with the same config contract that cloud deploys use:

1. Copy `.env.example` to `.env` and adjust values if needed.
2. Start local Postgres and Redis:

```bash
docker compose up -d
```

3. Generate browser runtime config from the same `.env` values:

```bash
cd tools
npm.cmd run runtime:env
```

4. Start the local backend:

```bash
cd backend
npm.cmd run dev
```

5. Serve or open `runtime/index.html`. The browser client will pick up `runtime/js/runtime-env.js` automatically, and query params remain available for temporary overrides.

The generated `runtime/js/runtime-env.js` keeps the client browser-only and static. The backend can move between local Node, containers, and cloud hosting without changing the runtime code.

## Terraform deploy contract

`infra/terraform/` is a provider-neutral Terraform scaffold for the multiplayer stack. It does not create Fly, Render, or Railway resources directly yet; instead it generates the artifacts those platforms need:

- a backend env file with canonical service URLs and secrets
- a static `runtime-env.js` file for the browser client
- a JSON deployment contract for CI or ops tooling

Typical usage:

```bash
terraform -chdir=infra/terraform init
terraform -chdir=infra/terraform plan -var-file=environments/dev.tfvars
terraform -chdir=infra/terraform apply -var-file=environments/dev.tfvars
```

Generated files are written to `infra/terraform/generated/<environment>/`.

### Deterministic simulation

The game simulation runs at a fixed internal tick rate of 120 Hz. Controller decisions are sampled every 2 ticks by default, then queued into the simulation. That matters for both gameplay and training:

- offline training uses the exact same simulation core as the browser runtime
- replay exports serialize the same action stream and periodic state hashes
- seeded runs stay reproducible because the runtime uses a deterministic RNG instead of `Math.random()` inside the sim loop

This shared deterministic core is what makes the machine-learning pipeline trustworthy. The trainer is not learning in a toy approximation of the game. It is learning against the real runtime rules.

### CPU controllers

There are two CPU paths in the shipped game:

- classic CPU difficulties (`Chill`, `Spicy`, `Ridiculous`) use the scripted controller in `runtime/js/controllers.js`
- published ML bots use the neural controller backed by `runtime/js/bot-roster.js`

The scripted controller predicts the closest incoming ball, tracks toward it with a deadband, and probabilistically fires based on distance, charge, and aim alignment. It is still useful as a stable baseline and fallback opponent even though the repo now supports trained bots.

### Neural bot control

ML bots are plain JSON assets with:

- `schemaVersion`
- `id`, `name`, lineage and metadata
- `controllerParams`
- `network`

At runtime, the neural controller:

1. Builds a normalized observation for the chosen side.
2. Flattens that observation into a 59-value input vector.
3. Runs a feed-forward MLP with hidden `tanh` activations.
4. Interprets the 3 output neurons as `moveLeft`, `moveRight`, and `fire`.
5. Passes those outputs through `sigmoid`.
6. Applies `controllerParams.moveThreshold` and `controllerParams.fireThreshold`.

If neither move output beats the movement threshold, the bot stays still. If one side wins, the paddle moves up or down by choosing the stronger move output. Firing is a simple thresholded boolean on the third output.

### Observation model

The 59-value neural input vector is intentionally side-relative so the same network shape works on either side of the court. The observation includes:

- self paddle state: vertical position, velocity, size, aim angle, charge, level, cooldown
- opponent paddle state: mirrored into the same coordinate frame
- score state: own score, opponent score, score limit ratio
- match meta: rally length, balls in play, powerups in play, countdown state
- nearest 4 balls: normalized position, velocity, travel direction relative to the observing side, and radius
- nearest 4 powerups: normalized position, radius, and remaining life

Because ball and powerup lists are distance-sorted relative to the observing paddle, the network sees the most immediately relevant objects first.

## Bot training

Run bot evolution from the repo root with:

```bash
node training/evolve-bots.js --population 20 --generations 900 --update-all-roster --checkpoint-every 25
```

### What the trainer is optimizing

The trainer does not use gradient descent. It is an evolutionary search loop that repeatedly:

1. Builds or reloads populations of neural bots.
2. Plays full deterministic matches between bots using `runtime/js/sim-core.js`.
3. Collects match statistics and runtime-derived metrics.
4. Scores each bot with the same weighted fitness function.
5. Updates Elo from match outcomes.
6. Selects elites plus protected tracked-seed lineages.
7. Clones and mutates the next generation.
8. Exports and optionally publishes the best candidates.

This means the learning system is closer to neuroevolution than to backprop-based reinforcement learning.

### Open populations and optional labels

The trainer now evolves one shared population instead of splitting search into archetype pools.

Published bots can still carry metadata such as:

- `archetype`
- display names like `Strategist` or `Sniper`
- style tags in published roster metadata

Those labels are descriptive only. They do not change fitness weights, promotion logic, controller defaults, or mutation behavior.

### Training loop details

Each generation:

- creates a round-robin over all mutable bots, plus any static roster opponents
- runs matches to the configured score limit or max tick budget
- records movement, shots, powerup pickups, ball hits, wave hits, rally length, and pace
- converts those raw metrics into normalized per-match averages

Fitness is not a single opaque reward. It is a weighted sum of readable metrics such as:

- wins and goal differential
- against-goals pressure
- longest rally and pace
- shots and shot rate
- wave hit rate and ball hit rate
- fast-win bonus for closing out victories quickly
- creativity bonus for productive variety, powerup usage, ball control, and lively exchanges
- penalties for reckless quick losses, wasteful firing, and slow low-event stalls

The goal is now a little more opinionated: reward bots for winning quickly, doing interesting productive things on the way there, staying active, and avoiding both passive survival and reckless self-sabotage.

Those normalized metric names are documented in `TRAINING_METRIC_GUIDE` inside `training/evolve-bots.js`.

### Match evaluation and metrics

Training match evaluation uses the real runtime with these important constraints:

- deterministic seed per match
- demo mode
- powerups enabled
- trails disabled
- configurable score limit
- configurable max tick cap to prevent pathological infinite matches

For each side, the trainer builds metrics such as:

- `shots`, `shotRate`
- `ballHits`, `ballHitRate`
- `waveHits`, `waveHitRate`
- `movedTickRate`, `movementRate`
- `powerups`, `powerupRate`
- `fastWinScore`, `quickLossPenalty`
- `creativityScore`, `shotWastePenalty`, `stallPenalty`

The trainer also tracks movement directly by sampling paddle Y every simulation tick during the match. That is how it can distinguish a bot that survives passively from one that is actually moving and playing.

### Networks and mutation

New bots use the same observation shape and MLP structure as runtime bots:

- input size: 59
- hidden layers: `12 -> 8`
- output layer: `3`
- hidden activation: `tanh`
- output interpretation: left, right, fire logits passed through `sigmoid`

Evolution mutates two things:

- network weights and biases
- controller thresholds in `controllerParams`

Controller params matter because they control how aggressively the runtime converts output activations into movement and firing. Small threshold changes can produce meaningful playstyle changes even when the network stays similar.

### Tracked-seed fine tuning

When you pass `--update-all-roster` or `--focus-bot-id`, the trainer treats published roster bots as tracked seeds instead of starting from scratch.

The current fine-tuning path does several things to keep those seeds trainable:

- roster seeds are loaded from `runtime/js/bot-roster.js`
- `--focus-bot-id <botId>` isolates one published bot while keeping the rest of the roster as fixed opponents by default
- each tracked seed keeps its lineage via `sourceBotId`
- each tracked lineage gets a guaranteed search budget each generation
- inert tracked lineages automatically switch into rescue mutation mode

The rescue path is there specifically to avoid the old failure mode where a published seed that never moved would stay frozen forever while the run still looked superficially healthy.

### Rescue mutation mode

If a tracked lineage fails minimum activity checks such as:

- active-match rate
- shots per match
- moved-tick rate
- wave hits per match

the trainer marks it as needing rescue and widens the search:

- more descendants are reserved for that lineage
- controller threshold mutation gets stronger
- network mutation gets stronger
- some rescue children partially re-randomize hidden or output layers
- rescue variants deliberately explore balanced, move-biased, and fire-biased threshold combinations

This is what allows dead seeds like a non-moving defensive bot to re-enter the search space instead of being preserved unchanged forever.

### Promotion scoring

A bot is not promoted on Elo alone, but it is no longer style-gated.

The trainer builds a promotion candidate score from:

- Elo
- average fitness bonus
- optional human review score
- large penalties for review-blocked bots

### Export, reports, checkpoints, and logs

Every run writes machine-readable artifacts under `training/reports/`:

- a timestamped training log
- generation checkpoints
- `latest-evolution-report.json`
- replay bundles for selected matches
- exported candidate bot scripts

Useful flags:

- `--publish-runtime` publishes the final export to the roster file when training completes
- `--auto-promote-every <N>` snapshots and publishes current best eligible bots every `N` generations
- `--log-file <path>` pins the run log to a specific file instead of a timestamped default
- `--roster-file <path>` lets you train and auto-promote against a temporary roster for dry runs
- omit `--progress-every` to keep the built-in low-noise progress logging

The generation tune line is intentionally short but high signal. It reports when a lineage still has `no-active-descendant` and is running in rescue mode.

### Training workbench

Run the local workbench server from the repo root with:

```bash
npm --prefix training run workbench
```

Then open `http://127.0.0.1:8936/` to:

- start and stop training runs
- monitor checkpoints, progress traces, top candidates, and recent logs
- inspect replay bundles from recent runs
- review matches with either rendered clips or live replay rendering
- save review ratings back to `training/reports/review-ratings.json`

### Publishing bots into the runtime

Publishing is handled by `training/publish-bots.js`, not by blindly copying exports into the roster.

The publish step:

- normalizes incoming candidates
- runs quick runtime activity validation samples
- marks fully inert bots as `runtimeDisabled`
- adds style tags like `active-mover`, `measured-mover`, or `static-lane`
- skips redundant candidates that are almost identical to an existing roster bot
- requires head-to-head promotion wins when replacing an existing bot

Replacement uses a seeded promotion series where candidate and existing bots play from both sides. A candidate only replaces the roster bot if it wins on match points, with goal difference as the tiebreaker.

### Live promotion during a long run

`training/promote-live-training.js` can attach to a live Node training process, snapshot the current trainer state, export the current best candidates, and optionally publish them without waiting for the full run to finish.

That is useful when:

- a long overnight run is still in progress
- you want to try the current best bots in the browser immediately
- you want to inspect live candidates without stopping the trainer

### Guidance for future roster labels

When adding future roster identities:

- reuse the normalized metric keys from `TRAINING_METRIC_GUIDE`
- keep training objective changes generic unless you intentionally want guided evolution again
- treat archetype and role labels as optional metadata
- avoid hardcoding label-specific logic inside the simulation loop
- keep lineage protection tied to tracked seed ids, not metadata labels

## itch.io deployment with butler

This repo now includes both a local butler helper and a GitHub Actions workflow for pushing the HTML5 build to itch.io.

### GitHub Actions workflow

Workflow file: `.github/workflows/itch-deploy.yml`

Set this repository secret before running it:

- Secret: `BUTLER_API_KEY`

The workflow is manual by default (`workflow_dispatch`), builds the single-file itch artifact, and uploads `itch-build/` to one of these repo-specific targets:

- `test`: `rainman1337/wave-pong-test:html5`
- `production`: `rainman1337/wave-pong:html5`

`test` is the default destination so updates land in the test project first. You have to explicitly choose `production` when you want to push the final build.

The workflow uploads with:

```bash
butler push itch-build rainman1337/wave-pong-test:html5 --userversion <value>
```

If you leave the workflow `userversion` input blank, it falls back to `<branch-or-tag-name>-<short-sha>`.

### Local Windows helper

Helper script: `tools/deploy-itch.ps1`

The helper automatically loads a repo-root `.env` file for local credentials and overrides.

Example:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\deploy-itch.ps1 `
  -Destination test
```

Production example:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\deploy-itch.ps1 `
  -Destination production
```

The script:

- builds `itch-build/` by default before pushing
- defaults `BuildPath` to `itch-build/`
- defaults `Destination` to `test`
- automatically loads `.env` from the repo root before resolving credentials
- defaults `UserVersion` to the current value in `version.json` when `-UserVersion` is not provided
- reads `BUTLER_API_KEY` from `.env` or the current shell session
- maps `test` to `rainman1337/wave-pong-test:html5`
- maps `production` to `rainman1337/wave-pong:html5`
- can override those targets with `ITCH_TARGET_TEST` and `ITCH_TARGET_PRODUCTION` in `.env`
- can read `BUTLER_PATH` from `.env` if butler is not on `PATH`
- still accepts an explicit `-Target` override if you need a one-off push elsewhere
- looks for `butler.exe` on `PATH`
- falls back to the itch app's bundled butler install on Windows
- accepts local `butler login` credentials or a `BUTLER_API_KEY` environment variable

Example `.env`:

```dotenv
BUTLER_API_KEY=replace_with_your_butler_api_key
ITCH_TARGET_TEST=rainman1337/wave-pong-test:html5
ITCH_TARGET_PRODUCTION=rainman1337/wave-pong:html5
```

Convenient npm shortcuts from `tools/`:

```bash
npm.cmd run deploy:test
npm.cmd run deploy:production
```

If you do not pass `-UserVersion`, local deploys will use the version from `version.json`, for example `0.7.0`.

You can still override it for a one-off deploy:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\deploy-itch.ps1 `
  -Destination test `
  -UserVersion "0.7.0-hotfix1"
```

### First-time itch.io setup

After the first push:

- set the project type to `HTML`
- mark the uploaded channel as `HTML5 / Playable in browser`
- confirm itch.io is using `index.html` from the uploaded build

### Controls

#### Single player
- **W / S** move your paddle
- **Up / Down** also move your paddle
- **F or Space** fire your wave
- **P** pause
- **M** mute
- **Esc** open menu

#### Two player
- **Player 1:** W / S move, F or Space fire
- **Player 2:** Up / Down move, / fire
- **P** pause
- **M** mute
- **Esc** open menu

## Objective and rules

- Score by sending a ball past the opponent into their goal.
- The score limit is configurable in settings.
- When a ball scores, the point is awarded and **a new ball is added**. The field is not wiped, so existing balls, waves, and powerups can keep the match chaotic.
- Long rallies can still add more balls over time, but at a moderated pace.
- Matches end when one side reaches the selected goal total.
- The game tracks match stats and browser-saved historical totals.

## Core systems

## Paddles and aiming

Each paddle has a visible aiming line. As you move up or down, the aim tilts smoothly so the shot direction feels connected to paddle motion rather than snapping.

## The wave bar

Every paddle has a shared **wave charge bar**.

- Base max charge is **100%**
- The bar refills automatically over time
- You can fire again almost immediately as long as you still have enough charge

### Wave costs

- **Blue wave:** 15% charge
- **Pink wave:** 50% charge
- **Gold wave:** 100% charge

Some powerups can temporarily increase max charge to **150%** and speed up recharge.

## Wave XP and leveling

Wave power scales with XP.

You gain XP from:
- passive gain over time
- scoring goals
- hitting your opponent with offensive wave pressure
- breaking XP minions
- XP-related powerups

You can lose XP from:
- debuff powerups such as **XP Drain**
- being hit by strong yellow wave effects

Leveling improves wave performance, but the game is tuned so the scaling stays readable rather than exploding into total screen spam.

# Wave powers

## Blue wave

**Role:** ball control, tempo control, offense and defense

The blue wave is the cheapest and most flexible wave. It is designed to be used often.

### What it does
- Fast travel speed
- Slightly extended range
- Stronger sweet spot in the center
- If it hits a ball moving **away** from the paddle, it can apply a **boost**
- If it hits a ball moving **toward** the paddle, it can apply a brief **hit stun**, then release the ball at its post-hit velocity
- Sweet spot blue hits create stronger boosts and better control
- Blue-boosted balls are slightly more resistant to yellow wave influence

### Best use cases
- saving or stabilizing a loose ball
- accelerating a counterattack
- re-aiming a ball that is drifting out of position
- forcing awkward rebounds for the opponent

## Pink wave

**Role:** defense and emergency saves

Pink is the solid defensive wave. It has a wider angle but a shorter reach than blue.

### What it does
- wider coverage cone
- shorter range
- thicker visual presence
- more “wall-like” defensive behavior
- especially good at protecting near-goal situations

### Best use cases
- saving points that are about to slip in
- blocking tight angle attacks near your side
- stabilizing defense when multiball gets messy

## Gold wave

**Role:** offense, disruption, and precision power plays

Gold is the full-bar super wave.

### What it does
- consumes the full charge bar
- travels as a broad offensive arc
- is strongest in the **center sweet spot** and weaker at the edges
- rewards accurate aim instead of random spraying
- can deflect balls strongly in the wave direction when the sweet spot connects
- can add a boost to the ball on a strong center hit
- can hit paddles and disrupt them
- grows slightly when it connects with balls
- can interact with powerups on the field
- uses visual diffraction-style effects on wall contact

### Best use cases
- forcing a scoring window
- breaking an opponent’s defensive setup
- punishing predictable ball paths
- sweeping live powerups while applying pressure

## Ball feedback

The ball changes color based on **who hit it last**, making possession and control easier to read.

Boosted balls also get a speed visual effect so you can tell when a wave has added extra pace.

# Powerups

Powerups are **instant** when collected. Buffs and debuffs are visually distinct, and a short floating label appears at the pickup location so you can see what was triggered.

## Buff powerups

### Mega Paddle (⇕)
Temporarily increases paddle size for better coverage.

### Overcharge (⚡)
Instantly tops off your current wave bar.

### Cap Bank (▰)
Temporarily extends your maximum wave bar to **150%**.

### Rapid Charge (≫)
Temporarily increases wave recharge speed.

### Multiball (◎)
Adds another ball to the court.

### XP Surge (⟲)
Gives bonus wave XP.

## Debuff powerups

### Shrink Hex (⇣)
Temporarily reduces the opponent paddle size.

### Drag Field (⌛)
Temporarily slows the opponent paddle.

### Aim Jam (✶)
Disrupts the opponent’s aim control.

### XP Drain (◌)
Cuts opponent XP and drains some wave resources.

## XP minions

### XP Minion (✹)
A special target you can hit with the ball or a wave for XP. These are not just pickups. They are mini objectives you can farm during play.

# Match flow and stats

The game keeps the match moving fast:

- waves recharge automatically
- you can fire repeatedly if you have charge
- points do not clear the whole field
- multiball ramps tension without turning every match into instant nonsense

At game over, the match ending is distinct instead of instantly snapping into a new round. The game also tracks statistics such as:

- wins
- points scored
- ball hits
- shots fired
- wave hits
- powerups collected
- best rally / longest rally
- last winner

Historic stats are stored locally in your browser.

# Strategy guide

## 1. Use blue constantly
Blue is your general-purpose tool. Because it is cheap, fast, and flexible, it should be part of your normal rhythm rather than something you save forever.

## 2. Use pink like a shield, not a snipe
Pink is best when the ball is threatening your goal or when you need broad short-range coverage. It is about reliability, not reach.

## 3. Aim yellow with intent
Gold is strongest in the center. A centered hit is much better than a sloppy edge hit. Treat it like a precision power play.

## 4. Farm XP without losing court control
XP minions and XP powerups are valuable, but chasing them blindly can give up points. Take them when they fit your ball control, not when they pull you out of position.

## 5. Fight for the middle in multiball
As more balls arrive, court control matters more than raw aggression. Blue helps steer the chaos, pink saves emergencies, and yellow should be used to create a clean scoring opening rather than random noise.

## 6. Watch the charge bar, not just the ball
Because blue, pink, and gold all spend from the same resource, smart timing matters. A full bar is pressure. A half bar is still dangerous. An empty bar means you are back to pure paddle fundamentals.

# Feature summary

- Static browser game with itch.io-ready entrypoint
- Single player, local two player, and demo options
- Smooth paddle aiming
- Shared wave charge system
- Three wave types with different roles
- XP leveling for wave power
- Instant powerups and debuffs
- XP minions
- Multiball escalation
- Ball ownership color feedback
- Boost visuals on fast balls
- Match stats and persistent history
- Neon arcade presentation with sound and effects

# Recommended play styles

## Safe control style
Use blue for steady control, pink for emergency defense, and save gold for obvious punish windows.

## Aggressive pressure style
Farm XP early, contest powerups hard, and use gold to disrupt the opponent before they can stabilize.

## Survival style in multiball
Prioritize positioning and pink defense first. Then use blue to tame the most dangerous ball before looking for offense.

# Notes

This README describes the current Game Wave Pong build and its intended gameplay loop. If you continue tuning the game, update this README alongside the code so the strategy and powerup sections stay accurate. Gameplay balance now lives in `runtime/js/config.js`.
