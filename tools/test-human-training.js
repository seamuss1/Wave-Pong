#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const roster = require(path.join(repoRoot, 'runtime', 'js', 'bot-roster.js'));
const humanTraining = require(path.join(repoRoot, 'tools', 'human-training.js'));

function flattenNetwork(network) {
  const values = [];
  for (const layer of network.layers || []) {
    values.push(...(layer.biases || []));
    for (const row of (layer.weights || [])) {
      values.push(...row);
    }
  }
  return values;
}

function buildFixtureExport(bot) {
  return {
    schema: humanTraining.EXPORT_SCHEMA,
    exportedAt: new Date().toISOString(),
    runtimeVersion: 'test',
    sessions: [
      {
        sessionId: 'fixture-session-1',
        capturedAt: new Date().toISOString(),
        runtimeVersion: 'test',
        humanSide: 'left',
        bot: {
          id: bot.id,
          name: bot.name,
          difficultyBand: bot.difficultyBand || null,
          elo: bot.elo
        },
        matchOptions: {
          mode: 'cpu',
          demo: false,
          scoreLimit: 3,
          powerupsEnabled: false,
          trailsEnabled: false,
          theme: 'neon',
          difficulty: 'spicy'
        },
        finalScore: {
          left: 1,
          right: 3,
          human: 1,
          bot: 3
        },
        result: {
          humanWon: false,
          botWon: true
        },
        matchStats: {
          leftShots: 2,
          rightShots: 1,
          leftBallHits: 4,
          rightBallHits: 6,
          longestRally: 3
        },
        replay: {
          version: 1,
          seed: 1337,
          configHash: 'fixture',
          durationTicks: 20,
          fixedTickRate: 120,
          decisionIntervalTicks: 2,
          actionEncoding: 'delta-v1',
          actions: [
            { tick: 2, side: 'left', action: { moveAxis: -1, fire: false } },
            { tick: 4, side: 'left', action: { moveAxis: -1, fire: true } },
            { tick: 6, side: 'left', action: { moveAxis: 1, fire: false } },
            { tick: 8, side: 'left', action: { moveAxis: 0, fire: false } },
            { tick: 10, side: 'left', action: { moveAxis: 1, fire: true } },
            { tick: 2, side: 'right', action: { moveAxis: 1, fire: false } },
            { tick: 6, side: 'right', action: { moveAxis: 0, fire: false } },
            { tick: 10, side: 'right', action: { moveAxis: -1, fire: false } }
          ]
        }
      }
    ]
  };
}

function runNodeScript(scriptPath, args) {
  childProcess.execFileSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    stdio: 'inherit'
  });
}

function main() {
  const bot = Array.isArray(roster) && roster[0];
  assert(bot && bot.id, 'Expected at least one roster bot for human training tests.');

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-pong-human-training-'));
  const inputFile = path.join(tempRoot, 'fixture-export.json');
  const datasetFile = path.join(tempRoot, 'human-training-data.json');
  const reportFile = path.join(tempRoot, 'human-training-import-report.json');
  const evolveReportsDir = path.join(tempRoot, 'evolve-reports');

  fs.writeFileSync(inputFile, JSON.stringify(buildFixtureExport(bot), null, 2), 'utf8');

  runNodeScript(path.join(repoRoot, 'tools', 'import-human-training.js'), [
    '--input', inputFile,
    '--output', datasetFile,
    '--report', reportFile
  ]);
  runNodeScript(path.join(repoRoot, 'tools', 'import-human-training.js'), [
    '--input', inputFile,
    '--output', datasetFile,
    '--report', reportFile
  ]);

  const dataset = humanTraining.loadDataset(datasetFile);
  assert.strictEqual(dataset.sessions.length, 1, 'Importer should dedupe repeated session ids.');

  const imitationDataset = humanTraining.buildImitationDatasetByBot(dataset.sessions, {
    maxSamplesPerBot: 4000
  });
  const botSamples = imitationDataset.byBot.get(bot.id) || [];
  assert(botSamples.length > 0, 'Expected reconstructed imitation samples for the imported bot.');

  const botClone = JSON.parse(JSON.stringify(bot));
  const beforeWeights = flattenNetwork(botClone.network);
  const fineTuneSummary = humanTraining.fineTuneBotWithSamples(botClone, botSamples, {
    batchSize: 64,
    epochs: 3,
    learningRate: 0.01
  });
  const afterWeights = flattenNetwork(botClone.network);
  assert(afterWeights.length >= beforeWeights.length, 'Fine-tuning should preserve or expand the network shape for new inputs.');
  assert.strictEqual(botClone.network.inputSize, botSamples[0].inputs.length, 'Fine-tuned bot should match the current observation width.');
  assert(afterWeights.some((value, index) => Math.abs(value - (beforeWeights[index] ?? 0)) > 1e-8), 'Fine-tuning should update at least one network weight.');
  assert.strictEqual(fineTuneSummary.sampleCount, botSamples.length, 'Fine-tune summary should report the used sample count.');
  assert(Array.isArray(fineTuneSummary.positiveWeights) && fineTuneSummary.positiveWeights.length === 3, 'Fine-tune summary should report class-balance weights.');
  assert(fineTuneSummary.positiveWeights.some((weight) => weight > 1), 'Sparse action labels should receive positive weighting.');
  assert(fineTuneSummary.positiveWeights[2] > 1, 'Sparse fire labels should receive positive weighting.');

  runNodeScript(path.join(repoRoot, 'tools', 'evolve-bots.js'), [
    '--generations', '1',
    '--population', '2',
    '--score-limit', '1',
    '--max-ticks', '480',
    '--focus-bot-id', bot.id,
    '--roster-mode', 'mutable',
    '--reports-dir', evolveReportsDir,
    '--export-file', path.join(evolveReportsDir, 'exported-bots.js'),
    '--human-training-file', datasetFile
  ]);

  const evolveReport = JSON.parse(fs.readFileSync(path.join(evolveReportsDir, 'latest-evolution-report.json'), 'utf8'));
  assert(evolveReport.humanTrainingSummary && evolveReport.humanTrainingSummary.sessionCount === 1, 'Evolution report should include imported human training summary.');
  assert(
    Array.isArray(evolveReport.exportedBots) &&
    evolveReport.exportedBots.some((entry) => entry.id === bot.id && entry.humanTrainingSummary && typeof entry.humanChallengeScore === 'number'),
    'Exported bot report should surface human training metadata and challenge score.'
  );

  console.log('Human training importer and evolve integration tests passed.');
}

main();
