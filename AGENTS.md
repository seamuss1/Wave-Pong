# AGENTS.md

## Repo overview

- This is a static HTML5 browser game.
- Runtime browser files live under `runtime/`.
- `runtime/index.html` is the local entrypoint in the repo.
- For itch.io packaging, the contents of `runtime/` should be placed at the zip root.
- `runtime/wave_pong.html` exists only as a compatibility redirect to `runtime/index.html`.

## File map

- `runtime/index.html`: overlay markup and script/style includes.
- `runtime/js/version.js`: runtime-exposed build version shown in the menu UI.
- `runtime/styles/main.css`: all page and HUD styling.
- `runtime/js/config.js`: primary tuning surface for gameplay numbers and static definitions.
- `runtime/js/app.js`: game loop, rendering, input, physics, UI wiring, and persistence.
- `tools/browser-smoke-test.ps1`: Windows launcher for the headless browser smoke test with process cleanup.
- `tools/browser-smoke-test.js`: DevTools smoke assertions and browser-attach logic.
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
- Track the repo version in `version.json`.
- Do not treat version bumps as packaging-only. If a task lands a substantial feature/change set, bump the repo version in the same branch even if packaging is not happening in that turn.
- Use versioning rules:
  - increment the third number for minor rebuilds and small changes
  - increment the second number and reset the third for bigger feature/change sets
  - increment the first number for major releases or redesigns
- Do not auto-increment the version during packaging. Bump `version.json` explicitly before packaging, using a patch/minor/major decision.
- Use `powershell -ExecutionPolicy Bypass -File .\tools\bump-version.ps1 -Level patch|minor|major` to update `version.json` and sync `runtime/js/version.js`.
- The deployable zip should contain the contents of `itch-build/` at the archive root.
- Keep only the most recent deploy zip in the repo, and keep the version number in the filename, for example `wave-pong-itchio-v0.3.2.zip`.
- The packaging script should refresh that single current versioned zip and include the current version metadata from `version.json` inside the packaged build.
- Prefer `powershell -ExecutionPolicy Bypass -File .\tools\build-itch-zip.ps1` so the zip is rebuilt and verified against `itch-build/index.html`.
- Recommended PowerShell command:
  `powershell -ExecutionPolicy Bypass -File .\tools\build-itch-zip.ps1`
