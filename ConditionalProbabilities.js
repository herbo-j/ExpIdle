import { ConstantCost, CustomCost, ExponentialCost, FirstFreeCost, FreeCost } from "./api/Costs";
import { Localization } from "./api/Localization";
import { BigNumber, parseBigNumber } from "./api/BigNumber";
import { QuaternaryEntry, theory } from "./api/Theory";
import { Utils } from "./api/Utils";
import { ui } from "./api/ui/UI";
import { Color } from "./api/ui/properties/Color";
import { Keyboard } from "./api/ui/properties/Keyboard";
import { LayoutOptions } from "./api/ui/properties/LayoutOptions";
import { TextAlignment } from "./api/ui/properties/TextAlignment";
import { TouchType } from "./api/ui/properties/TouchType";
import { Thickness } from "./api/ui/properties/Thickness";

// Exponential Idle custom theories must be a single file, so the code is
// structured into small, clearly separated helper functions instead of modules.

requiresGameVersion("1.4.33");

var id = "conditional_probabilities";
// The development version in the name is bumped on every change so the loaded build is identifiable
// in game. The game requires `name` to be a plain string literal.
var name = "Conditional Probabilities v0.42";
var description =
    "A random variable X is drawn uniformly from [-1, 1] every tick. On average it is zero, " +
    "so letting it drive r directly gets you nowhere. But you decide when to listen: " +
    "r only changes in ticks where X lands above your threshold S. Choose S wisely.";
var authors = "herbo.j";
var version = 1;

// =============================================================================
// BALANCING CONSTANTS
// All tunable numbers live here. Costs are given as log10 of rho.
// =============================================================================

var TAU_EXPONENT = 0.4;                 // tau = rho^TAU_EXPONENT
var PUBLICATION_EXPONENT = 0.1385;       // publication multiplier = tau^PUBLICATION_EXPONENT

// q1 is a "mod 20" variable: each level adds 2^floor(level / 20).
var Q1_STEPWISE = { base: 2, length: 20 };

// Regular upgrade costs: cost(level) = 10^(base + step * level).
// Growth budget: each variable adds log10(gain per level) / step to the exponent of rho in rho dot
// (rho dot ~ rho^sum). Across publications, the publication multiplier
// tau^PUBLICATION_EXPONENT = rho^(PUBLICATION_EXPONENT * TAU_EXPONENT) adds to it.
// The total must stay below 1, otherwise progress accelerates from publication to publication:
//   q2 0.301/0.98 = 0.31, q1 0.301/2.0 = 0.15, r1 1.1*0.301/1.2 = 0.28 (with r^1.1),
//   z1 0.301/5.0 = 0.06, z2 0.301/3.5 = 0.09 (asymptotically x2 per level)  -> sum ~0.89
//   publication multiplier 0.139 * 0.4 = 0.06                                -> total ~0.94
//   q^1.11 (from e70) / q^1.13 (from e300) multiply the q1 and q2 terms      -> total ~0.99
// The response is very sensitive: rho grows roughly like t^(3 / (1 - total)).
// Balanced with py -m sim.run_conditional_probabilities (reaches e1500 in ~160 days).
var Q1_COST = { base: 1,   step: 0.1 };
var Q2_COST = { base: 1.5, step: 0.98 };
var R1_COST = { base: 2,   step: 1.2 };
var Z1_COST = { base: 100, step: 0.5 };
var Z2_COST = { base: 101, step: 3.5 };

// Interval of X ~ U(min, max), one entry per level of the X interval milestone.
// The threshold S is restricted to the current interval.
// Expected r dot per unit r_1 is (max^2 - S^2) / (2 (max - min)), maximal at S = 0.
var X_INTERVALS = [
    { min: -1, max: 1 },
    { min: -6, max: 4 },
    { min: -18, max: 12 },
    { min: -54, max: 36 }
];
var DEFAULT_THRESHOLD = 0.5;

// Milestone costs: rho thresholds (log10) at which each milestone point is earned.
var MILESTONE_RHO_LOG10 = [20, 35, 50, 60, 70, 100, 150, 250, 300, 350, 500, 1000];

// z milestone: rho dot = q r z, z dot = z_1 Z, but only in ticks where Z > T, Z ~ N(Z_MEAN, sigma)
// with sigma = z_2. E[Z 1_{Z > T}] = mu (1 - Phi(k)) + sigma phi(k), k = (T - mu) / sigma.
// Its derivative in T is -T * density(T), so T = 0 is optimal for every sigma.
var Z_MEAN = -1;
var Z_START = BigNumber.ONE;            // z multiplies rho dot, so it starts at 1 to keep rho dot when unlocked
var Z_MIN = BigNumber.ZERO;             // z can fall to, but never below, this value
var DEFAULT_Z_THRESHOLD = 1;
var Z_UNLOCK_RHO_LOG10 = 100;           // the milestone can only be bought from here, not by swapping points earlier
// z1 is a "mod 10" variable like q1
var Z1_STEPWISE = { base: 2, length: 10 };

// Y milestone: Y ~ N(f(X), Y_SD) with f(x) = slope x + intercept is drawn after X, and r dot uses
// X + Y instead of X. While Y is active, X ~ Y_X_INTERVAL instead of the X interval milestone.
// The threshold still applies to X, so the optimal S is the root of E[X + Y | X] = m(x) = a x + b
// (a = slope + 1, b = intercept), S = -b/a, with optimal net effect (a + b)^2 / (2a) / 3.
var Y_X_INTERVAL = { min: -2, max: 1 };
var Y_SD = 1;
var Y_UNLOCK_RHO_LOG10 = 150;           // the milestone can only be bought from here, not by swapping points earlier

// f per level of the f milestone. Unconditionally E[X + Y] < 0 in all levels, so a bad S lets r shrink.
// The first level must beat the last X interval U(-54, 36) (net 7.2), otherwise Y is a downgrade.
//   36x + 18:  E[X + Y] = -0.5,  optimal S = -0.486, net ~13.63
//   72x + 32:  E[X + Y] = -4.5,  optimal S = -0.438, net ~25.17
//   160x + 60: E[X + Y] = -20.5, optimal S = -0.373, net ~50.56
var Y_F_LEVELS = [
    { slope: 36,  intercept: 18 },
    { slope: 72,  intercept: 32 },
    { slope: 160, intercept: 60 }
];
// rho at which each f milestone level becomes buyable (one entry per level above 0). Gated, since
// the X interval points become free once Y is active and could otherwise be swapped into f early.
var F_UNLOCK_RHO_LOG10 = [250, 350];

