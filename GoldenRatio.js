import { CustomCost, ExponentialCost, FirstFreeCost, FreeCost } from "./api/Costs";
import { Localization } from "./api/Localization";
import { BigNumber, parseBigNumber } from "./api/BigNumber";
import { QuaternaryEntry, theory } from "./api/Theory";
import { Utils } from "./api/Utils";

// Exponential Idle custom theories must be a single file, so the code is
// structured into small, clearly separated helper functions instead of modules.

requiresGameVersion("1.4.33");

var id = "golden_ratio";
// The development version in the name is bumped on every change so the loaded build is identifiable
// in game. The game requires `name` to be a plain string literal.
var name = "Golden Ratio v0.17";
var description =
    "The golden ratio φ = (1 + √5)/2 is the positive root of h(x) = x² − x − 1. " +
    "In this theory you chase φ in three different ways: through ratios of consecutive " +
    "Fibonacci numbers, through Newton's method applied to h, and through Euler's product for cos(π/5) = φ/2 " +
    "that slowly pushes the exponent a towards φ itself.";
var authors = "herbo.j";
var version = 1;

// =============================================================================
// BALANCING CONSTANTS
// All tunable numbers live here. Costs are given as log10 of rho.
// =============================================================================

var TAU_EXPONENT = 0.4;                 // tau = rho^0.4
var A_BASE = 1.6;                       // initial exponent a
var P_BASE = 1;                         // initial exponent p
// p after each p milestone level (PLACEHOLDER, to be balanced). One entry per P_UNLOCK_RHO_LOG10 entry.
var P_MILESTONE_VALUES = [1.06, 1.10, 1.15];

// Index of the Euler product at upgrade level 0.
//   0: l starts at 0. P_1 = 0.84 gives a = 1.595 < 1.6, so the first purchase has no effect.
//   1: l starts at 1. The first purchase already raises a to 1.606.
var EULER_PRODUCT_START_INDEX = 0;

// Milestone costs: rho thresholds (log10) at which each milestone point is earned.
var MILESTONE_RHO_LOG10 = [10, 50, 200, 250, 700, 800, 950];

// Permanent upgrades that unlock milestones (log10 of rho).
var P_UNLOCK_RHO_LOG10 = [100, 400, 600];
var F_UNLOCK_RHO_LOG10 = 50;            // f milestone becomes available at this rho (via tau)
var N_UNLOCK_RHO_LOG10 = 250;           // n milestone becomes available at this rho (via tau)
var L_UNLOCK_RHO_LOG10 = 950;           // l milestone becomes available at this rho (via tau)

// q1 = getStepwisePowerSum(level, 76, 25, 0): each level adds 76^floor(level / 25).
// Buying at level 0 mod 25 multiplies q1 by ~4, buying at 24 mod 25 by ~1.04, a full cycle by 76.
var Q1_STEPWISE = { base: 76, length: 50 };

// Regular upgrade costs: cost(level) = 10^(base + step * level).
// PLACEHOLDERS - balanced with the Python sim (sim/theories/golden_ratio/config.py), keep both in sync.
var Q1_COST = { base: 1,    step: 0.6 };
var Q2_COST = { base: 1.5,  step: 0.923 };
var F_COST  = { base: 45,   step: 1.52 };
var M_COST  = { base: 9,    step: 3.0 };
var N_COST  = { base: 250,  step: 60 };
var L_COST  = { base: 920,  step: 30 };  // e920, e950, e980, ... -> l = 2 right at the l milestone
// l is capped: from level ~97 (l ~ 7e14) a = phi in double precision, and at level 100 l ~ 1.5e15
// is still below 2^53, so l stays an exact integer.
var L_MAX_LEVEL = 100;

var FINISH_RHO_LOG10 = 1500;            // the final story chapter unlocks at this rho

// =============================================================================
// STORY
// Each chapter's text is a list of paragraphs, joined with blank lines.
// =============================================================================

