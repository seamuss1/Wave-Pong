const SCALE = 173.7178;
const DEFAULT_TAU = 0.5;
const DEFAULT_EPSILON = 0.000001;

function toMu(rating) {
  return (rating - 1500) / SCALE;
}

function toPhi(rd) {
  return rd / SCALE;
}

function fromMu(mu) {
  return mu * SCALE + 1500;
}

function fromPhi(phi) {
  return phi * SCALE;
}

function g(phi) {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function E(mu, muJ, phiJ) {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

function updatePlayer(playerRating, opponentRating, score, tau = DEFAULT_TAU) {
  const mu = toMu(playerRating.rating);
  const phi = toPhi(playerRating.rd);
  const sigma = playerRating.volatility;
  const muJ = toMu(opponentRating.rating);
  const phiJ = toPhi(opponentRating.rd);
  const gPhi = g(phiJ);
  const expected = E(mu, muJ, phiJ);
  const variance = 1 / (gPhi * gPhi * expected * (1 - expected));
  const delta = variance * gPhi * (score - expected);
  const a = Math.log(sigma * sigma);

  function f(x) {
    const ex = Math.exp(x);
    const numerator = ex * (delta * delta - phi * phi - variance - ex);
    const denominator = 2 * Math.pow(phi * phi + variance + ex, 2);
    return (numerator / denominator) - ((x - a) / (tau * tau));
  }

  let A = a;
  let B = 0;
  if (delta * delta > phi * phi + variance) {
    B = Math.log(delta * delta - phi * phi - variance);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) {
      k += 1;
    }
    B = a - k * tau;
  }

  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > DEFAULT_EPSILON) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB < 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }

  const sigmaPrime = Math.exp(A / 2);
  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);
  const phiPrime = 1 / Math.sqrt((1 / (phiStar * phiStar)) + (1 / variance));
  const muPrime = mu + (phiPrime * phiPrime * gPhi * (score - expected));

  return {
    rating: Math.round(fromMu(muPrime)),
    rd: Math.round(fromPhi(phiPrime)),
    volatility: Number(sigmaPrime.toFixed(6))
  };
}

module.exports = {
  updatePlayer
};