// r exponent milestone, unlocked by a permanent upgrade. A milestone point is earned at the same rho,
// so there is currently no need to swap points between the X interval and this exponent.
var R_EXPONENT = 1.1;
var R_EXPONENT_UNLOCK_RHO_LOG10 = 60;   // same as the 4th milestone point

// q exponent milestone: the exponent of q after each level. Each level becomes buyable at its rho
// (gated, so levels cannot be bought earlier by swapping points), together with a milestone point.
var Q_EXPONENT_VALUES = [1.11, 1.13];
var Q_EXPONENT_UNLOCK_RHO_LOG10 = [70, 300];

// z exponent milestone, buyable from its rho on, together with the 12th milestone point.
var Z_EXPONENT_VALUES = [1.01];
var Z_EXPONENT_UNLOCK_RHO_LOG10 = 1000;

// W milestone (active only): q dot = q_1 q_2 W_hat. Every W_DRAW_TICKS ticks W ~ N(w(X), W_SIGMA^2) is
// drawn with the X of that tick, w(x) = W_constant W_SIGMA (1 / (1 + exp(-steepness (x - midpoint))) - 1/2).
// W_constant keeps W almost never negative when the button is pressed correctly.
// Only X is shown (on a button). W_hat is 0, so q stalls, until the player presses the button; then
// W_hat = W until the next draw. Pressing exactly when X > midpoint is optimal. With c = midpoint, k = steepness:
//   E[W 1_{X > c}] = W_constant W_SIGMA ((ln(1 + e^{k (b - c)}) - ln 2) / k - (b - c) / 2) / (b - a)
//                  ~ 11077 for X ~ U(-2, 1),
// a bit less in practice, since W_hat is 0 in the draw tick and until the player reacts.
// Large ticks (offline) leave q unchanged.
var W_SIGMA = 1e3;
var W_constant = 75; //constant boost 
var W_SIGMOID = { steepness: 100, midpoint: 0.1 };
var W_DRAW_TICKS = 50;                  // 5 seconds
var W_UNLOCK_RHO_LOG10 = 500;           // the milestone can only be bought from here, not by swapping points earlier

var R_MIN = BigNumber.ZERO;             // r can fall to, but never below, this value
var Q_MIN = BigNumber.ZERO;             // q can fall to (with a negative W_hat), but never below, this value

// The quaternary values show the net effect of X and Z over the last N ticks, N set by the player
// in the threshold menu. Short by default so it reacts quickly; it is deliberately only a rough
// helper for choosing S and T.
var NET_EFFECT_WINDOW_TICKS = { default: 100, min: 50, max: 5000 };

// Ticks longer than this (in real seconds, normal ticks are ~0.1 s) do not draw X, since a single
// draw would decide the whole interval. They use the expected r dot instead.
var LARGE_TICK_SECONDS = 1;

// =============================================================================
// STATE
// =============================================================================

var currency;
var q = BigNumber.ZERO;
var r = BigNumber.ZERO;
var threshold = DEFAULT_THRESHOLD;      // S, set by the player
var lastX = 0;                          // last drawn X, for display
var lastY = 0;                          // last drawn Y, for display
var z = Z_START;
var zThreshold = DEFAULT_Z_THRESHOLD;   // T, set by the player
var lastZ = BigNumber.ZERO;             // last drawn Z, for display
var netEffectWindowTicks = NET_EFFECT_WINDOW_TICKS.default;    // N, set by the player
var xWindow;                            // accepted r dot factors (X or X + Y) of the last ticks, see NET EFFECT WINDOW
var zWindow;                            // accepted z dot factors Z of the last ticks, see NET EFFECT WINDOW
var drawnW = 0;                         // last drawn W, hidden from the player
var drawnWX = null;                     // X with which W was drawn, shown on the W button (null before the first draw)
var isWApplied = false;                 // whether the button was pressed since the last draw, i.e. W_hat = W
var ticksUntilWDraw = 0;                // W is drawn when this reaches 0
var rhoDot = BigNumber.ZERO;            // last computed rho dot, for display
var quaternaryEntries;
var isEquationPanelPressed = false;     // shows the explanation of the averages in the secondary equation

// regular upgrades
var q1, q2, r1, z1, z2;
// developer speed-up (remove before release)
var mDev;
// permanent upgrades
var rExponentPerm;
// milestone upgrades
var xIntervalMilestone, rExponentMilestone, yMilestone, fMilestone, zMilestone, qExponentMilestone, zExponentMilestone,
    wMilestone;

// =============================================================================
// COST HELPERS
// =============================================================================

var tenToThe = (log10Value) => BigNumber.TEN.pow(BigNumber.from(log10Value));

// cost(level) = 10^(base + step * level), expressed as the built-in ExponentialCost
// (base * 2^(progress * level)), so the game can solve it for the max affordable level.
var exponentialCostLog10 = (costSpec) =>
    new ExponentialCost(tenToThe(costSpec.base), costSpec.step * Math.log2(10));

// =============================================================================
// VARIABLE VALUES
// =============================================================================

var getQ1 = (level) => Utils.getStepwisePowerSum(level, Q1_STEPWISE.base, Q1_STEPWISE.length, 0);
var getQ2 = (level) => BigNumber.TWO.pow(level);
var getR1 = (level) => BigNumber.TWO.pow(level);
var getZ1 = (level) => Utils.getStepwisePowerSum(level, Z1_STEPWISE.base, Z1_STEPWISE.length, 0);
// z2 = 2^{level + Z2_START_LOG2}. Starts at 2, since with sigma = 1 a Z above 0 already needs a
// 1 sigma event, which makes z barely grow and very random during recovery.
var Z2_START_LOG2 = 1;
var getZ2Log2 = (level) => level + Z2_START_LOG2;
var getZ2 = (level) => BigNumber.TWO.pow(getZ2Log2(level));

// Exponent at a milestone level, given the exponent after each level (1 at level 0).
var getExponentAtLevel = (exponentValues, level) => level == 0 ? 1 : exponentValues[level - 1];
var getRExponent = () => getExponentAtLevel([R_EXPONENT], rExponentMilestone.level);
var getQExponent = () => getExponentAtLevel(Q_EXPONENT_VALUES, qExponentMilestone.level);
var getZExponent = () => getExponentAtLevel(Z_EXPONENT_VALUES, zExponentMilestone.level);

