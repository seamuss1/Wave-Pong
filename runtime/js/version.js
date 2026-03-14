(function (root, version) {
  if (typeof module === 'object' && module.exports) {
    module.exports = version;
  }
  if (root) {
    root.WavePong = root.WavePong || {};
    root.WavePong.VERSION = version;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, '0.5.0');
