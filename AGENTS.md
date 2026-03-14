# AGENTS.md

## Repo overview

- This is a static HTML5 browser game.
- Runtime browser files live under `runtime/`.
- `runtime/index.html` is the local entrypoint in the repo.
- For itch.io packaging, the contents of `runtime/` should be placed at the zip root.
- `runtime/wave_pong.html` exists only as a compatibility redirect to `runtime/index.html`.

## File map

- `runtime/index.html`: overlay markup and script/style includes.
- `runtime/styles/main.css`: all page and HUD styling.
- `runtime/js/config.js`: primary tuning surface for gameplay numbers and static definitions.
- `runtime/js/app.js`: game loop, rendering, input, physics, UI wiring, and persistence.
- `tools/browser-smoke-test.js`: headless browser smoke test with process cleanup.
- `tools/build-itch-html.js`: builds the single-file itch.io HTML artifact under `itch-build/`.
- `tools/deploy-itch.ps1`: local butler helper that builds and pushes the itch.io artifact.
- `tools/package.json`: tooling-only package manifest.
- `readme.md`: player-facing documentation.

## Change rules

- Preserve browser-only deployment. Do not add a bundler or server requirement unless explicitly requested.
- Keep asset paths relative so the game works on itch.io and under static hosting.
- Keep runtime files under `runtime/` and tooling under `tools/`.
- When adjusting balance, edit `runtime/js/config.js` first instead of scattering literals through `runtime/js/app.js`.
- Treat refactors as behavior-preserving unless the task explicitly asks for gameplay changes.

## Commit messages

- When creating a commit, write a detailed commit message that captures the important changes, not just a short title.
- The commit message should cover the main code or structure changes, any gameplay or balance changes, deploy or packaging changes, and documentation updates when applicable.
- If a refactor is intended to preserve behavior, say that explicitly in the commit message.
- If risks, follow-up work, or verification gaps remain, note them in the commit message body.

## Packaging

- Build the itch.io artifact first with `node tools/build-itch-html.js`.
- The deployable zip should contain the contents of `itch-build/` at the archive root.
- Recommended PowerShell command:
  `node tools/build-itch-html.js; Compress-Archive -Path itch-build\* -DestinationPath wave-pong-itchio.zip -Force`