// DEVELOPER SPEED-UP (remove before release): free rho dot multiplier with a reset button.
var M_DEV_BASE = 10;                     // m_dev = 10^level
var M_DEV_MAX_LEVEL = 100;               // 10^100
var getMDev = (level) => BigNumber.from(M_DEV_BASE).pow(level);

// =============================================================================
// RANDOM VARIABLE & THRESHOLD
// =============================================================================

var isYActive = () => yMilestone.level > 0;

// While Y is active, X uses its own interval instead of the X interval milestone.
var getXInterval = () => isYActive() ? Y_X_INTERVAL : X_INTERVALS[xIntervalMilestone.level];

var ALL_X_INTERVALS = X_INTERVALS.concat([Y_X_INTERVAL]);

// X ~ U(min, max)
var drawX = () => {
    let interval = getXInterval();
    return interval.min + (interval.max - interval.min) * Math.random();
};

// Standard normal sample via the Box-Muller transform. 1 - random() lies in (0, 1], so the log is finite.
var drawStandardNormal = () =>
    Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());

var standardNormalDensity = (x) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);

// Error function, Abramowitz & Stegun 7.1.26 (absolute error < 1.5e-7). JS has no Math.erf.
var erf = (x) => {
    let sign = x < 0 ? -1 : 1;
    let t = 1 / (1 + 0.3275911 * Math.abs(x));
    let polynomial = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
    return sign * (1 - polynomial * Math.exp(-x * x));
};

var standardNormalCdf = (x) => 0.5 * (1 + erf(x / Math.SQRT2));

var getYF = () => Y_F_LEVELS[fMilestone.level];

var getYMean = (x) => getYF().slope * x + getYF().intercept;

// Y ~ N(f(X), Y_SD), depends on the X drawn in the same tick
var drawY = (x) => getYMean(x) + Y_SD * drawStandardNormal();

var clampToRange = (value, min, max) => Math.min(max, Math.max(min, value));

var clampThreshold = (value) => clampToRange(value, getXInterval().min, getXInterval().max);

// Clamps to the widest range over all intervals. Used when loading, since the milestone level
// may not be restored yet. A threshold outside the current interval is still well defined.
var clampThresholdToAllIntervals = (value) => clampToRange(value,
    Math.min(...ALL_X_INTERVALS.map((interval) => interval.min)),
    Math.max(...ALL_X_INTERVALS.map((interval) => interval.max)));

// Parses the player's input. Returns null if the text is not a finite number (e.g. while typing "-").
var parseThreshold = (text) => {
    let value = parseFloat(text);
    return isFinite(value) ? value : null;
};

var formatThreshold = (value) => value.toFixed(2);

// Rounds down (towards -infinity) to 2 decimals, so a shown value never overstates the real one.
var formatFloor2 = (value) => (Math.floor(value * 100) / 100).toFixed(2);

var setThreshold = (value) => {
    threshold = value;
    theory.invalidateSecondaryEquation();
};

var setZThreshold = (value) => {
    zThreshold = value;
    theory.invalidateSecondaryEquation();
};

// =============================================================================
// NET EFFECT WINDOW
// Ring buffer over the last N = netEffectWindowTicks ticks, one per random variable (X for r, Z for z).
// Each slot holds the factor of that tick as BigNumber if it passed the threshold (i.e. changed r or z),
// otherwise null. BigNumber, since Z scales with sigma = z_2 = 2^{level + 1}, which exceeds the double range.
// Sum and count are kept as running values; the sum is recomputed once per full cycle so
// rounding errors cannot drift.
// =============================================================================

var createNetEffectWindow = (size) => ({
    slots: new Array(size).fill(null),
    nextIndex: 0,
    sum: BigNumber.ZERO,
    count: 0,                           // ticks in the window that passed the threshold
    ticks: 0                            // ticks in the window, < slots.length until it is filled
});

var recomputeNetEffectWindowSum = (netEffectWindow) => {
    netEffectWindow.sum = BigNumber.ZERO;
    for (let value of netEffectWindow.slots)
        if (value !== null) netEffectWindow.sum += value;
};

// Stores the factor of the current tick, or null if it did not pass the threshold.
var pushToNetEffectWindow = (netEffectWindow, acceptedValue) => {
    let oldValue = netEffectWindow.slots[netEffectWindow.nextIndex];
    if (oldValue !== null) {
        netEffectWindow.sum -= oldValue;
        netEffectWindow.count--;
    }
    if (acceptedValue !== null) {
        netEffectWindow.sum += acceptedValue;
        netEffectWindow.count++;
    }
    let size = netEffectWindow.slots.length;
    netEffectWindow.ticks = Math.min(netEffectWindow.ticks + 1, size);
    netEffectWindow.slots[netEffectWindow.nextIndex] = acceptedValue;
    netEffectWindow.nextIndex = (netEffectWindow.nextIndex + 1) % size;
    if (netEffectWindow.nextIndex == 0) recomputeNetEffectWindowSum(netEffectWindow);
};

// The newest `count` values of the window, oldest first.
var getNewestWindowValues = (netEffectWindow, count) => {
    let size = netEffectWindow.slots.length;
    let values = [];
    for (let i = count; i > 0; i--) values.push(netEffectWindow.slots[(netEffectWindow.nextIndex - i + size) % size]);
    return values;
};

// New window of the given size that keeps as many of the newest values as fit, so changing N
// does not throw away the recorded ticks.
var resizeNetEffectWindow = (netEffectWindow, size) => {
    let resized = createNetEffectWindow(size);
    for (let value of getNewestWindowValues(netEffectWindow, Math.min(netEffectWindow.ticks, size)))
        pushToNetEffectWindow(resized, value);
    return resized;
};

var isValidNetEffectWindowTicks = (value) =>
    Number.isInteger(value) && value >= NET_EFFECT_WINDOW_TICKS.min && value <= NET_EFFECT_WINDOW_TICKS.max;

var setNetEffectWindowTicks = (value) => {
    if (value == netEffectWindowTicks) return;
    netEffectWindowTicks = value;
    xWindow = resizeNetEffectWindow(xWindow, value);
    zWindow = resizeNetEffectWindow(zWindow, value);
    theory.invalidateSecondaryEquation();
    theory.invalidateQuaternaryValues();
};

