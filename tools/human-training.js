const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const sharedHumanTraining = require(path.join(repoRoot, 'runtime/js/human-training.js'));

function loadDataset(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return sharedHumanTraining.normalizeDatasetPayload(null);
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return sharedHumanTraining.normalizeDatasetPayload(raw);
}

module.exports = {
  ...sharedHumanTraining,
  loadDataset
};