var STORY_CHAPTERS = [
    {
        title: "A golden opportunity",
        paragraphs: [
            "Your professor slides a dusty envelope across the desk.",
            "\"A colleague of mine spent his whole life on a single number,\" she says. \"He never finished. Perhaps you will.\"",
            "Inside, scribbled in faded ink: x² − x − 1.",
            "Its positive root is called φ, the golden ratio. Artists, architects and botanists have chased it for millennia.",
            "You decide to chase it too. Start simple: grow ρ, and see where it leads."
        ]
    },
    {
        title: "A continued fraction",
        paragraphs: [
            "Late one night you rearrange the equation: φ = 1 + 1/φ.",
            "Then you substitute φ into itself. Again. And again.",
            "φ = 1 + 1/(1 + 1/(1 + 1/(1 + ...)))",
            "The simplest continued fraction there is: nothing but ones, all the way down.",
            "Each cut-off gives a better approximation. You add it to your equation and r starts to grow."
        ]
    },
    {
        title: "Breeding rabbits",
        paragraphs: [
            "Writing out the truncated fractions, you notice a pattern: 1/1, 2/1, 3/2, 5/3, 8/5, 13/8, ...",
            "These numbers look familiar. In the library you find a book from 1202 by Leonardo da Pisa, better known as Fibonacci.",
            "He asked how many pairs of rabbits there would be if every pair breeds a new pair each month, starting from its second month.",
            "The ratio of consecutive terms approaches φ, but the terms itself are growing fast, so you add them to your equation.",
            "Soon your desk is covered in rabbits. Figuratively, you hope."
        ]
    },
    {
        title: "Getting tangentially closer...",
        paragraphs: [
            "The continued fraction and Fibonacci ratios converge, but slowly. Too slowly for your taste.",
            "You remember a trick from your first calculus lecture: Newton's method.",
            "Draw the tangent to h(x) = x² − x − 1, follow it down to the x-axis, and repeat.",
            "Starting from x₀ = 2, each step roughly doubles the number of correct digits.",
            "Curiously, every Newton step lands exactly on a ratio of Fibonacci numbers. The rabbits are everywhere."
        ]
    },
    {
        title: "Stroke of genius",
        paragraphs: [
            "For weeks you have been stuck.",
            "Then you realize the exponent a is close to the golden ratio as well, maybe you should starting growing it, too!",
            "Flipping through Euler's collected works, you find it: an infinite product for the cosine.",
            "And cos(π/5) is exactly φ/2.",
            "The pentagon, the five-pointed star, the golden ratio: it was all connected from the start.",
            "With every new factor, the exponent a creeps closer to φ itself."
        ]
    },
    {
        title: "The End",
        paragraphs: [
            "You return to your professor's office with a thick stack of paper.",
            "Continued fractions, Fibonacci's rabbits, Newton's tangents and Euler's product. Four roads, one destination.",
            "1.6180339887 4989484820 4586834365",
            "6381177203 0917980576 2862135448...",
            "She reads in silence, then smiles. \"He would have been proud.\"",
            "φ is irrational, so you will never write it down completely. But you have come closer than anyone before you.",
            "Perhaps that is the most golden thing of all.",
            "The End."
        ]
    }
];

// Unlock condition per chapter, in the same order as STORY_CHAPTERS.
// The game evaluates them later, so the milestones exist by then.
var getStoryUnlockConditions = () => [
    () => true,
    () => hasReachedRho(MILESTONE_RHO_LOG10[0]),   // rho of the first milestone, as it is easy to forget to buy
    () => fMilestone.level > 0,
    () => nMilestone.level > 0,
    () => lMilestone.level > 0,
    () => hasReachedRho(FINISH_RHO_LOG10)
];

var createStoryChapters = () => {
    let unlockConditions = getStoryUnlockConditions();
    STORY_CHAPTERS.forEach((chapter, index) =>
        theory.createStoryChapter(index, chapter.title, chapter.paragraphs.join("\n\n"), unlockConditions[index]));
};

// =============================================================================
// MATH CONSTANTS
// =============================================================================

var PHI = (1 + Math.sqrt(5)) / 2;
var LN_PHI = Math.log(PHI);
var LN_5 = Math.log(5);
var SQRT_5 = Math.sqrt(5);
var MAX_EXACT_FIBONACCI_INDEX = 70;     // F(70) < 2^53, so doubles are exact up to here

// =============================================================================
// STATE
// =============================================================================

var currency;
var q = BigNumber.ZERO;                 // q dot = q1 q2
var r = BigNumber.ONE;
var s = BigNumber.ONE;
var rhoDot = BigNumber.ZERO;            // last computed rho dot, for display
var quaternaryEntries;