// Net effect of the threshold per tick: average accepted factor times the share of accepted ticks,
// i.e. sum / count * count / ticks = sum / ticks. Estimates getExpectedNetX() / getExpectedNetZ(),
// so it helps choosing the threshold. Null before the first tick.
var getNetEffect = (netEffectWindow) =>
    netEffectWindow.ticks == 0 ? null : netEffectWindow.sum / BigNumber.from(netEffectWindow.ticks);

// =============================================================================
// R UPDATE
// =============================================================================

// Expected r dot factor given X = x, as m(x) = slope x + intercept:
// X alone gives m(x) = x, X + Y gives m(x) = x + f(x).
var getFactorMeanGivenX = () => isYActive()
    ? { slope: 1 + getYF().slope, intercept: getYF().intercept }
    : { slope: 1, intercept: 0 };

// Expected r dot factor per tick including the ticks where X <= S (those contribute 0), X ~ U(a, b):
// E[m(X) 1_{X > S}] = integral_S^b m(x) / (b - a) dx
//                   = (slope (b^2 - S^2) / 2 + intercept (b - S)) / (b - a), with S clamped to [a, b].
// Without Y this is (b^2 - S^2) / (2 (b - a)), maximal at S = 0; in general maximal at m(S) = 0.
// Must be kept in sync if milestones change the r dot formula.
var getExpectedNetX = () => {
    let interval = getXInterval();
    let mean = getFactorMeanGivenX();
    let s = clampThreshold(threshold);
    let b = interval.max;
    return (mean.slope * (b * b - s * s) / 2 + mean.intercept * (b - s)) / (b - interval.min);
};

var addToR = (xFactor, dt) => {
    r = (r + BigNumber.from(xFactor) * getR1(r1.level) * dt).max(R_MIN);
};

// Draws X (and Y, if active) for this tick and returns the r dot factor X or X + Y.
var drawRFactor = () => {
    lastX = drawX();
    if (!isYActive()) return lastX;
    lastY = drawY(lastX);
    return lastX + lastY;
};

// Normal tick: r dot = factor r_1, but only if the drawn X > S. r never drops below R_MIN.
var updateRWithDraw = (dt) => {
    let factor = drawRFactor();
    let isAccepted = lastX > threshold;
    pushToNetEffectWindow(xWindow, isAccepted ? BigNumber.from(factor) : null);
    if (isAccepted) addToR(factor, dt);
};

// Large ticks (e.g. after the app was suspended, if the game ever delivers them) use the expected
// value instead of a single draw deciding the whole interval.
var isLargeTick = (elapsedTime) => elapsedTime > LARGE_TICK_SECONDS;

// Large ticks are not recorded in the net-effect window, since nothing was drawn.
var updateR = (elapsedTime, dt) => {
    if (isLargeTick(elapsedTime)) addToR(getExpectedNetX(), dt);
    else updateRWithDraw(dt);
};

// =============================================================================
// Z UPDATE
// Z = mu + sigma N with N standard normal and sigma = z_2. Since Z > T <=> N > (T - mu) / sigma,
// the threshold is compared in standardized units, which stays in double range for any z_2 level.
// =============================================================================

var isZActive = () => zMilestone.level > 0;

var getZSigma = () => getZ2(z2.level);

// k = (T - mu) / sigma, with 1 / sigma = 2^{-(level + Z2_START_LOG2)}
var getStandardizedZThreshold = () => (zThreshold - Z_MEAN) * Math.pow(2, -getZ2Log2(z2.level));

var getZFromStandardNormal = (n) => BigNumber.from(Z_MEAN) + getZSigma() * BigNumber.from(n);

// Expected z dot factor per tick including the ticks where Z <= T (those contribute 0):
// E[Z 1_{Z > T}] = mu (1 - Phi(k)) + sigma phi(k). Must be kept in sync if milestones change z dot.
var getExpectedNetZ = () => {
    let k = getStandardizedZThreshold();
    return BigNumber.from(Z_MEAN * (1 - standardNormalCdf(k))) + getZSigma() * BigNumber.from(standardNormalDensity(k));
};

var addToZ = (zFactor, dt) => {
    z = (z + zFactor * getZ1(z1.level) * dt).max(Z_MIN);
};

// Normal tick: z dot = Z z_1, but only if the drawn Z > T. z never drops below Z_MIN.
var updateZWithDraw = (dt) => {
    let n = drawStandardNormal();
    lastZ = getZFromStandardNormal(n);
    let isAccepted = n > getStandardizedZThreshold();
    pushToNetEffectWindow(zWindow, isAccepted ? lastZ : null);
    if (isAccepted) addToZ(lastZ, dt);
};

var updateZ = (elapsedTime, dt) => {
    if (!isZActive()) return;
    if (isLargeTick(elapsedTime)) addToZ(getExpectedNetZ(), dt);
    else updateZWithDraw(dt);
};

var getZTerm = () => isZActive() ? z.pow(BigNumber.from(getZExponent())) : BigNumber.ONE;

// =============================================================================
// Q UPDATE & W (active only)
// W is drawn every W_DRAW_TICKS ticks with the X of that tick. W_hat is W after the player pressed the
// W button, otherwise 0. Without the milestone q dot has no W_hat factor.
// =============================================================================

var isWActive = () => wMilestone.level > 0;

// w(x) = sigma (1 / (1 + exp(-steepness (x - midpoint))) - 1/2), negative below the midpoint
var getWMean = (x) => W_SIGMA * W_constant * (1 / (1 + Math.exp(-W_SIGMOID.steepness * (x - W_SIGMOID.midpoint))) - 0.5);

var drawW = () => {
    drawnWX = lastX;
    drawnW = getWMean(drawnWX) + W_SIGMA * drawStandardNormal();
    isWApplied = false;
};

var getWHat = () => isWApplied ? drawnW : 0;

var pressWButton = () => {
    isWApplied = true;
    theory.invalidateSecondaryEquation();
    theory.invalidateQuaternaryValues();
};

// Counts the ticks to the next draw. A large tick (offline) draws nothing and resets W_hat to 0,
// so q stalls until the player is back.
var updateW = (elapsedTime) => {
    if (!isWActive()) return;
    if (isLargeTick(elapsedTime)) {
        isWApplied = false;
        return;
    }
    ticksUntilWDraw--;
    if (ticksUntilWDraw > 0) return;
    drawW();
    ticksUntilWDraw = W_DRAW_TICKS;
};

