# Game Wave Pong

Game Wave Pong is a fast, arcade-style browser Pong game with wave weapons, XP progression, multiball chaos, instant powerups, and head-to-head stats. It runs as a static browser game with the runtime kept under `runtime/`, so it can be opened locally or packaged for itch.io as an HTML5 game.

## What the game is

At its core, this is Pong with two big twists:

1. **You are not limited to paddle contact.** Each paddle has a wave cannon with three wave types driven by a shared charge bar.
2. **Matches escalate over time.** Waves gain XP, powerups appear mid-match, XP minions can be farmed, and long rallies can eventually trigger multiball.

The result is part Pong, part arena control game.

## How to play

Open `runtime/index.html` in a modern desktop browser.

## Project layout

- `runtime/index.html` contains the game UI markup and is the local browser entrypoint.
- `runtime/styles/main.css` contains the presentation layer.
- `runtime/js/app.js` contains the game loop, rendering, input, and gameplay systems.
- `runtime/js/config.js` contains the tweakable gameplay numbers and static game definitions.
- `runtime/wave_pong.html` is a legacy entry that redirects to `runtime/index.html`.
- `tools/browser-smoke-test.js` contains the headless browser smoke test.
- `tools/package.json` contains tooling-only Node metadata.

## itch.io packaging

itch.io expects the deployable files at the archive root. In this repo, that means zipping the contents of `runtime/`, not the `runtime/` folder itself.

### Controls

#### Single player
- **W / S** move your paddle
- **Up / Down** also move your paddle
- **F or Space** fire your wave
- **P** pause
- **M** mute
- **Esc** open menu

#### Two player
- **Player 1:** W / S move, F or Space fire
- **Player 2:** Up / Down move, / fire
- **P** pause
- **M** mute
- **Esc** open menu

## Objective and rules

- Score by sending a ball past the opponent into their goal.
- The score limit is configurable in settings.
- When a ball scores, the point is awarded and **a new ball is added**. The field is not wiped, so existing balls, waves, and powerups can keep the match chaotic.
- Long rallies can still add more balls over time, but at a moderated pace.
- Matches end when one side reaches the selected goal total.
- The game tracks match stats and browser-saved historical totals.

## Core systems

## Paddles and aiming

Each paddle has a visible aiming line. As you move up or down, the aim tilts smoothly so the shot direction feels connected to paddle motion rather than snapping.

## The wave bar

Every paddle has a shared **wave charge bar**.

- Base max charge is **100%**
- The bar refills automatically over time
- You can fire again almost immediately as long as you still have enough charge

### Wave costs

- **Blue wave:** 15% charge
- **Pink wave:** 50% charge
- **Gold wave:** 100% charge

Some powerups can temporarily increase max charge to **150%** and speed up recharge.

## Wave XP and leveling

Wave power scales with XP.

You gain XP from:
- passive gain over time
- scoring goals
- hitting your opponent with offensive wave pressure
- breaking XP minions
- XP-related powerups

You can lose XP from:
- debuff powerups such as **XP Drain**
- being hit by strong yellow wave effects

Leveling improves wave performance, but the game is tuned so the scaling stays readable rather than exploding into total screen spam.

# Wave powers

## Blue wave

**Role:** ball control, tempo control, offense and defense

The blue wave is the cheapest and most flexible wave. It is designed to be used often.

### What it does
- Fast travel speed
- Slightly extended range
- Stronger sweet spot in the center
- If it hits a ball moving **away** from the paddle, it can apply a **boost**
- If it hits a ball moving **toward** the paddle, it can apply a brief **hit stun**, then release the ball at its post-hit velocity
- Sweet spot blue hits create stronger boosts and better control
- Blue-boosted balls are slightly more resistant to yellow wave influence

### Best use cases
- saving or stabilizing a loose ball
- accelerating a counterattack
- re-aiming a ball that is drifting out of position
- forcing awkward rebounds for the opponent

## Pink wave

**Role:** defense and emergency saves

Pink is the solid defensive wave. It has a wider angle but a shorter reach than blue.

### What it does
- wider coverage cone
- shorter range
- thicker visual presence
- more “wall-like” defensive behavior
- especially good at protecting near-goal situations

### Best use cases
- saving points that are about to slip in
- blocking tight angle attacks near your side
- stabilizing defense when multiball gets messy

## Gold wave

**Role:** offense, disruption, and precision power plays