// regular upgrades
var q1, q2, f, m, n, l;
// developer speed-up (remove before release)
var mDev;
// permanent upgrades
var pUnlockPerm;
// milestone upgrades
var fMilestone, mMilestone, pMilestone, nMilestone, lMilestone;

// =============================================================================
// COST HELPERS
// =============================================================================

var tenToThe = (log10Value) => BigNumber.TEN.pow(BigNumber.from(log10Value));

// Formats a plain JS integer like a BigNumber, so large values switch to e-notation (e.g. e6).
var formatInteger = (value) => BigNumber.from(value).toString(0);

// cost(level) = 10^(base + step * level), expressed as the built-in ExponentialCost
// (base * 2^(progress * level)). Unlike a CustomCost, the game can solve it for the max affordable
// level, so variables are not limited by the brute-force search of CustomCost.
var exponentialCostLog10 = (costSpec) =>
    new ExponentialCost(tenToThe(costSpec.base), costSpec.step * Math.log2(10));

var listCostLog10 = (log10Values) =>
    new CustomCost((level) => tenToThe(log10Values[Math.min(level, log10Values.length - 1)]));

// =============================================================================
// FIBONACCI HELPERS
// =============================================================================

// Exact Fibonacci number as a JS number, F(1) = F(2) = 1. Only for small indices.
var fibonacciNumber = (index) => {
    let previous = 0;
    let current = 1;
    for (let i = 1; i < index; i++) {
        let next = previous + current;
        previous = current;
        current = next;
    }
    return index <= 0 ? 0 : current;
};

// Fibonacci number as BigNumber. Uses Binet's formula for large indices.
var fibonacci = (index) => {
    if (index <= MAX_EXACT_FIBONACCI_INDEX) return BigNumber.from(fibonacciNumber(index));
    return BigNumber.from(PHI).pow(index) / BigNumber.from(SQRT_5);
};

// ln F(N) as BigNumber. N is passed as log2(N) so that huge N (2^1000+) stay representable.
var logFibonacciOfPowerOfTwo = (log2Index) => {
    if (Math.pow(2, log2Index) <= MAX_EXACT_FIBONACCI_INDEX)
        return BigNumber.from(Math.log(fibonacciNumber(Math.pow(2, log2Index))));
    // ln F(N) = N ln(phi) - ln(sqrt 5) up to an error of order phi^(-2N)
    return BigNumber.TWO.pow(log2Index) * BigNumber.from(LN_PHI) - BigNumber.from(LN_5 / 2);
};

// =============================================================================
// VARIABLE VALUES
// =============================================================================

var getQ1 = (level) => Utils.getStepwisePowerSum(level, Q1_STEPWISE.base, Q1_STEPWISE.length, 0);
var getQ2 = (level) => BigNumber.TWO.pow(level);

var getM = (level) => level + 1;        // m starts at 1 (avoids division by F(0) = 0)
var getN = (level) => level;            // n = number of Newton steps, x_0 = 2 gives Q = 0
// Stepwise: +1 per level for 4 levels, then +4, +16, ... -> 0, 1, 2, 3, 4, 8, 12, 16, 20, 36, 52, ...
// Rounded because the BigNumber -> number conversion can be slightly off (e.g. 0.9999999),
// and l is used as an array index into the Euler product cache.
var getL = (level) => Math.round(Utils.getStepwisePowerSum(level, 4, 4, 0).toNumber()) + EULER_PRODUCT_START_INDEX;

// f runs through the Fibonacci sequence, f = F(level + 1): 1, 1, 2, 3, 5, 8, ...
var getF = (level) => fibonacci(level + 1);

// r dot = L(F(m+1)/F(m)) with L(x) = 1/|h(x)|, h(x) = x^2 - x - 1.
// Cassini's identity gives h(F(m+1)/F(m)) = (-1)^m / F(m)^2, hence L = F(m)^2 exactly.
// (Evaluating h numerically would suffer from catastrophic cancellation.)
var getRDot = (level) => {
    let fm = fibonacci(getM(level));
    return fm * fm;
};