// q dot factor of W: W_hat while the milestone is active, 1 otherwise.
var getQDotWFactor = () => isWActive() ? BigNumber.from(getWHat()) : BigNumber.ONE;

// q dot = q_1 q_2 (W_hat). q never drops below Q_MIN.
var updateQ = (dt) => {
    q = (q + getQ1(q1.level) * getQ2(q2.level) * getQDotWFactor() * dt).max(Q_MIN);
};

// =============================================================================
// THRESHOLD MENU (opened via the button on the equation overlay)
// =============================================================================

// Each threshold the player can set: S for X (r dot) and T for Z (z dot).
var S_THRESHOLD_SPEC = {
    symbol: "S",
    defaultValue: DEFAULT_THRESHOLD,
    get: () => threshold,
    set: (value) => setThreshold(clampThreshold(value)),
    getDescription: () => "$\\dot{r}$ only updates in ticks where $X > S$, with $" +
        getXInterval().min + " \\le S \\le " + getXInterval().max + "$."
};

var T_THRESHOLD_SPEC = {
    symbol: "T",
    defaultValue: DEFAULT_Z_THRESHOLD,
    get: () => zThreshold,
    set: setZThreshold,
    getDescription: () => "$\\dot{z}$ only updates in ticks where $Z > T$."
};

var getActiveThresholdSpecs = () => isZActive() ? [S_THRESHOLD_SPEC, T_THRESHOLD_SPEC] : [S_THRESHOLD_SPEC];

var createThresholdEntry = (spec) => ui.createEntry({
    row: 0, column: 1,
    text: formatThreshold(spec.get()),
    placeholder: formatThreshold(spec.defaultValue),
    placeholderColor: Color.TEXT_MEDIUM,
    keyboard: Keyboard.NUMERIC,
    horizontalTextAlignment: TextAlignment.END,
    onTextChanged: (_, newText) => {
        let value = parseThreshold(newText);
        if (value !== null) spec.set(value);
    }
});

// Not every numeric keyboard offers a minus key, so the sign can always be flipped with a button.
// Uses String() instead of formatThreshold() so the flip does not round away typed digits.
var createSignButton = (spec, thresholdEntry) => ui.createButton({
    row: 0, column: 2,
    margin: new Thickness(6, 0, 0, 0),
    text: "±",
    onClicked: () => {
        spec.set(-spec.get());
        thresholdEntry.text = String(spec.get());
    }
});

// Description label and input row "symbol = [inputs]" of one menu setting. The inputs go into
// column 1 (stretching) and optionally column 2 (auto width, empty if unused).
var createMenuSettingControls = (description, symbol, inputs) => [
    ui.createLatexLabel({
        margin: new Thickness(0, 0, 0, 6),
        text: description,
        horizontalTextAlignment: TextAlignment.CENTER
    }),
    ui.createGrid({
        margin: new Thickness(0, 0, 0, 10),
        columnDefinitions: ["auto", "1*", "auto"],
        children: [
            ui.createLatexLabel({
                row: 0, column: 0,
                margin: new Thickness(0, 0, 6, 0),
                text: "$" + symbol + " =$",
                verticalTextAlignment: TextAlignment.CENTER
            })
        ].concat(inputs)
    })
];

// Description and input row (symbol, entry, sign button) for one threshold.
var createThresholdControls = (spec) => {
    let thresholdEntry = createThresholdEntry(spec);
    return createMenuSettingControls(spec.getDescription(), spec.symbol,
        [thresholdEntry, createSignButton(spec, thresholdEntry)]);
};

// Only whole numbers in range are applied, so intermediate input like "5" on the way to "500" is ignored.
var createNetEffectWindowControls = () => createMenuSettingControls(
    "$\\bar{X}" + (isZActive() ? ", \\bar{Z}" : "") + "$ average over the last $N$ ticks, $" +
        NET_EFFECT_WINDOW_TICKS.min + " \\le N \\le " + NET_EFFECT_WINDOW_TICKS.max + "$.",
    "N",
    [ui.createEntry({
        row: 0, column: 1,
        text: String(netEffectWindowTicks),
        placeholder: String(NET_EFFECT_WINDOW_TICKS.default),
        placeholderColor: Color.TEXT_MEDIUM,
        keyboard: Keyboard.NUMERIC,
        horizontalTextAlignment: TextAlignment.END,
        onTextChanged: (_, newText) => {
            let value = Number(newText);
            if (isValidNetEffectWindowTicks(value)) setNetEffectWindowTicks(value);
        }
    })]);

var createThresholdMenu = () => {
    let settingControls = [].concat(...getActiveThresholdSpecs().map(createThresholdControls),
        createNetEffectWindowControls());
    let menu = ui.createPopup({
        title: "Thresholds",
        content: ui.createStackLayout({
            children: settingControls.concat([
                ui.createLatexLabel({
                    text: "Use $\\pm$ to flip the sign.",
                    horizontalTextAlignment: TextAlignment.CENTER
                }),
                ui.createButton({
                    margin: new Thickness(0, 6, 0, 0),
                    text: "Close",
                    onClicked: () => menu.hide()
                })
            ])
        })
    });
    return menu;
};

// Only the symbols, the values are already shown in the secondary equation.
var getThresholdButtonText = () => getActiveThresholdSpecs().map((spec) => spec.symbol).join(", ");

// Button height by screen width, as in the official Riemann Zeta theory.
var getSmallButtonSize = (screenWidth) => {
    if (screenWidth >= 1080) return 80;
    if (screenWidth >= 720) return 60;
    if (screenWidth >= 360) return 40;
    return 32;
};

// While the equation panel is pressed, the secondary equation explains the quaternary averages
// (same mechanism as the official Fractional Integration theory).
var onEquationPanelTouched = (event) => {
    if (event.type != TouchType.PRESSED && !event.type.isReleased()) return;
    isEquationPanelPressed = event.type == TouchType.PRESSED;
    theory.invalidateSecondaryEquation();
};

// Small button in the top left of the equation panel.
var createOverlayButton = (properties) => ui.createButton(Object.assign({
    margin: new Thickness(4),
    padding: new Thickness(8, 0),
    horizontalOptions: LayoutOptions.START,
    heightRequest: getSmallButtonSize(ui.screenWidth)
}, properties));

