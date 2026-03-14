#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {
    source: path.join(repoRoot, 'runtime', 'js', 'bot-roster.js'),
    destination: path.join(repoRoot, 'runtime', 'js', 'bot-roster.js'),
    report: path.join(repoRoot, 'tools', 'reports', 'pruned-bot-roster-report.json'),
    keepIds: [],
    deleteIds: []
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--source' && argv[i + 1]) args.source = path.resolve(argv[++i]);
    else if (arg === '--destination' && argv[i + 1]) args.destination = path.resolve(argv[++i]);
    else if (arg === '--report' && argv[i + 1]) args.report = path.resolve(argv[++i]);
    else if (arg === '--keep-id' && argv[i + 1]) args.keepIds.push(String(argv[++i]));
    else if (arg === '--delete-id' && argv[i + 1]) args.deleteIds.push(String(argv[++i]));
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!args.keepIds.length && !args.deleteIds.length) {
    throw new Error('Provide at least one --keep-id or --delete-id.');
  }

  return args;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function loadModule(filePath) {
  delete require.cache[require.resolve(filePath)];
  return require(filePath);
}

function writeBotsScript(filePath, globalName, bots) {
  const payload = JSON.stringify(bots, null, 2);
  const script = `(function (root) {\n  const bots = ${payload};\n  if (typeof module === 'object' && module.exports) {\n    module.exports = bots;\n  }\n  if (root) {\n    root.WavePong = root.WavePong || {};\n    root.WavePong.${globalName} = bots;\n  }\n})(typeof globalThis !== 'undefined' ? globalThis : this);\n`;
  fs.writeFileSync(filePath, script, 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.source)) {
    throw new Error(`Roster source not found: ${args.source}`);
  }

  const roster = loadModule(args.source);
  if (!Array.isArray(roster)) {
    throw new Error(`Roster source did not export an array: ${args.source}`);
  }

  const keepSet = new Set(args.keepIds);
  const deleteSet = new Set(args.deleteIds);
  const originalIds = new Set(roster.map((bot) => bot.id));

  const nextRoster = roster.filter((bot) => {
    if (keepSet.size > 0) return keepSet.has(bot.id);
    return !deleteSet.has(bot.id);
  });

  const removedBots = roster
    .filter((bot) => !nextRoster.some((keptBot) => keptBot.id === bot.id))
    .map((bot) => ({
      id: bot.id,
      name: bot.name,
      elo: bot.elo,
      archetype: bot.archetype,
      difficultyBand: bot.difficultyBand
    }));

  const missingKeepIds = args.keepIds.filter((id) => !originalIds.has(id));
  const missingDeleteIds = args.deleteIds.filter((id) => !originalIds.has(id));

  ensureDir(path.dirname(args.destination));
  ensureDir(path.dirname(args.report));
  writeBotsScript(args.destination, 'BOT_ROSTER', nextRoster);
  fs.writeFileSync(args.report, JSON.stringify({
    createdAt: new Date().toISOString(),
    source: args.source,
    destination: args.destination,
    rosterCountBefore: roster.length,
    rosterCountAfter: nextRoster.length,
    keepIds: args.keepIds,
    deleteIds: args.deleteIds,
    missingKeepIds,
    missingDeleteIds,
    removedBots,
    remainingBots: nextRoster.map((bot) => ({
      id: bot.id,
      name: bot.name,
      elo: bot.elo,
      archetype: bot.archetype,
      difficultyBand: bot.difficultyBand
    }))
  }, null, 2), 'utf8');

  console.log(`Roster prune complete: ${roster.length} -> ${nextRoster.length} bot(s) in ${args.destination}`);
  if (missingKeepIds.length) console.log(`Missing keep ids: ${missingKeepIds.join(', ')}`);
  if (missingDeleteIds.length) console.log(`Missing delete ids: ${missingDeleteIds.join(', ')}`);
  if (removedBots.length) console.log(`Removed ${removedBots.length} bot(s).`);
}

main();