// s dot = Q(x_n) with Q(x) = -ln h(x), where x_n is the n-th Newton iterate for h starting at x_0 = 2.
// The Newton iterates are x_n = F(N+1)/F(N) with N = 2^(n+1) (always even),
// so h(x_n) = 1/F(N)^2 and Q(x_n) = 2 ln F(2^(n+1)), which doubles every step.
var getSDot = (level) => BigNumber.TWO * logFibonacciOfPowerOfTwo(getN(level) + 1);

// =============================================================================
// EXPONENTS
// =============================================================================

// Euler's product cos(x) = prod_{i>=1} (1 - 4x^2 / (pi^2 (2i-1)^2)).
// With x = pi/5, pi cancels: P_l = prod_{i=1}^{l} (1 - 4 / (25 (2i-1)^2)) -> cos(pi/5) = phi/2.
// The partial products decrease towards phi/2, so a = 1 + 1/(2 P_l) increases towards phi.
var getEulerProductFactor = (index) => 1 - 4 / (25 * (2 * index - 1) * (2 * index - 1));

// Up to this index the product is computed exactly (extended incrementally and cached, since getA()
// is evaluated every tick). Beyond it, l grows x4 every 4 levels, so a loop would exceed the game's
// statement limit; the closed-form tail below is accurate to ~1e-10 there.
var EULER_PRODUCT_EXACT_MAX_INDEX = 100;
var eulerProductCache = [1];

var getExactEulerProduct = (index) => {
    while (eulerProductCache.length <= index) {
        let nextIndex = eulerProductCache.length;
        eulerProductCache.push(eulerProductCache[nextIndex - 1] * getEulerProductFactor(nextIndex));
    }
    return eulerProductCache[index];
};

// P_N = cos(pi/5) / prod_{i>N} (1 - z^2/(i-1/2)^2) ~ cos(pi/5) * exp(z^2 * psi'(N + 1/2)), z = 1/5,
// with the trigamma function psi'(M) ~ 1/M + 1/(2M^2) + 1/(6M^3).
var getAsymptoticEulerProduct = (index) => {
    let shifted = index + 0.5;
    let trigamma = 1 / shifted + 1 / (2 * shifted * shifted) + 1 / (6 * shifted * shifted * shifted);
    return Math.cos(Math.PI / 5) * Math.exp(trigamma / 25);
};

var getEulerProduct = (index) =>
    index <= EULER_PRODUCT_EXACT_MAX_INDEX ? getExactEulerProduct(index) : getAsymptoticEulerProduct(index);

// a = 1 + 1/(2 P_l) -> 1 + 1/phi = phi, never below the base value 1.6, for QoL (can idle buy at e920 during recovery)
var getA = () => {
    if (lMilestone.level == 0) return A_BASE;
    return Math.max(A_BASE, 1 + 1 / (2 * getEulerProduct(getL(l.level))));
};

var getPAtLevel = (milestoneLevel) => milestoneLevel == 0 ? P_BASE : P_MILESTONE_VALUES[milestoneLevel - 1];
var getP = () => getPAtLevel(pMilestone.level);

// p after the next p milestone level, capped at the last one (for upgrade descriptions)
var getNextPText = (milestoneLevel) =>
    getPAtLevel(Math.min(milestoneLevel + 1, P_MILESTONE_VALUES.length)).toFixed(2);

// DEVELOPER SPEED-UP (remove before release): free rho dot multiplier with a reset button.
var M_DEV_BASE = 10;                     // m_dev = 10^level
var M_DEV_MAX_LEVEL = 100;               // 10^100
var getMDev = (level) => BigNumber.from(M_DEV_BASE).pow(level);

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

var createMilestone = (upgradeId, maxLevel, getDescription, getInfo) => {
    let milestone = theory.createMilestoneUpgrade(upgradeId, maxLevel);
    milestone.getDescription = getDescription;
    milestone.getInfo = getInfo;
    milestone.boughtOrRefunded = (_) => onStructureChanged();
    return milestone;
};

var createUnlockPerm = (upgradeId, costsLog10, getDescription, getInfo) => {
    let perm = theory.createPermanentUpgrade(upgradeId, currency, listCostLog10(costsLog10));
    perm.maxLevel = costsLog10.length;
    perm.getDescription = getDescription;
    perm.getInfo = getInfo;
    perm.boughtOrRefunded = (_) => onStructureChanged();
    return perm;
};