// Shows the X with which the current W was drawn. Pressing it sets W_hat = W until the next draw.
var getWButtonText = () => "x = " + (drawnWX === null ? "-" : formatFloor2(drawnWX));

// Share of the current draw interval that has passed: 0 right after a draw, 1 when the next W is drawn.
var getWDrawProgress = () => 1 - ticksUntilWDraw / W_DRAW_TICKS;

// The W button with a thin bar along its bottom edge that fills until the next draw.
var createWButton = () => ui.createGrid({
    isVisible: isWActive,
    horizontalOptions: LayoutOptions.START,
    children: [
        createOverlayButton({
            isEnabled: () => !isWApplied,
            text: getWButtonText,
            onClicked: pressWButton
        }),
        ui.createProgressBar({
            margin: new Thickness(10, 0, 10, 7),
            verticalOptions: LayoutOptions.END,
            progress: getWDrawProgress
        })
    ]
});

// The threshold button, and below it the W button while the W milestone is active.
var getEquationOverlay = () => ui.createGrid({
    horizontalOptions: LayoutOptions.FILL,
    verticalOptions: LayoutOptions.FILL,
    onTouched: onEquationPanelTouched,
    children: [
        ui.createStackLayout({
            horizontalOptions: LayoutOptions.START,
            verticalOptions: LayoutOptions.START,
            children: [
                createOverlayButton({
                    text: getThresholdButtonText,
                    onClicked: () => createThresholdMenu().show()
                }),
                createWButton()
            ]
        })
    ]
});

// =============================================================================
// UPGRADE FACTORIES
// =============================================================================

var createVariable = (upgradeId, cost, symbol, getValueText) => {
    let upgrade = theory.createUpgrade(upgradeId, currency, cost);
    let describe = (level) => symbol + "=" + getValueText(level);
    upgrade.getDescription = (_) => Utils.getMath(describe(upgrade.level));
    upgrade.getInfo = (amount) => Utils.getMathTo(describe(upgrade.level), describe(upgrade.level + amount));
    return upgrade;
};

var powerOfTwoText = (level) => "2^{" + level + "}";

var getIntervalText = (interval) => "U(" + interval.min + ", " + interval.max + ")";

var getMilestoneRhoLog10 = (total) =>
    total < MILESTONE_RHO_LOG10.length ? MILESTONE_RHO_LOG10[total] : 1e6;

// After buying or refunding, the threshold may lie outside the new interval.
var onXIntervalChanged = () => setThreshold(clampThreshold(threshold));

var createXIntervalMilestone = () => {
    let milestone = theory.createMilestoneUpgrade(0, X_INTERVALS.length - 1);
    let getNextInterval = () => X_INTERVALS[Math.min(milestone.level + 1, X_INTERVALS.length - 1)];
    milestone.getDescription = (_) => "Widen the interval of $X$";
    milestone.getInfo = (_) => "$X \\sim " + getIntervalText(getNextInterval()) + "$";
    milestone.boughtOrRefunded = (_) => onXIntervalChanged();
    return milestone;
};

// Increase of the exponent by the next level. Rounded, since e.g. 1.07 - 1.05 is 0.020000000000000018.
var getNextExponentIncrease = (exponentValues, level) => {
    let nextLevel = Math.min(level + 1, exponentValues.length);
    let increase = getExponentAtLevel(exponentValues, nextLevel) - getExponentAtLevel(exponentValues, nextLevel - 1);
    return parseFloat(increase.toFixed(6));
};

// Milestone that sets the exponent of a variable in rho dot to exponentValues[level - 1].
var createExponentMilestone = (milestoneId, symbol, exponentValues) => {
    let milestone = theory.createMilestoneUpgrade(milestoneId, exponentValues.length);
    let getIncrease = () => getNextExponentIncrease(exponentValues, milestone.level);
    milestone.getDescription = (_) => Localization.getUpgradeIncCustomExpDesc(symbol, getIncrease());
    milestone.getInfo = (_) => Localization.getUpgradeIncCustomExpInfo(symbol, getIncrease());
    milestone.boughtOrRefunded = (_) => theory.invalidatePrimaryEquation();
    return milestone;
};

var createRExponentPerm = () => {
    let perm = theory.createPermanentUpgrade(3, currency, new ConstantCost(tenToThe(R_EXPONENT_UNLOCK_RHO_LOG10)));
    perm.maxLevel = 1;
    perm.getDescription = (_) => "Unlock $r$ exponent milestone";
    perm.getInfo = (_) => "Milestone: $r \\to r^{" + R_EXPONENT + "}$";
    perm.boughtOrRefunded = (_) => updateAvailability();
    return perm;
};

var getFText = (yF) => "f(x) = " + yF.slope + "x + " + yF.intercept;

var createFMilestone = () => {
    let milestone = theory.createMilestoneUpgrade(3, F_UNLOCK_RHO_LOG10.length);
    let getNextF = () => Y_F_LEVELS[Math.min(milestone.level + 1, Y_F_LEVELS.length - 1)];
    milestone.getDescription = (_) => "Improve $f$";
    milestone.getInfo = (_) => "$" + getFText(getNextF()) + "$";
    return milestone;
};

// Number of milestone levels whose rho requirement (one log10 rho per level) has been reached.
var getUnlockedLevels = (unlockRhoLog10) => unlockRhoLog10.filter((rhoLog10) => hasReachedRho(rhoLog10)).length;

var createYMilestone = () => {
    let milestone = theory.createMilestoneUpgrade(2, 1);
    milestone.getDescription = (_) => "Add $Y$ to $\\dot{r}$";
    milestone.getInfo = (_) => "$X \\to X + Y,\\; Y \\sim N(f(X), " + Y_SD + "),\\; X \\sim " +
        getIntervalText(Y_X_INTERVAL) + "$";
    // X switches to its Y interval, so the threshold may need clamping
    milestone.boughtOrRefunded = (_) => onXIntervalChanged();
    return milestone;
};

var createZMilestone = () => {
    let milestone = theory.createMilestoneUpgrade(4, 1);
    milestone.getDescription = (_) => "Add $z$ to $\\dot{\\rho}$";
    milestone.getInfo = (_) => "$\\dot{\\rho} \\to \\dot{\\rho} z,\\; \\dot{z} = z_1 Z,\\; Z \\sim N(" + Z_MEAN + ", z_2^2)$";
    milestone.boughtOrRefunded = (_) => {
        updateAvailability();
        theory.invalidatePrimaryEquation();
    };
    return milestone;
};

