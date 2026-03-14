(function () {
  // Primary gameplay tuning surface. Change numbers here before touching js/app.js.
  const balance = {
    // Fixed internal game resolution. Rendering scales this to the browser window.
    canvas: {
      width: 1280,
      height: 720
    },
    // Base paddle placement and movement values.
    paddle: {
      leftX: 38, // X position for the left paddle.
      rightXOffset: 56, // Distance from the right edge used for the right paddle anchor.
      width: 18, // Paddle width in world units.
      height: 140, // Starting paddle height.
      speed: 920, // Base paddle movement speed.
      boundaryInset: 20 // Top/bottom playfield padding paddles cannot cross.
    },
    // Base ball size and launch envelope.
    ball: {
      radius: 11, // Collision/render radius.
      speedCap: 920, // Global maximum ball speed clamp.
      initialAngleBase: 0.48, // Minimum serve angle away from horizontal.
      initialAngleRange: 0.32 // Extra randomized serve angle range.
    },
    // Shared wave resource costs and recharge behavior.
    charge: {
      blueCost: 0.15, // Charge spent by the blue wave.
      pinkCost: 0.5, // Charge spent by the pink wave.
      goldCost: 1, // Charge spent by the gold wave.
      baseMax: 1, // Normal maximum charge bar value.
      overcapMax: 1.5, // Temporary maximum when Cap Bank is active.
      rechargeBasePerSecond: 0.152, // Passive recharge before level scaling.
      rechargePerLevelPerSecond: 0.0105, // Extra recharge gained per wave level.
      rapidMultiplier: 1.9 // Recharge multiplier while Rapid Charge is active.
    },
    // XP curve for leveling wave strength.
    waveLevels: {
      max: 6, // Maximum attainable wave level.
      xpThresholds: [0, 0, 180, 470, 930, 1520, 2250] // XP needed to reach each level index.
    },
    // XP gains and losses from major gameplay events.
    xp: {
      passivePerSecond: 2.15, // Passive XP drip per second.
      goal: 52, // XP gained for scoring a goal.
      opponentHit: 15, // XP gained by landing a gold wave on the opponent paddle.
      powerupSurge: 82, // XP granted by XP Surge.
      minion: 58, // XP granted by an XP Minion.
      debuffLoss: 76, // XP removed by XP Drain.
      goldHitLoss: 34 // XP removed from a paddle hit by a strong gold wave.
    },
    // How paddle motion influences aiming and jam behavior.
    waveAim: {
      tiltScale: 1.04, // Max aim tilt produced by paddle movement.
      smoothing: 10, // Interpolation speed for moving toward target aim.
      jamFireLockSeconds: 0.1, // Minimum jam time that blocks firing.
      jamWobbleSpeed: 0.04, // Aim wobble speed while jammed.
      jamWobbleAmplitude: 0.16 // Aim wobble strength while jammed.
    },
    // Per-wave-type stats. These values feed directly into getPulseStats in js/app.js.
    waves: {
      blue: {
        thicknessBase: 24, // Starting visual width.
        thicknessPerLevel: 1.9, // Width gained per level.
        rangeBase: 210, // Base travel range.
        rangeChargeScale: 118, // Extra range from available charge.
        rangePerLevel: 12, // Extra range per level.
        strengthBase: 118, // Base force applied to balls.
        strengthChargeScale: 42, // Extra force from available charge.
        strengthPerLevel: 7, // Extra force per level.
        coneBase: 0.84, // Base spread arc.
        coneChargeScale: 0.09, // Extra spread from available charge.
        conePerLevel: 0.014, // Extra spread per level.
        cooldown: 0.03, // Post-fire cooldown.
        lifeBase: 0.18, // Minimum pulse lifetime.
        lifeChargeScale: 0.04, // Lifetime added by available charge.
        color: '#7bd2ff', // Primary render color.
        glow: '#7bd2ff', // Glow color.
        fill: 'rgba(123, 210, 255, 0.1)' // Arc fill color.
      },
      pink: {
        thicknessBase: 32, // Starting visual width.
        thicknessPerLevel: 2.4, // Width gained per level.
        rangeBase: 208, // Base travel range.
        rangePerLevel: 10, // Extra range per level.
        rangeChargeScale: 42, // Extra range from charge above the pink threshold.
        strengthBase: 138, // Base defensive force.
        strengthPerLevel: 7, // Extra force per level.
        strengthChargeScale: 18, // Extra force from current charge.
        coneBase: 0.86, // Base spread arc.
        conePerLevel: 0.018, // Extra spread per level.
        cooldown: 0.052, // Post-fire cooldown.
        lifeBase: 0.29, // Minimum pulse lifetime.
        lifeBonusBase: 0.04, // Starting bonus lifetime once pink is unlocked.
        lifeBonusCap: 0.08, // Maximum additional lifetime from charge.
        lifeChargeScale: 0.08, // Rate that extra charge adds lifetime.
        color: '#ff7cd7', // Primary render color.
        glow: '#ffb3ec', // Glow color.
        fill: 'rgba(255, 124, 215, 0.17)' // Arc fill color.
      },
      gold: {
        thicknessBase: 92, // Starting visual width.
        thicknessPerLevel: 6.2, // Width gained per level.
        strengthBase: 206, // Base force applied to targets.
        strengthPerLevel: 15, // Extra force per level.
        coneBase: 0.46, // Base spread arc.
        conePerLevel: 0.012, // Extra spread per level.
        cooldown: 0.07, // Post-fire cooldown.
        life: 7, // Lifetime of the traveling gold arc.
        speedBase: 952, // Base travel speed.
        speedPerLevel: 10, // Extra travel speed per level.
        arcRadiusBase: 82, // Starting gold arc radius.
        arcRadiusPerLevel: 8.2, // Extra arc radius per level.
        color: '#ffd34d', // Primary render color.
        glow: '#ffe68c', // Glow color.
        fill: 'rgba(255, 211, 77, 0.22)' // Arc fill color.
      }
    },
    // Long-rally multiball escalation.
    rally: {
      initialSpawnAtSeconds: 13.2, // Earliest time/rally checkpoint for the first extra ball.
      thresholdBase: 15, // Base rally length needed before extra-ball checks.
      thresholdPerExtraBall: 6, // Extra rally requirement per current additional ball.
      repeatDelayBaseSeconds: 8.4, // Delay before the next long-rally spawn check.
      repeatDelayPerBallSeconds: 1.8, // Additional delay per ball already on the field.
      stopAddingAtBallCount: 4, // Hard limit after which rally spawns stop.
      cloneVxScale: -0.9, // Horizontal velocity multiplier for spawned rally clones.
      cloneVyScale: 0.92, // Vertical velocity multiplier for spawned rally clones.
      cloneMinVy: 220, // Minimum vertical speed for spawned rally clones.
      cloneCapMultiplier: 0.96 // Speed cap multiplier applied to rally clones.
    },
    // Powerup spawn timing and per-effect values.
    powerups: {
      spawn: {
        initialDelayBaseSeconds: 4.8, // Base delay before the first spawn in a fresh match.
        initialDelayRandomSeconds: 2.2, // Random extra delay added to the first spawn.
        repeatDelayBaseSeconds: 3.8, // Base delay between later spawns.
        repeatDelayRandomSeconds: 2.1, // Random extra delay between later spawns.
        maxOnField: 3, // Maximum simultaneous pickups/minions.
        minionChance: 0.56, // Chance that a spawn is an XP Minion instead of a powerup.
        xStartRatio: 0.3, // Left spawn boundary as a percentage of arena width.
        xSpanRatio: 0.4, // Width of the horizontal spawn band as a percentage.
        yPadding: 78, // Top padding for spawn placement.
        ySpanPadding: 156, // Total top+bottom padding removed from vertical spawn range.
        minionRadius: 16, // Collision radius for minions.
        standardRadius: 18, // Collision radius for normal powerups.
        minionLifeSeconds: 12.5, // Lifetime before an unclaimed minion despawns.
        standardLifeSeconds: 11 // Lifetime before an unclaimed powerup despawns.
      },
      pool: ['grow', 'overcharge', 'capacitor', 'rapid', 'multi', 'pulse', 'shrink', 'slow', 'jam', 'drain'], // Random selection pool when a non-minion spawn occurs.
      effects: {
        growHeightBonus: 34, // Extra paddle height from Mega Paddle.
        growMaxHeight: 210, // Upper limit for Mega Paddle growth.
        growDurationSeconds: 6.4, // Mega Paddle duration.
        overchargeCooldownFloor: 0.02, // Minimum cooldown left after Overcharge.
        capacitorDurationSeconds: 8.5, // Cap Bank duration.
        capacitorChargeBonus: 0.35, // Immediate charge granted by Cap Bank.
        rapidDurationSeconds: 7.4, // Rapid Charge duration.
        rapidChargeBonus: 0.16, // Immediate charge granted by Rapid Charge.
        multiMaxBalls: 5, // Hard limit for Multiball-created ball count.
        multiCloneVxScale: -0.9, // Horizontal velocity multiplier for Multiball clones.
        multiCloneVyScale: -0.88, // Vertical velocity multiplier for Multiball clones.
        multiCloneCapMultiplier: 0.92, // Speed cap multiplier for Multiball clones.
        shrinkHeightPenalty: 26, // Height removed by Shrink Hex.
        shrinkMinHeight: 92, // Minimum paddle height after shrinking.
        shrinkDurationSeconds: 5.8, // Shrink Hex duration.
        slowDurationSeconds: 3.8, // Drag Field duration.
        jamDurationSeconds: 3.1, // Aim Jam duration.
        drainChargeLoss: 0.34 // Charge removed by XP Drain.
      }
    },
    // How direct paddle hits reshape the ball when a paddle already has charge.
    paddleHit: {
      speedScale: 1.028, // Base speed multiplier on a paddle hit.
      speedBonus: 22, // Flat speed added on a paddle hit.
      angleScale: 1.05, // Maximum deflection angle from vertical offset.
      carryVyScale: 0.16, // How much paddle movement adds vertical speed.
      fullChargeCapMultiplier: 0.98, // Speed cap multiplier for full-charge paddle hits.
      fullChargeSpeedScale: 0.98, // Multiplier on incoming speed for full-charge hits.
      fullChargeBaseSpeed: 620, // Minimum full-charge hit speed.
      fullChargeSpeedPerLevel: 16, // Full-charge speed gained per level.
      fullChargeOffsetScale: 0.7, // Vertical offset influence on full-charge hits.
      fullChargeAimInfluence: 0.14, // Aim angle influence on full-charge hits.
      fullChargeClamp: 0.92, // Clamp applied to full-charge hit angles.
      fullChargeCarryVyScale: 0.12, // Paddle movement carryover on full-charge hits.
      fullChargeAimKick: 18, // Extra vertical kick from aim angle on full-charge hits.
      defensiveCapMultiplier: 0.88, // Speed cap multiplier for pink-charged paddle hits.
      defensiveBaseSpeed: 500, // Minimum pink-charged hit speed.
      defensiveSpeedPerLevel: 12, // Pink-charged speed gained per level.
      defensiveSpeedScale: 0.94, // Multiplier on incoming speed for pink-charged hits.
      defensiveOffsetScale: 0.62, // Vertical offset influence on pink-charged hits.
      defensiveAimInfluence: 0.1, // Aim angle influence on pink-charged hits.
      defensiveClamp: 0.82, // Clamp applied to pink-charged hit angles.
      defensiveCarryVyScale: 0.1 // Paddle movement carryover on pink-charged hits.
    }
  };

  // High-level configuration used by js/app.js.
  const config = {
    // Browser storage keys for persistent stats.
    storage: {
      historyKey: 'gameWavePongHistoryV3',
      bestRallyKey: 'gameWavePongBestRally'
    },
    // Values used to seed the menu and startup experience.
    defaults: {
      mode: 'cpu',
      difficulty: 'spicy',
      scoreLimit: 7,
      theme: 'neon',
      powerupsEnabled: true,
      trailsEnabled: true,
      startupMessage: 'Open the match menu and unleash the rectangles.',
      startupMessageSeconds: 2.1
    },
    balance, // Gameplay tuning numbers.
    // Shape of the persistent history record saved in localStorage.
    defaultHistory: {
      matches: 0,
      leftWins: 0,
      rightWins: 0,
      leftPoints: 0,
      rightPoints: 0,
      leftBallHits: 0,
      rightBallHits: 0,
      leftShots: 0,
      rightShots: 0,
      leftWaveHits: 0,
      rightWaveHits: 0,
      leftPowerups: 0,
      rightPowerups: 0,
      bestRally: 0,
      lastWinner: 'None'
    },
    // Powerup presentation definitions.
    // icon: glyph shown in menus/HUD, label: UI text, kind: style bucket, color/fill/outline: render colors.
    powerupDefs: {
      grow: { icon: '\u21D5', label: 'Mega Paddle', kind: 'buff', color: '#86ffb1', fill: 'rgba(134, 255, 177, 0.22)', outline: 'rgba(134, 255, 177, 0.82)' },
      overcharge: { icon: '\u26A1', label: 'Overcharge', kind: 'buff', color: '#71f1ff', fill: 'rgba(113, 241, 255, 0.22)', outline: 'rgba(113, 241, 255, 0.82)' },
      capacitor: { icon: '\u25B0', label: 'Cap Bank', kind: 'buff', color: '#78f0ff', fill: 'rgba(120, 240, 255, 0.22)', outline: 'rgba(120, 240, 255, 0.84)' },
      rapid: { icon: '\u226B', label: 'Rapid Charge', kind: 'buff', color: '#fff085', fill: 'rgba(255, 240, 133, 0.22)', outline: 'rgba(255, 240, 133, 0.84)' },
      multi: { icon: '\u25CE', label: 'Multiball', kind: 'buff', color: '#ffd06e', fill: 'rgba(255, 208, 110, 0.22)', outline: 'rgba(255, 208, 110, 0.82)' },
      pulse: { icon: '\u27F2', label: 'XP Surge', kind: 'buff', color: '#a7b6ff', fill: 'rgba(167, 182, 255, 0.22)', outline: 'rgba(167, 182, 255, 0.82)' },
      shrink: { icon: '\u21E3', label: 'Shrink Hex', kind: 'debuff', color: '#ff88c6', fill: 'rgba(255, 136, 198, 0.22)', outline: 'rgba(255, 136, 198, 0.82)' },
      slow: { icon: '\u231B', label: 'Drag Field', kind: 'debuff', color: '#ff9d7e', fill: 'rgba(255, 157, 126, 0.22)', outline: 'rgba(255, 157, 126, 0.82)' },
      jam: { icon: '\u2736', label: 'Aim Jam', kind: 'debuff', color: '#ff6a8b', fill: 'rgba(255, 106, 139, 0.22)', outline: 'rgba(255, 106, 139, 0.82)' },
      drain: { icon: '\u25CC', label: 'XP Drain', kind: 'debuff', color: '#ffb7ff', fill: 'rgba(255, 183, 255, 0.2)', outline: 'rgba(255, 183, 255, 0.82)' },
      minion: { icon: '\u2739', label: 'XP Minion', kind: 'minion', color: '#8dff7f', fill: 'rgba(141, 255, 127, 0.18)', outline: 'rgba(141, 255, 127, 0.88)' }
    },
    // Randomized game-over subtitles.
    wittyLines: [
      'That rally had better footwork than most office meetings.',
      'Your paddle is either a genius or deeply confused.',
      'The ball would like a word with your defensive strategy.',
      'This is less pong and more geometric drama.',
      'One more point like that and the pixels unionize.',
      'Somewhere, a very small commentator is losing composure.',
      'The right paddle claims it lagged. Investigations continue.',
      'The left paddle just posted that highlight to its story.',
      'That was not a miss. That was an interpretive choice.',
      'The ball has entered its villain era.'
    ],
    // Randomized point-scored callouts.
    scoreLines: [
      'Clinical finish.',
      'That point had paperwork and witnesses.',
      'An absolute robbery at the netless court.',
      'Some rectangles simply want it more.',
      'The ball filed a change of address.',
      'The crowd goes polite but sustained.',
      'That one had a sequel budget.',
      'A point so clean it squeaks.'
    ],
    // Theme color palettes used by CSS variables and canvas rendering.
    themes: {
      neon: {
        bgTop: '#07111f',
        bgBottom: '#02060d',
        glowA: '102, 227, 255',
        glowB: '166, 107, 255',
        accent: '#66e3ff',
        accent2: '#a66bff',
        paddleLeft: '#66e3ff',
        paddleRight: '#ff8ad8',
        ball: '#ffffff',
        power: '#ffd06e'
      },
      ember: {
        bgTop: '#1d0b09',
        bgBottom: '#0c0605',
        glowA: '255, 132, 74',
        glowB: '255, 226, 92',
        accent: '#ff844a',
        accent2: '#ffe25c',
        paddleLeft: '#ff844a',
        paddleRight: '#ffd06e',
        ball: '#fff8eb',
        power: '#fff27d'
      },
      mint: {
        bgTop: '#061915',
        bgBottom: '#030907',
        glowA: '116, 255, 204',
        glowB: '111, 207, 255',
        accent: '#74ffcc',
        accent2: '#6fcfff',
        paddleLeft: '#74ffcc',
        paddleRight: '#6fcfff',
        ball: '#f4fffd',
        power: '#ffe18b'
      }
    },
    // AI tuning and base ball serve speed per difficulty.
    difficultyMap: {
      chill: { aiSpeed: 740, aiError: 92, reaction: 0.12, ballSpeed: 600 },
      spicy: { aiSpeed: 950, aiError: 36, reaction: 0.22, ballSpeed: 690 },
      absurd: { aiSpeed: 1210, aiError: 14, reaction: 0.32, ballSpeed: 770 }
    }
  };

  window.WavePong = window.WavePong || {};
  window.WavePong.CONFIG = config;
})();