var onStructureChanged = () => {
    updateAvailability();
    theory.invalidatePrimaryEquation();
    theory.invalidateSecondaryEquation();
    theory.invalidateQuaternaryValues();
};

// =============================================================================
// INIT
// =============================================================================

var init = () => {
    currency = theory.createCurrency();

    // Regular upgrades
    q1 = createVariable(0, new FirstFreeCost(exponentialCostLog10(Q1_COST)), "q_1", (lv) => getQ1(lv).toString(0));
    q2 = createVariable(1, exponentialCostLog10(Q2_COST), "q_2", (lv) => "2^{" + lv + "}");
    m  = createVariable(3, exponentialCostLog10(M_COST), "m", (lv) => formatInteger(getM(lv)));
    f  = createVariable(2, exponentialCostLog10(F_COST), "f", (lv) => getF(lv).toString(0));
    n  = createVariable(4, exponentialCostLog10(N_COST), "n", (lv) => formatInteger(getN(lv)));
    l  = createVariable(5, exponentialCostLog10(L_COST), "l", (lv) => formatInteger(getL(lv)));
    l.maxLevel = L_MAX_LEVEL;

    // DEVELOPER SPEED-UP (remove before release). Excluded from the autobuyer and capped,
    // since a free upgrade would otherwise be bought without limit.
    mDev = createVariable(99, new FreeCost(), "m_{dev}", (lv) => M_DEV_BASE + "^{" + lv + "}");
    mDev.isAutoBuyable = false;
    mDev.maxLevel = M_DEV_MAX_LEVEL;
    mDev.boughtOrRefunded = (_) => theory.invalidatePrimaryEquation();

    //free button resets m_dev to level 0 (value 1) and itself.
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

    pUnlockPerm = createUnlockPerm(3, P_UNLOCK_RHO_LOG10,
        (_) => "Unlock $p$ milestone lv " + Math.min(pUnlockPerm.level + 1, P_UNLOCK_RHO_LOG10.length),
        (_) => "Milestone: $p \\to " + getNextPText(pUnlockPerm.level) + "$");

    // Milestones (cost is log10 of tau)
    theory.setMilestoneCost(new CustomCost((total) => BigNumber.from(TAU_EXPONENT * getMilestoneRhoLog10(total))));

    mMilestone = createMilestone(1, 1,
        (_) => "Unlock continued fraction via $m$",
        (_) => "Enables $\\dot{r}$");
    fMilestone = createMilestone(0, 1,
        (_) => "Unlock $f$",
        (_) => "Adds the Fibonacci variable $f$");
    pMilestone = createMilestone(2, P_UNLOCK_RHO_LOG10.length,
        (_) => "$\\uparrow p$",
        (_) => "$p \\to " + getNextPText(pMilestone.level) + "$");
    nMilestone = createMilestone(3, 1,
        (_) => "Unlock Newton iteration via $n$",
        (_) => "Enables $\\dot{s}$");
    lMilestone = createMilestone(4, 1,
        (_) => "Unlock $l$",
        (_) => "$a$ converges to $\\varphi$");

    createStoryChapters();

    quaternaryEntries = [
        new QuaternaryEntry("\\dot{\\rho}", null),
        new QuaternaryEntry("q", null),
        new QuaternaryEntry("r", null),
        new QuaternaryEntry("s", null)
    ];

    updateAvailability();
};

var getMilestoneRhoLog10 = (total) =>
    total < MILESTONE_RHO_LOG10.length ? MILESTONE_RHO_LOG10[total] : 1e6;

var updateAvailability = () => {
    f.isAvailable = fMilestone.level > 0;
    m.isAvailable = mMilestone.level > 0;
    n.isAvailable = nMilestone.level > 0;
    l.isAvailable = lMilestone.level > 0;

    pMilestone.maxLevel = pUnlockPerm.level;
    pMilestone.isAvailable = pUnlockPerm.level > 0;
    fMilestone.isAvailable = hasReachedRho(F_UNLOCK_RHO_LOG10);
    nMilestone.isAvailable = hasReachedRho(N_UNLOCK_RHO_LOG10);
    lMilestone.isAvailable = hasReachedRho(L_UNLOCK_RHO_LOG10);
};

// Whether the best rho ever reached in this theory (tau = rho^TAU_EXPONENT) is at least 10^rhoLog10.
var hasReachedRho = (rhoLog10) => theory.tau >= tenToThe(TAU_EXPONENT * rhoLog10);

