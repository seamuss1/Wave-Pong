#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const config = require(path.join(repoRoot, 'runtime/js/config.js'));
const simCore = require(path.join(repoRoot, 'runtime/js/sim-core.js'));
const controllers = require(path.join(repoRoot, 'runtime/js/controllers.js'));

function parseArgs(argv) {
  const args = {
    replaysDir: path.join(repoRoot, 'tools', 'reports', 'replays'),
    output: path.join(repoRoot, 'tools', 'reports', 'review-manifest.json'),
    ratingsFile: path.join(repoRoot, 'tools', 'reports', 'review-ratings.json')
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--replays-dir' && argv[i + 1]) args.replaysDir = path.resolve(argv[++i]);
    else if (arg === '--output' && argv[i + 1]) args.output = path.resolve(argv[++i]);
    else if (arg === '--ratings-file' && argv[i + 1]) args.ratingsFile = path.resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadRatings(ratingsFile) {
  if (!ratingsFile || !fs.existsSync(ratingsFile)) {
    return new Map();
  }
  const raw = JSON.parse(fs.readFileSync(ratingsFile, 'utf8'));
  const items = Array.isArray(raw)
    ? raw
    : Array.isArray(raw.items) ? raw.items : [];
  return new Map(items.map((item) => [item.replayId, item]));
}

function simulateBundle(bundle, perturbation = {}) {
  const runtime = simCore.createSimulation({ config, seed: bundle.seed + (perturbation.seedOffset || 0) });
  const leftBot = clone(bundle.leftBot);
  const rightBot = clone(bundle.rightBot);
  leftBot.controllerParams = { ...(leftBot.controllerParams || {}), ...(perturbation.leftControllerParams || {}) };
  rightBot.controllerParams = { ...(rightBot.controllerParams || {}), ...(perturbation.rightControllerParams || {}) };
  runtime.setControllers({
    left: controllers.createNeuralController(leftBot),
    right: controllers.createNeuralController(rightBot)
  });
  runtime.startMatch({
    ...bundle.matchOptions,
    skipCountdown: true
  });

  let maxBallSpeed = 0;
  const maxTicks = bundle.durationTicks + 240;
  while (!runtime.state.gameOver && runtime.state.tick < maxTicks) {
    runtime.stepSimulation(1);
    for (const ball of runtime.world.balls) {
      const speed = Math.hypot(ball.vx, ball.vy);
      if (speed > maxBallSpeed) maxBallSpeed = speed;
    }
  }

  return {
    leftScore: runtime.state.leftScore,
    rightScore: runtime.state.rightScore,
    tick: runtime.state.tick,
    maxBallSpeed,
    hash: runtime.hashSimulationState(),
    leftShots: runtime.matchStats.leftShots,
    rightShots: runtime.matchStats.rightShots
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureDir(path.dirname(args.output));
  const ratingsByReplayId = loadRatings(args.ratingsFile);
  const clipsDir = path.join(path.dirname(args.output), 'clips');
  const toolsDir = path.join(repoRoot, 'tools');
  const replayFiles = fs.existsSync(args.replaysDir)
    ? fs.readdirSync(args.replaysDir).filter((file) => file.endsWith('.json'))
    : [];

  const manifest = replayFiles.map((fileName) => {
    const bundlePath = path.join(args.replaysDir, fileName);
    const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
    const flags = [];

    if ((bundle.metrics.maxBallSpeed || 0) > config.balance.ball.speedCap * 1.2) {
      flags.push('speed_spike');
    }
    if (Math.min(bundle.final.leftScore, bundle.final.rightScore) === 0 && (bundle.metrics.leftShots === 0 || bundle.metrics.rightShots === 0)) {
      flags.push('one_sided_lockout');
    }
    if (bundle.durationTicks > 120 * 75) {
      flags.push('extended_match');
    }

    const plusSeed = simulateBundle(bundle, { seedOffset: 1 });
    const delayed = simulateBundle(bundle, {
      leftControllerParams: { reactionDelayTicks: 1 },
      rightControllerParams: { reactionDelayTicks: 1 }
    });

    const originalWinner = bundle.final.leftScore === bundle.final.rightScore
      ? 'draw'
      : bundle.final.leftScore > bundle.final.rightScore ? 'left' : 'right';
    const plusSeedWinner = plusSeed.leftScore === plusSeed.rightScore
      ? 'draw'
      : plusSeed.leftScore > plusSeed.rightScore ? 'left' : 'right';
    const delayedWinner = delayed.leftScore === delayed.rightScore
      ? 'draw'
      : delayed.leftScore > delayed.rightScore ? 'left' : 'right';

    if (originalWinner !== plusSeedWinner) flags.push('brittle_to_seed_shift');
    if (originalWinner !== delayedWinner) flags.push('brittle_to_input_delay');

    const clipPath = path.join(clipsDir, `${bundle.replayId}.webm`);
    const rating = ratingsByReplayId.get(bundle.replayId) || null;

    return {
      replayId: bundle.replayId,
      replayPath: bundlePath,
      replayFileName: path.basename(bundlePath),
      replayRelativePath: path.relative(toolsDir, bundlePath),
      clipPath,
      clipFileName: path.basename(clipPath),
      clipRelativePath: path.relative(toolsDir, clipPath),
      clipExists: fs.existsSync(clipPath),
      seed: bundle.seed,
      configHash: bundle.configHash,
      botIds: bundle.botIds,
      heuristicFlags: flags,
      perturbationResults: {
        plusSeed,
        delayed
      },
      agentDecision: flags.length ? 'watch' : 'accept',
      humanRating: rating
    };
  });

  fs.writeFileSync(args.output, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`Review manifest written to ${args.output}`);
}

main();
