# AGENTS.md

## Repo overview

- This is a static HTML5 browser game.
- `index.html` is the deployable entrypoint and must stay at the zip root for itch.io.
- `wave_pong.html` exists only as a compatibility redirect to `index.html`.

## File map

- `index.html`: overlay markup and script/style includes.
- `styles/main.css`: all page and HUD styling.
- `js/config.js`: primary tuning surface for gameplay numbers and static definitions.
- `js/app.js`: game loop, rendering, input, physics, UI wiring, and persistence.
- `readme.md`: player-facing documentation.

## Change rules

- Preserve browser-only deployment. Do not add a bundler or server requirement unless explicitly requested.
- Keep asset paths relative so the game works on itch.io and under static hosting.
- When adjusting balance, edit `js/config.js` first instead of scattering literals through `js/app.js`.
- Treat refactors as behavior-preserving unless the task explicitly asks for gameplay changes.

## Commit messages

- When creating a commit, write a detailed commit message that captures the important changes, not just a short title.
- The commit message should cover the main code or structure changes, any gameplay or balance changes, deploy or packaging changes, and documentation updates when applicable.
- If a refactor is intended to preserve behavior, say that explicitly in the commit message.
- If risks, follow-up work, or verification gaps remain, note them in the commit message body.

## Packaging

- The deployable zip should contain `index.html`, `wave_pong.html`, `js/`, and `styles/` at the archive root.
- Recommended PowerShell command:
  `Compress-Archive -Path index.html, wave_pong.html, js, styles -DestinationPath wave-pong-itchio.zip -Force`
