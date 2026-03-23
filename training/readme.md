# Training

This folder contains the Wave Pong bot-training stack in one place so it can grow into a dedicated runtime later without being mixed into generic repo tooling.

## Layout

- `evolve-bots.js`: core offline training loop, checkpoints, exports, and auto-promotion snapshots
- `publish-bots.js`: validates and publishes trained candidates into `runtime/js/bot-roster.js`
- `promote-live-training.js`: snapshots a still-running training process and can publish the live export
- `review-replays.js`: turns replay bundles into a review manifest and merges human ratings
- `render-replay.js`: renders replay bundles to video clips
- `replay-render.html`: browser renderer used by `render-replay.js`
- `workbench/`: interactive local training interface and API server
- `reports/`: generated checkpoints, manifests, replay bundles, ratings, clips, and run outputs
- `package.json`: training-only npm scripts

## Workbench

Run the local workbench from the repo root:

```bash
npm --prefix training run workbench
```

Then open `http://127.0.0.1:8936/`.

Smoke-test the workbench with Playwright from the repo root:

```bash
npm --prefix training run smoke:workbench
```

## Future structure

This folder is intentionally organized so it can expand into a separate runtime code base later. A good next split would be:

- `runtime/`: training-time simulation wrappers, orchestration, and environment interfaces
- `analysis/`: reports, review scoring, and diagnostics
- `workbench/`: UI, local APIs, and replay tools
- `pipelines/`: promotion, publishing, and batch automation

For now, the current script names stay stable so existing workflows keep working while the code base is grouped together.
