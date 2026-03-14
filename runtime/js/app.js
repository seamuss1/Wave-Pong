(() => {
  const ns = window.WavePong || {};
  const simCore = ns.SimCore;
  const controllers = ns.Controllers;
  const config = ns.CONFIG;
  const runtimeVersion = ns.VERSION;
  const botRoster = Array.isArray(ns.BOTS) ? ns.BOTS : [];

  if (!simCore) throw new Error('Wave Pong sim core missing. Load js/sim-core.js before js/app.js.');
  if (!controllers) throw new Error('Wave Pong controllers missing. Load js/controllers.js before js/app.js.');
  if (!config) throw new Error('Wave Pong config missing. Load js/config.js before js/app.js.');

  const runtime = simCore.createRuntime({
    document,
    window,
    config,
    runtimeVersion
  });

  function buildCpuController(difficulty) {
    const bot = controllers.selectBotForDifficulty(botRoster, difficulty);
    if (bot) {
      return controllers.createNeuralController(bot);
    }
    return controllers.createScriptedController({ difficulty });
  }

  function syncControllers() {
    const mode = runtime.ui.modeSelect ? runtime.ui.modeSelect.value : config.defaults.mode;
    const difficulty = runtime.ui.difficultySelect ? runtime.ui.difficultySelect.value : config.defaults.difficulty;
    if (mode === 'pvp') {
      runtime.setControllers({ left: null, right: null });
      return;
    }
    runtime.setControllers({
      left: null,
      right: buildCpuController(difficulty)
    });
  }

  ['change', 'input'].forEach((eventName) => {
    if (runtime.ui.modeSelect) runtime.ui.modeSelect.addEventListener(eventName, syncControllers);
    if (runtime.ui.difficultySelect) runtime.ui.difficultySelect.addEventListener(eventName, syncControllers);
  });

  syncControllers();
  runtime.mountBrowser();

  ns.RUNTIME = runtime;
})();