Gold is the full-bar super wave.

### What it does
- consumes the full charge bar
- travels as a broad offensive arc
- is strongest in the **center sweet spot** and weaker at the edges
- rewards accurate aim instead of random spraying
- can deflect balls strongly in the wave direction when the sweet spot connects
- can add a boost to the ball on a strong center hit
- can hit paddles and disrupt them
- grows slightly when it connects with balls
- can interact with powerups on the field
- uses visual diffraction-style effects on wall contact

### Best use cases
- forcing a scoring window
- breaking an opponent’s defensive setup
- punishing predictable ball paths
- sweeping live powerups while applying pressure

## Ball feedback

The ball changes color based on **who hit it last**, making possession and control easier to read.

Boosted balls also get a speed visual effect so you can tell when a wave has added extra pace.

# Powerups

Powerups are **instant** when collected. Buffs and debuffs are visually distinct, and a short floating label appears at the pickup location so you can see what was triggered.

## Buff powerups

### Mega Paddle (⇕)
Temporarily increases paddle size for better coverage.

### Overcharge (⚡)
Instantly tops off your current wave bar.

### Cap Bank (▰)
Temporarily extends your maximum wave bar to **150%**.

### Rapid Charge (≫)
Temporarily increases wave recharge speed.

### Multiball (◎)
Adds another ball to the court.

### XP Surge (⟲)
Gives bonus wave XP.

## Debuff powerups

### Shrink Hex (⇣)
Temporarily reduces the opponent paddle size.

### Drag Field (⌛)
Temporarily slows the opponent paddle.

### Aim Jam (✶)
Disrupts the opponent’s aim control.

### XP Drain (◌)
Cuts opponent XP and drains some wave resources.

## XP minions

### XP Minion (✹)
A special target you can hit with the ball or a wave for XP. These are not just pickups. They are mini objectives you can farm during play.

# Match flow and stats

The game keeps the match moving fast:

- waves recharge automatically
- you can fire repeatedly if you have charge
- points do not clear the whole field
- multiball ramps tension without turning every match into instant nonsense

At game over, the match ending is distinct instead of instantly snapping into a new round. The game also tracks statistics such as:

- wins
- points scored
- ball hits
- shots fired
- wave hits
- powerups collected
- best rally / longest rally
- last winner

Historic stats are stored locally in your browser.

# Strategy guide

## 1. Use blue constantly
Blue is your general-purpose tool. Because it is cheap, fast, and flexible, it should be part of your normal rhythm rather than something you save forever.

## 2. Use pink like a shield, not a snipe
Pink is best when the ball is threatening your goal or when you need broad short-range coverage. It is about reliability, not reach.

## 3. Aim yellow with intent
Gold is strongest in the center. A centered hit is much better than a sloppy edge hit. Treat it like a precision power play.

## 4. Farm XP without losing court control
XP minions and XP powerups are valuable, but chasing them blindly can give up points. Take them when they fit your ball control, not when they pull you out of position.

## 5. Fight for the middle in multiball
As more balls arrive, court control matters more than raw aggression. Blue helps steer the chaos, pink saves emergencies, and yellow should be used to create a clean scoring opening rather than random noise.

## 6. Watch the charge bar, not just the ball
Because blue, pink, and gold all spend from the same resource, smart timing matters. A full bar is pressure. A half bar is still dangerous. An empty bar means you are back to pure paddle fundamentals.

# Feature summary

- Static browser game with itch.io-ready entrypoint
- Single player, local two player, and demo options
- Smooth paddle aiming
- Shared wave charge system
- Three wave types with different roles
- XP leveling for wave power
- Instant powerups and debuffs
- XP minions
- Multiball escalation
- Ball ownership color feedback
- Boost visuals on fast balls
- Match stats and persistent history
- Neon arcade presentation with sound and effects

# Recommended play styles

## Safe control style
Use blue for steady control, pink for emergency defense, and save gold for obvious punish windows.

## Aggressive pressure style
Farm XP early, contest powerups hard, and use gold to disrupt the opponent before they can stabilize.

## Survival style in multiball
Prioritize positioning and pink defense first. Then use blue to tame the most dangerous ball before looking for offense.

# Notes

This README describes the current Game Wave Pong build and its intended gameplay loop. If you continue tuning the game, update this README alongside the code so the strategy and powerup sections stay accurate. Gameplay balance now lives in `runtime/js/config.js`.