// =============================================================================
// GAME LOOP
// =============================================================================

var tick = (elapsedTime, multiplier) => {
    let dt = BigNumber.from(elapsedTime * multiplier);
    let bonus = theory.publicationMultiplier;

    q += getQ1(q1.level) * getQ2(q2.level) * dt;
    if (mMilestone.level > 0) r += getRDot(m.level) * dt;
    if (nMilestone.level > 0) s += getSDot(n.level) * dt;

    let qTerm = q.pow(BigNumber.from(getA()));
    let fTerm = fMilestone.level > 0 ? getF(f.level) : BigNumber.ONE;
    let rsTerm = (r * s).pow(BigNumber.from(getP()));

    rhoDot = bonus * qTerm * fTerm * rsTerm * getMDev(mDev.level);
    currency.value += dt * rhoDot;

    updateAvailability();
    theory.invalidateSecondaryEquation();
    theory.invalidateQuaternaryValues();
};

var postPublish = () => {
    q = BigNumber.ZERO;
    r = BigNumber.ONE;
    s = BigNumber.ONE;
};

var getInternalState = () => `${r} ${s} ${q}`;

var setInternalState = (state) => {
    let values = state.split(" ");
    if (values.length > 0) r = parseBigNumber(values[0]);
    if (values.length > 1) s = parseBigNumber(values[1]);
    if (values.length > 2) q = parseBigNumber(values[2]);
};

// =============================================================================
// EQUATIONS
// =============================================================================

var getPrimaryEquation = () => {
    theory.primaryEquationHeight = 50;
    let result = "\\dot{\\rho} = fq^{a}";
    result += pMilestone.level > 0 ? "(rs)^{" + getP().toFixed(2) + "}" : "rs";
    return result;
};

var getSecondaryEquation = () => {
    let lines = ["\\dot{q} = q_1 q_2,\\; a = " + (l.level > (1 - EULER_PRODUCT_START_INDEX) ? getA().toFixed(5) : getA().toFixed(1))];
    if (fMilestone.level > 0) lines.push("f_{i+1} = f_i + f_{i-1}");
    if (mMilestone.level > 0)
        lines.push("\\dot{r} = L\\left(\\frac{F_{m+1}}{F_m}\\right),\\; L(x) = \\frac{1}{|h(x)|}");
    if (nMilestone.level > 0) {
        lines.push("\\dot{s} = Q(x_n),\\; Q(x) = -\\ln h(x)");
        lines.push("x_{n+1} = x_n - \\frac{h(x_n)}{h'(x_n)},\\; x_0 = 2");
    }
    if (mMilestone.level > 0 || nMilestone.level > 0) lines.push("h(x) = x^2 - x - 1");
    if (lMilestone.level > 0)
        lines.push("a = 1 + \\frac{1}{2P_l},\\; P_l = \\prod_{i=1}^{l} \\left(1 - \\frac{4}{25(2i-1)^2}\\right)");

    theory.secondaryEquationHeight = 30 + 35 * lines.length;
    return "\\begin{array}{c}" + lines.join("\\\\") + "\\end{array}";
};

var getTertiaryEquation = () => theory.latexSymbol + "=\\max\\rho^{" + TAU_EXPONENT + "}";

var getQuaternaryEntries = () => {
    quaternaryEntries[0].value = rhoDot.toString(2);
    quaternaryEntries[1].value = q.toString(2);
    quaternaryEntries[2].value = r.toString(2);
    quaternaryEntries[3].value = s.toString(2);
    return quaternaryEntries;
};

// =============================================================================
// PUBLICATION & TAU
// =============================================================================

var getPublicationMultiplier = (tau) => tau.pow(0.15);   // PLACEHOLDER, to be balanced
var getPublicationMultiplierFormula = (symbol) => symbol + "^{0.15}";
var getTau = () => currency.value.pow(BigNumber.from(TAU_EXPONENT));
var getCurrencyFromTau = (tau) => [tau.max(BigNumber.ONE).pow(1 / TAU_EXPONENT), currency.symbol];
var get2DGraphValue = () => currency.value.sign * (BigNumber.ONE + currency.value.abs()).log10().toNumber();

init();