var getWMeanText = () => "w(x) = " + W_constant + "\\sigma\\left(\\frac{1}{1 + e^{-" + W_SIGMOID.steepness + "(x - " +
    W_SIGMOID.midpoint + ")}} - \\frac{1}{2}\\right)";

var getWSigmaText = () => "10^{" + Math.log10(W_SIGMA) + "}";

var createWMilestone = () => {
    let milestone = theory.createMilestoneUpgrade(7, 1);
    milestone.getDescription = (_) => "Add $\\hat{W}$ to $\\dot{q}$ (active)";
    milestone.getInfo = (_) => "$\\dot{q} \\to \\dot{q} \\hat{W},\\; W \\sim N(w(X), \\sigma^2)$, " +
        "$\\hat{W} = W$ after pressing $x$, otherwise $0$";
    milestone.boughtOrRefunded = (_) => {
        isWApplied = false;
        theory.invalidateSecondaryEquation();
    };
    return milestone;
};

// Whether the best rho ever reached in this theory (tau = rho^TAU_EXPONENT) is at least 10^rhoLog10.
var hasReachedRho = (rhoLog10) => theory.tau >= tenToThe(TAU_EXPONENT * rhoLog10);

var updateAvailability = () => {
    rExponentMilestone.isAvailable = rExponentPerm.level > 0;
    qExponentMilestone.maxLevel = getUnlockedLevels(Q_EXPONENT_UNLOCK_RHO_LOG10);
    qExponentMilestone.isAvailable = qExponentMilestone.maxLevel > 0;
    // Gated by rho as well, so Y cannot be bought early by swapping milestone points.
    yMilestone.isAvailable = hasReachedRho(Y_UNLOCK_RHO_LOG10);
    fMilestone.maxLevel = getUnlockedLevels(F_UNLOCK_RHO_LOG10);
    fMilestone.isAvailable = fMilestone.maxLevel > 0;
    zMilestone.isAvailable = hasReachedRho(Z_UNLOCK_RHO_LOG10);
    zExponentMilestone.isAvailable = hasReachedRho(Z_EXPONENT_UNLOCK_RHO_LOG10);
    wMilestone.isAvailable = hasReachedRho(W_UNLOCK_RHO_LOG10);
    z1.isAvailable = isZActive();
    z2.isAvailable = isZActive();
};

// =============================================================================
// INIT
// =============================================================================

var init = () => {
    currency = theory.createCurrency();
    xWindow = createNetEffectWindow(netEffectWindowTicks);
    zWindow = createNetEffectWindow(netEffectWindowTicks);

    // Regular upgrades
    q1 = createVariable(0, new FirstFreeCost(exponentialCostLog10(Q1_COST)), "q_1", (lv) => getQ1(lv).toString(0));
    q2 = createVariable(1, exponentialCostLog10(Q2_COST), "q_2", powerOfTwoText);
    r1 = createVariable(2, exponentialCostLog10(R1_COST), "r_1", powerOfTwoText);
    z1 = createVariable(3, new FirstFreeCost(exponentialCostLog10(Z1_COST)), "z_1", (lv) => getZ1(lv).toString(0));
    z2 = createVariable(4, exponentialCostLog10(Z2_COST), "z_2", (lv) => powerOfTwoText(getZ2Log2(lv)));

    // DEVELOPER SPEED-UP (remove before release). Excluded from the autobuyer and capped,
    // since a free upgrade would otherwise be bought without limit.
    mDev = createVariable(99, new FreeCost(), "m_{dev}", (lv) => M_DEV_BASE + "^{" + lv + "}");
    mDev.isAutoBuyable = false;
    mDev.maxLevel = M_DEV_MAX_LEVEL;
    mDev.boughtOrRefunded = (_) => theory.invalidatePrimaryEquation();

    // free button resets m_dev to level 0 (value 1) and itself.
    let mDevReset = theory.createUpgrade(98, currency, new FreeCost());
    mDevReset.getDescription = (_) => "Reset $m_{dev}$ to 1";
    mDevReset.getInfo = (_) => "Sets $m_{dev}$ back to level 0";
    mDevReset.isAutoBuyable = false;
    mDevReset.maxLevel = 1;
    mDevReset.boughtOrRefunded = (_) => {
        mDev.level = 0;
        mDevReset.level = 0;
        theory.invalidatePrimaryEquation();
    };

    // Permanent upgrades
    theory.createPublicationUpgrade(0, currency, 1e7);
    theory.createBuyAllUpgrade(1, currency, 1e12);
    theory.createAutoBuyerUpgrade(2, currency, 1e16);
    rExponentPerm = createRExponentPerm();

    // Milestones (cost is log10 of tau)
    theory.setMilestoneCost(new CustomCost((total) => BigNumber.from(TAU_EXPONENT * getMilestoneRhoLog10(total))));
    xIntervalMilestone = createXIntervalMilestone();
    rExponentMilestone = createExponentMilestone(1, "r", [R_EXPONENT]);
    yMilestone = createYMilestone();
    fMilestone = createFMilestone();
    zMilestone = createZMilestone();
    qExponentMilestone = createExponentMilestone(5, "q", Q_EXPONENT_VALUES);
    zExponentMilestone = createExponentMilestone(6, "z", Z_EXPONENT_VALUES);
    wMilestone = createWMilestone();

    quaternaryEntries = [
        new QuaternaryEntry("\\dot{\\rho}", null),
        new QuaternaryEntry("q", null),
        new QuaternaryEntry("r", null),
        new QuaternaryEntry("z", null),
        new QuaternaryEntry("\\bar{X}", null),
        new QuaternaryEntry("\\bar{Z}", null),
        new QuaternaryEntry("\\hat{W}", null)
    ];

    updateAvailability();
};

// =============================================================================
// GAME LOOP
// =============================================================================

var tick = (elapsedTime, multiplier) => {
    let dt = BigNumber.from(elapsedTime * multiplier);
    let bonus = theory.publicationMultiplier;

    updateR(elapsedTime, dt);           // draws X, which W uses
    updateW(elapsedTime);
    updateQ(dt);
    updateZ(elapsedTime, dt);

    rhoDot = bonus * q.pow(BigNumber.from(getQExponent())) * r.pow(BigNumber.from(getRExponent())) * getZTerm() * getMDev(mDev.level);
    currency.value += dt * rhoDot;

    updateAvailability();
    theory.invalidateSecondaryEquation();
    theory.invalidateTertiaryEquation();
    theory.invalidateQuaternaryValues();
};

