#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const humanTraining = require(path.join(repoRoot, 'tools', 'human-training.js'));

function parseArgs(argv) {
  const args = {
    input: null,
    output: path.join(repoRoot, 'tools', 'reports', 'human-training-data.json'),
    report: path.join(repoRoot, 'tools', 'reports', 'human-training-import-report.json'),
    maxSamplesPerBot: 4000
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input' && argv[i + 1]) args.input = path.resolve(argv[++i]);
    else if (arg === '--output' && argv[i + 1]) args.output = path.resolve(argv[++i]);
    else if (arg === '--report' && argv[i + 1]) args.report = path.resolve(argv[++i]);
    else if (arg === '--max-samples-per-bot' && argv[i + 1]) args.maxSamplesPerBot = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!args.input) throw new Error('Missing required --input path.');
  if (!fs.existsSync(args.input)) throw new Error(`Human training export does not exist: ${args.input}`);
  return args;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const incomingRaw = JSON.parse(fs.readFileSync(args.input, 'utf8'));
  const incoming = humanTraining.normalizeExportPayload(incomingRaw);
  const existing = humanTraining.loadDataset(args.output);
  const merged = humanTraining.mergeSessions(existing.sessions, incoming.sessions);
  const datasetBuild = humanTraining.buildImitationDatasetByBot(merged.sessions, {
    maxSamplesPerBot: args.maxSamplesPerBot
  });
  const summary = humanTraining.buildDatasetSummary(merged.sessions, datasetBuild.sampleCounts);
  const dataset = {
    schema: humanTraining.DATASET_SCHEMA,
    importedAt: new Date().toISOString(),
    sourceSchema: incoming.schema,
    sourceFile: args.input,
    sessions: merged.sessions,
    summary
  };

  writeJson(args.output, dataset);

  const report = {
    importedAt: dataset.importedAt,
    inputFile: args.input,
    outputFile: args.output,
    incomingSessionCount: incoming.sessions.length,
    duplicateSessionCount: merged.duplicateCount,
    totalSessionCount: merged.sessions.length,
    totalSampleCount: summary.totalSamples,
    byBot: summary.byBot,
    validations: datasetBuild.validations
  };
  writeJson(args.report, report);

  console.log(`Imported ${incoming.sessions.length} session(s) from ${args.input}`);
  console.log(`Merged dataset now contains ${merged.sessions.length} session(s) across ${summary.botCount} bot(s).`);
  console.log(`Normalized dataset written to ${args.output}`);
  console.log(`Import report written to ${args.report}`);
}

main();
