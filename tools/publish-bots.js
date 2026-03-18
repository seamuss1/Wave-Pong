#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}.`);
    }
    args[key] = value;
    index += 1;
  }
  return args;
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function loadBots(sourcePath) {
  const resolvedSourcePath = path.resolve(sourcePath);
  delete require.cache[resolvedSourcePath];
  const exported = require(resolvedSourcePath);
  if (!Array.isArray(exported)) {
    throw new Error(`Expected ${resolvedSourcePath} to export an array of bots.`);
  }
  return exported;
}

function toRosterBots(bots, destinationPath) {
  const destinationName = path.basename(destinationPath);
  const publishedAt = new Date().toISOString();
  return bots.map((bot) => {
    const metadata = {
      ...(bot && typeof bot.metadata === 'object' && bot.metadata ? bot.metadata : {}),
      rosterStatus: 'published',
      rosterVersion: 1,
      source: destinationName,
      publishedAt
    };
    return {
      ...bot,
      metadata
    };
  });
}

function serializeRoster(bots) {
  const json = JSON.stringify(bots, null, 2);
  return [
    '(function (root) {',
    '  const bots = ' + json + ';',
    "  if (typeof module === 'object' && module.exports) {",
    '    module.exports = bots;',
    '  }',
    '  if (root) {',
    '    root.WavePong = root.WavePong || {};',
    '    root.WavePong.BOTS = bots;',
    '  }',
    "})(typeof globalThis !== 'undefined' ? globalThis : this);",
    ''
  ].join('\n');
}

function buildReport(bots, sourcePath, destinationPath) {
  return {
    createdAt: new Date().toISOString(),
    source: path.resolve(sourcePath),
    destination: path.resolve(destinationPath),
    publishedCount: bots.length,
    bots: bots.map((bot) => ({
      id: bot.id || null,
      name: bot.name || null,
      archetype: bot.archetype || null,
      difficultyBand: bot.difficultyBand || null,
      elo: Number.isFinite(bot.elo) ? bot.elo : null,
      promotionScore: Number.isFinite(bot.promotionScore) ? bot.promotionScore : null,
      selectedCandidateId: bot.selectedCandidateId || null,
      selectedCandidateGeneration: Number.isFinite(bot.selectedCandidateGeneration)
        ? bot.selectedCandidateGeneration
        : null,
      profileBlocked: !!bot.profileBlocked,
      reviewBlocked: !!bot.reviewBlocked
    }))
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.source || !args.destination) {
    throw new Error('Usage: node tools/publish-bots.js --source <exported-bots.js> --destination <runtime/js/bot-roster.js> [--report <report.json>]');
  }

  const bots = loadBots(args.source);
  const rosterBots = toRosterBots(bots, args.destination);
  const destinationContent = serializeRoster(rosterBots);

  ensureDir(args.destination);
  fs.writeFileSync(args.destination, destinationContent, 'utf8');

  if (args.report) {
    const report = buildReport(rosterBots, args.source, args.destination);
    ensureDir(args.report);
    fs.writeFileSync(args.report, JSON.stringify(report, null, 2) + '\n', 'utf8');
  }

  process.stdout.write(`Published ${rosterBots.length} bot(s) to ${path.resolve(args.destination)}.\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write((error && error.stack) ? `${error.stack}\n` : `${String(error)}\n`);
  process.exit(1);
}