var postPublish = () => {
    q = BigNumber.ZERO;
    r = BigNumber.ZERO;
    z = Z_START;
    isWApplied = false;
};

var getInternalState = () => JSON.stringify({
    q: q.toString(),
    r: r.toString(),
    z: z.toString(),
    threshold,
    zThreshold,
    netEffectWindowTicks
});

var setInternalState = (state) => {
    if (!state) return;
    let values = JSON.parse(state);
    if (values.q !== undefined) q = parseBigNumber(values.q);
    if (values.r !== undefined) r = parseBigNumber(values.r);
    if (values.z !== undefined) z = parseBigNumber(values.z);
    if (values.threshold !== undefined) threshold = clampThresholdToAllIntervals(values.threshold);
    if (values.zThreshold !== undefined) zThreshold = values.zThreshold;
    if (isValidNetEffectWindowTicks(values.netEffectWindowTicks)) setNetEffectWindowTicks(values.netEffectWindowTicks);
};

// =============================================================================
// EQUATIONS
// =============================================================================

// "^{1.1}" for exponents other than 1, nothing otherwise
var getExponentText = (exponent) => exponent == 1 ? "" : "^{" + exponent + "}";

var getPrimaryEquation = () => {
    theory.primaryEquationHeight = 50;
    let zText = isZActive() ? "z" + getExponentText(getZExponent()) : "";
    return "\\dot{\\rho} = q" + getExponentText(getQExponent()) + "r" + getExponentText(getRExponent()) + zText;
};

var getMainSecondaryLines = () => {
    let lines = [
        "\\dot{q} = q_1 q_2" + (isWActive() ? " \\hat{W}" : ""),
        "\\dot{r} = " + getRFactorText("") + " r_1 " + getIndicatorText("X > S"),
        "X \\sim " + getIntervalText(getXInterval()) + ",\\; S = " + formatThreshold(threshold)
    ];
    if (isYActive()) lines.push("Y \\sim N(f(X), " + Y_SD + "),\\; " + getFText(getYF()));
    if (isZActive()) {
        lines.push("\\dot{z} = Z z_1 " + getIndicatorText("Z > T"));
        lines.push("Z \\sim N(" + Z_MEAN + ", z_2^2),\\; T = " + formatThreshold(zThreshold));
    }
    if (isWActive()) {
        lines.push("W \\sim N(w(X), \\sigma^2),\\; \\sigma = " + getWSigmaText());
        lines.push(getWMeanText());
    }
    return lines;
};

// Shown while the equation panel is pressed: X bar and Z bar in the quaternary values are not the
// means of X and Z, but their net effect per tick over the last N ticks.
var getAverageExplanationLines = () => {
    let sum = "\\frac{1}{N}\\sum_{i=1}^{N}";
    let lines = ["\\bar{X} = " + sum + getRFactorText("_i") + getIndicatorText("X_i > S")];
    if (isZActive()) lines.push("\\bar{Z} = " + sum + "Z_i" + getIndicatorText("Z_i > T"));
    lines.push("\\text{over the last } N = " + netEffectWindowTicks + "\\text{ ticks}");
    return lines;
};

var getSecondaryEquation = () => {
    let lines = isEquationPanelPressed ? getAverageExplanationLines() : getMainSecondaryLines();
    theory.secondaryEquationHeight = 40 * lines.length + 20;
    return "\\begin{array}{c}" + lines.join("\\\\") + "\\end{array}";
};

// r dot factor, with an optional subscript for the i-th draw: X_i or (X_i + Y_i).
var getRFactorText = (subscript) => isYActive() ? "(X" + subscript + " + Y" + subscript + ")" : "X" + subscript;

// Indicator function 1_{condition}: 1 if the condition holds, 0 otherwise.
var getIndicatorText = (conditionText) => "\\mathbf{1}_{" + conditionText + "}";

// Plain decimals for small values, e-notation once Z grows with sigma.
var NET_EFFECT_DECIMAL_LIMIT = BigNumber.from(1e4);
var formatNetEffect = (value) =>
    value.abs() < NET_EFFECT_DECIMAL_LIMIT ? value.toNumber().toFixed(3) : value.toString(3);

// Net effect during the last N ticks, "-" before the first tick.
var getNetEffectText = (netEffectWindow) => {
    let netEffect = getNetEffect(netEffectWindow);
    return netEffect === null ? "-" : formatNetEffect(netEffect);
};

// tau formula followed by the random values drawn in the last tick.
var getTertiaryEquation = () => {
    let parts = [theory.latexSymbol + "=\\max\\rho^{" + TAU_EXPONENT + "}", "X = " + lastX.toFixed(2)];
    if (isYActive()) parts.push("Y = " + lastY.toFixed(2));
    if (isZActive()) parts.push("Z = " + lastZ.toString(2));
    return parts.join(",\\; ");
};

var getQuaternaryEntries = () => {
    quaternaryEntries[0].value = rhoDot.toString(2);
    quaternaryEntries[1].value = q.toString(2);
    quaternaryEntries[2].value = r.toString(2);
    quaternaryEntries[3].value = isZActive() ? z.toString(2) : "-";
    quaternaryEntries[4].value = getNetEffectText(xWindow);
    quaternaryEntries[5].value = isZActive() ? getNetEffectText(zWindow) : "-";
    quaternaryEntries[6].value = isWActive() ? formatNetEffect(BigNumber.from(getWHat())) : "-";
    return quaternaryEntries;
};

// =============================================================================
// PUBLICATION & TAU
// =============================================================================

var getPublicationMultiplier = (tau) => tau.pow(PUBLICATION_EXPONENT);
var getPublicationMultiplierFormula = (symbol) => symbol + "^{" + PUBLICATION_EXPONENT + "}";
var getTau = () => currency.value.pow(BigNumber.from(TAU_EXPONENT));
var getCurrencyFromTau = (tau) => [tau.max(BigNumber.ONE).pow(1 / TAU_EXPONENT), currency.symbol];
var get2DGraphValue = () => currency.value.sign * (BigNumber.ONE + currency.value.abs()).log10().toNumber();

init();
