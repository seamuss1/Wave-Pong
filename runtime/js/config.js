(function (root, factory) {
  const config = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = config;
  }
  if (root) {
    root.WavePong = root.WavePong || {};
    root.WavePong.CONFIG = config;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
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
      boost: {
        overCapDecayPerSecond: 220, // How quickly an over-speed ball settles back down toward the normal cap after a temporary boost ends.
        accelerationPerLog2Unit: 32 // Extra ball speed gained per second for each log2 unit of boost intensity while a boost timer is active.
      },
      initialAngleBase: 0.70, // Minimum serve angle away from horizontal.
      initialAngleRange: 0.10 // Extra randomized serve angle range.
    },
    // Shared wave resource costs and recharge behavior.
    charge: {
      blueCost: 0.1, // Charge spent by the blue wave.
      pinkCost: 0.5, // Charge spent by the pink wave.
      goldCost: 0.9, // Charge spent by the gold wave.
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
    // Paddle movement and debuff feel.
    paddleControl: {
      jamMoveBase: 0.56, // Base movement multiplier while jammed.
      jamMoveOscillationAmplitude: 0.08, // Extra wobble added to jammed movement speed.
      jamMoveOscillationSpeed: 0.03, // Oscillation speed used for jammed movement wobble.
      jamMovePhaseOffset: 2.2, // Right-side phase offset for jammed movement wobble.
      slowMoveMultiplier: 0.62, // Movement multiplier while Drag Field is active.
      velocitySmoothing: 18, // How quickly paddle velocity moves toward player/AI input.
      sizeRecoveryRate: 1.8 // How quickly grow/shrink effects ease back toward base size.
    },
    // CPU aiming and firing heuristics.
    ai: {
      targetLeadMax: 0.85, // Maximum prediction lead based on target distance.
      targetLeadReactionBase: 0.25, // Base factor applied to predicted ball travel.
      jitterSpeed: 0.002, // Speed of the AI tracking jitter wave.
      deadbandBase: 8, // Minimum no-move zone around the target centerline.
      deadbandErrorScale: 0.08, // Extra deadband gained from AI error.
      fireJamThresholdSeconds: 0.08, // Jam threshold below which the AI is allowed to fire.
      fireWindowTowardMultiplier: 0.95, // Range multiplier when firing at balls moving toward the AI paddle.
      fireWindowAwayMultiplier: 0.7, // Range multiplier when firing at balls moving away from the AI paddle.
      pushAngleWindow: 0.24, // Allowed aim error for gold-wave shots.
      solidAngleWindowMultiplier: 0.72, // Allowed aim error multiplier for pink-wave shots.
      waveAngleWindowMultiplier: 0.8, // Allowed aim error multiplier for blue-wave shots.
      pushFireChanceBase: 0.24, // Base per-check gold-wave fire chance.
      pushFireChanceReactionScale: 0.45, // Extra gold-wave fire chance from AI reaction.
      towardFireChanceBase: 0.52, // Base per-check fire chance for incoming balls on blue/pink shots.
      towardFireChanceReactionScale: 0.8, // Extra incoming-ball fire chance from AI reaction.
      awayFireChance: 0.18, // Per-check fire chance for balls moving away from the AI paddle.
      fireCheckRate: 14 // Number of chance checks per second for AI firing.
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
        lifeBase: 0.35, // Minimum pulse lifetime.
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
    // Blue-wave-only ball interaction tuning: sweet spot force, away boost, toward stun, and gold resistance.
    blueWaveInteraction: {
      velocityThreshold: 30, // Minimum horizontal speed used to classify a ball as moving toward or away from the paddle.
      sweetSpotExponent: 1.55, // Higher values make the blue-wave center sweet spot narrower.
      aimBlendBase: 0.16, // Base blend between "push away from contact point" and "push along aim angle".
      aimBlendSweetScale: 0.38, // Extra aim blend gained from a strong center hit.
      forceMultiplierBase: 0.7, // Baseline multiplier applied to blue-wave strength.
      forceMultiplierSweetScale: 0.52, // Extra force gained from a strong center hit.
      away: {
        speedCapMultiplier: 1.06, // Ball speed cap used for away-moving blue hits before the temporary boost acceleration takes over.
        speedScaleBase: 1.14, // Baseline outgoing speed multiplier on away-moving hits.
        speedScaleSweetScale: 0.12, // Extra outgoing speed gained from a strong center hit.
        baseSpeed: 700, // Minimum outgoing speed for away-moving hits.
        speedPerLevel: 14, // Extra minimum speed gained per wave level.
        speedSweetScale: 84, // Extra minimum speed gained from a strong center hit.
        directionCarryBase: 0.72, // How much the ball keeps its current direction on away-moving hits.
        directionCarrySweetScale: 0.05, // Amount of current-direction carry removed by a strong center hit.
        aimInfluenceBase: 0.28, // How much the paddle aim influences away-moving hits.
        aimInfluenceSweetScale: 0.1, // Extra aim influence gained from a strong center hit.
        boostDurationBase: 0.95, // Base boost duration applied to away-moving hits.
        boostDurationSweetScale: 0.24, // Extra boost duration from a strong center hit.
        boostIntensityBase: 72, // Base boost intensity applied to away-moving hits. Drives both the visual streak strength and the temporary speed acceleration.
        boostIntensitySweetScale: 18, // Extra boost intensity from a strong center hit.
        boostMaxSpeedCapMultiplier: 1.32, // Maximum fraction of the global ball speed cap the blue boost is allowed to sustain while the boost timer is active.
        resistSweetThreshold: 0.72, // Sweet-spot threshold required to grant blue resistance against gold waves.
        resistDurationBase: 1.2, // Base blue-resistance duration on strong away-moving hits.
        resistDurationSweetScale: 0.35, // Extra blue-resistance duration from a strong center hit.
        resistStrengthBase: 0.55, // Base blue-resistance strength on strong away-moving hits.
        resistStrengthSweetScale: 0.22 // Extra blue-resistance strength from a strong center hit.
      },
      toward: {
        stunDurationBase: 0.06, // Base stun duration on toward-moving blue hits.
        stunDurationSweetScale: 0.07, // Extra stun duration from a strong center hit.
        feedbackBoostMinDuration: 0.08, // Minimum visual boost marker duration applied during stun.
        feedbackBoostDurationScale: 0.9, // Stun duration multiplier used to derive the visual boost marker duration.
        feedbackBoostIntensity: 0.72 // Visual boost marker intensity applied during stun.
      },
      resistVsGold: {
        influenceBase: 0.62, // Base fraction of a gold wave's effect that still gets through when blue resistance is active.
        missingStrengthScale: 0.18, // Extra gold influence recovered when blue resistance strength is weak.
        minInfluence: 0.56, // Lower clamp for gold influence while blue resistance is active.
        maxInfluence: 0.8, // Upper clamp for gold influence while blue resistance is active.
        defaultStrength: 0.55 // Fallback blue-resistance strength when a timer exists without an explicit stored strength.
      }
    },
    // Pink-wave-only ball interaction tuning.
    pinkWaveInteraction: {
      endpointLinger: {
        durationSeconds: 0.08, // Extra time a fully extended pink wave stays active at max range and can still deflect balls.
        visualAlphaMultiplier: 0.42 // Opacity multiplier used while the pink wave is lingering at its endpoint.
      },
      ballHit: {
        offsetRangeMin: 46, // Minimum vertical range used when normalizing a pink-wave hit offset.
        offsetRangeRadiusScale: 0.5, // Portion of current pink radius used when normalizing hit offset.
        speedCapMultiplier: 0.88, // Ball speed cap used for pink-wave hits.
        baseSpeed: 500, // Minimum speed for pink-wave hits.
        speedPerLevel: 10, // Extra minimum speed gained per wave level.
        incomingSpeedScale: 0.95, // Multiplier on incoming ball speed for pink-wave hits.
        incomingSpeedFlatBonus: 26, // Flat speed added after incoming-speed scaling.
        angleOffsetScale: 0.42, // Vertical hit offset influence on outgoing angle.
        aimInfluence: 0.08, // Paddle aim influence on outgoing pink-wave angle.
        angleClamp: 0.6, // Clamp applied to pink-wave outgoing angle.
        aimVerticalKick: 10 // Extra vertical velocity added from paddle aim.
      }
    },
    // Gold-wave-only interaction tuning: center sweet spot, paddle disruption, and post-hit growth.
    goldWaveInteraction: {
      paddleHit: {
        nudgeMax: 230, // Maximum vertical displacement force applied to a paddle struck by the gold wave.
        velocityScale: 20, // Multiplier used when converting paddle nudge into paddle vertical velocity.
        hitScale: 1.26, // Temporary paddle squash/stretch scale when the gold wave lands.
        slowDurationSeconds: 1.85, // Slow duration applied to a paddle struck by the gold wave.
        chargeCeilingOffset: 0.02 // Amount below pink-ready charge that a struck paddle gets clamped to.
      },
      ballHit: {
        sweetSpotExponent: 1.7, // Higher values make the gold-wave center sweet spot narrower.
        centerSweetThreshold: 0.74, // Sweet-spot threshold that triggers the strongest center-hit behavior.
        center: {
          speedCapMultiplier: 0.97, // Ball speed cap used for strong center hits.
          incomingSpeedScale: 1.02, // Multiplier on incoming ball speed for strong center hits.
          baseSpeed: 600, // Minimum speed for strong center hits.
          speedPerLevel: 12, // Extra minimum speed gained per wave level on strong center hits.
          speedSweetScale: 42, // Extra minimum speed gained from a stronger center hit.
          angleOffsetScale: 0.1, // Vertical impact offset influence on the outgoing angle of a center hit.
          boostDurationBase: 0.46, // Base boost duration applied to a strong center hit.
          boostDurationInfluenceScale: 0.12, // Extra boost duration gained from reduced gold influence.
          boostIntensity: 0.9, // Boost intensity applied to a strong center hit. Drives both the visual streak strength and the temporary speed acceleration.
          boostMaxSpeedCapMultiplier: 1.08 // Maximum fraction of the global ball speed cap the gold center-hit boost is allowed to sustain while the boost timer is active.
        },
        glancing: {
          speedGateCapMultiplier: 0.92, // Incoming-speed threshold for using the glancing-hit branch instead of the nudge branch.
          speedCapMultiplier: 0.91, // Ball speed cap used for glancing hits.
          baseSpeed: 498, // Minimum speed for glancing hits.
          speedPerLevel: 11, // Extra minimum speed gained per wave level on glancing hits.
          incomingSpeedScale: 0.982, // Multiplier on incoming speed for glancing hits.
          incomingSpeedFlatBonus: 8, // Flat speed added before sweet-spot scaling on glancing hits.
          speedSweetScale: 18, // Extra minimum speed gained from a stronger center hit on glancing hits.
          angleOffsetBase: 0.68, // Base vertical offset influence on glancing-hit angle.
          angleOffsetSweetReduction: 0.16, // Amount of vertical offset influence removed by a stronger center hit.
          aimInfluenceBase: 0.12, // Base aim-angle influence on glancing-hit angle.
          aimInfluenceSweetScale: 0.14, // Extra aim-angle influence gained from a stronger center hit.
          angleClamp: 0.9, // Clamp applied to the glancing-hit angle.
          vyAimBase: 14, // Base vertical velocity added from paddle aim on glancing hits.
          vyAimSweetScale: 12, // Extra vertical aim contribution gained from a stronger center hit.
          vyOffsetBase: 18, // Base vertical velocity added from impact offset on glancing hits.
          vyOffsetSweetReduction: 5 // Amount of impact-offset vertical contribution removed by a stronger center hit.
        },
        nudge: {
          base: 20, // Base nudge force when the ball is already too fast for the glancing-hit branch.
          perLevel: 2.6, // Extra nudge force gained per wave level.
          sweetScale: 26, // Extra nudge force gained from a stronger center hit.
          yScale: 0.8, // Fraction of nudge force converted into vertical velocity along the wave angle.
          offsetScale: 12 // Extra vertical velocity contributed by impact offset.
        },
        growth: {
          arcRadiusPerHit: 1.6, // Arc radius gained every time the gold wave hits a ball.
          thicknessPerHit: 0.75, // Render thickness gained every time the gold wave hits a ball.
          maxThickness: 150 // Maximum render thickness after repeated hits.
        }
      }
    },
    // Long-rally multiball escalation.
    rally: {
      initialSpawnAtSeconds: 10, // Earliest time/rally checkpoint for the first extra ball.
      thresholdBase: 5, // Base rally length needed before extra-ball checks.
      thresholdPerExtraBall: 6, // Extra rally requirement per current additional ball.
      repeatDelayBaseSeconds: 6, // Delay before the next long-rally spawn check.
      repeatDelayPerBallSeconds: 1.8, // Additional delay per ball already on the field.
      stopAddingAtBallCount: 4, // Hard limit after which rally spawns stop.
      cloneVxScale: -0.9, // Horizontal velocity multiplier for spawned rally clones.
      cloneVyScale: 0.92, // Vertical velocity multiplier for spawned rally clones.
      cloneMinVy: 220, // Minimum vertical speed for spawned rally clones.
      cloneCapMultiplier: 0.96 // Speed cap multiplier applied to rally clones.
    },
    // Match flow toggles that change when new balls are introduced.
    matchFlow: {
      alwaysSpawnReplacementAfterGoal: false, // When true, every goal immediately serves a fresh ball even if others are still active.
      countdownSeconds: 3, // Countdown duration before play begins on match start and after resuming from pause.
      serveHoldSeconds: 0.75, // How long a newly served ball waits at center before it can move.
      serveHoldPulseHz: 2.6, // Pulse rate for the glow wrapped around a held serve ball.
      serveHoldGlowRadius: 18, // Extra radius used by the held-ball glow halo.
      goalLight: {
        durationSeconds: 0.28, // Lifetime of the horizontal goal-entry light pillar.
        length: 228, // How far the goal-entry light stretches into the court.
        thickness: 28, // Base width of the goal-entry light.
        originInset: 18 // Horizontal inset used to anchor the goal-entry light just inside the court border.
      },
      preview: {
        arrowMinLength: 42, // Minimum ghost-arrow length shown while play is stopped.
        arrowMaxLength: 118, // Maximum ghost-arrow length shown while play is stopped.
        arrowHeadLength: 16, // Arrowhead size for the stopped-play trajectory preview.
        alpha: 0.42 // Base opacity of the ghost-arrow preview while play is stopped.
      }
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
    },
    // Canonical multiplayer and competitive configuration shared by browser and backend.
    multiplayer: {
      regions: {
        na: { id: 'na', label: 'North America', matchHostRegion: 'iad', strictRegionLock: true },
        eu: { id: 'eu', label: 'Europe', matchHostRegion: 'ams', strictRegionLock: true }
      },
      netcode: {
        serverTickRate: 120,
        inputBufferTicks: 4,
        rollbackWindowTicks: 16,
        snapshotRateHz: 24,
        maxInputBatchFrames: 12
      },
      reconnect: {
        snapshotRingSeconds: 10,
        graceSeconds: 30,
        rankedForfeitSeconds: 15
      },
      auth: {
        guestDisplayNamePrefix: 'Guest',
        accessTokenTtlSeconds: 60 * 20,
        refreshTokenTtlSeconds: 60 * 60 * 24 * 30
      },
      moderation: {
        lobbyMessageMaxLength: 280,
        matchMessageMaxLength: 140,
        duplicateWindowSeconds: 12,
        duplicateLimit: 3,
        lobbyRateLimitBurst: 4,
        lobbyRateLimitWindowSeconds: 8,
        quickChatRateLimitBurst: 4,
        quickChatRateLimitWindowSeconds: 4,
        profanityFilterEnabled: true,
        urlFilterEnabled: true
      },
      seasons: {
        seasonLengthWeeks: 8,
        placementMatches: 5,
        visibleDivisions: ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master'],
        softResetFactor: 0.35
      },
      antiCheat: {
        maxClockSkewTicks: 6,
        maxFutureInputTicks: 24,
        versionMismatchBlocksRanked: true,
        impossibleInputAuditEnabled: true,
        replayAuditEnabled: true
      },
      quickChat: [
        { id: 'gg', label: 'GG' },
        { id: 'nice', label: 'Nice shot' },
        { id: 'close', label: 'Close one' },
        { id: 'rematch', label: 'Rematch?' },
        { id: 'lag', label: 'Lag spike' },
        { id: 'ready', label: 'Ready' }
      ],
      playlists: {
        ranked_duel: {
          id: 'ranked_duel',
          label: 'Ranked Duel',
          queueLabel: 'Ranked',
          modeLabel: 'RANKED ONLINE',
          requireVerifiedAccount: true,
          strictRegionLock: true,
          rated: true,
          scoreLimit: 11,
          mode: 'pvp',
          powerupsEnabled: false,
          longRallyMultiballEnabled: false,
          trailsEnabled: true,
          theme: 'neon',
          fullReplayRetention: true,
          matchChatMode: 'quick'
        },
        unranked_standard: {
          id: 'unranked_standard',
          label: 'Unranked Standard',
          queueLabel: 'Standard',
          modeLabel: 'ONLINE STANDARD',
          requireVerifiedAccount: false,
          strictRegionLock: true,
          rated: false,
          scoreLimit: 11,
          mode: 'pvp',
          powerupsEnabled: false,
          longRallyMultiballEnabled: false,
          trailsEnabled: true,
          theme: 'neon',
          fullReplayRetention: false,
          matchChatMode: 'free'
        },
        unranked_chaos: {
          id: 'unranked_chaos',
          label: 'Unranked Chaos',
          queueLabel: 'Chaos',
          modeLabel: 'ONLINE CHAOS',
          requireVerifiedAccount: false,
          strictRegionLock: false,
          rated: false,
          scoreLimit: 7,
          mode: 'pvp',
          powerupsEnabled: true,
          longRallyMultiballEnabled: true,
          trailsEnabled: true,
          theme: 'neon',
          fullReplayRetention: false,
          matchChatMode: 'free'
        }
      }
    }
  };

  return config;
});
