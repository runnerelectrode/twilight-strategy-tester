/**
 * Twilight DEX Strategy Calculator
 *
 * Pure calculation functions extracted from TwilightTradingVisualizerLive.jsx.
 * All functions are stateless — pass market params explicitly.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

export const TWILIGHT_FEE = 0;               // 0% trading fee on Twilight
export const BINANCE_TAKER_FEE = 0.0004;     // 0.04% Binance futures taker fee
export const BINANCE_MAKER_FEE = 0.0002;     // 0.02% Binance futures maker fee
export const BYBIT_TAKER_FEE = 0.00055;      // 0.055% Bybit inverse taker fee
export const TWILIGHT_FUNDING_PSI = 1.0;     // Sensitivity parameter
export const TWILIGHT_FUNDING_SCALE = 100;   // Scale factor (formula was 100x too large otherwise)
export const TWILIGHT_MAINT_MARGIN = 0.005;  // 0.5% maintenance margin
export const BINANCE_MAINT_MARGIN = 0.004;   // 0.4% maintenance margin

/** Default market parameters used when none are supplied */
export const DEFAULT_PARAMS = {
  twilightPrice: 84695,
  cexPrice: 84670,
  bybitPrice: 0,
  binanceFundingRate: 0.0001,
  bybitFundingRate: 0.0001,
  tvl: 300,
  twilightLongSize: 0,
  twilightShortSize: 0,
  twilightFundingCapPct: 0,
  pegTwilightToCapRate: false,
};

// ─── Core Funding Rate Calculations ──────────────────────────────────────────

/**
 * Calculate the Twilight funding rate from pool open-interest imbalance.
 *
 * Formula: imbalance² / (psi × 8 × scale)
 * Sign: positive = longs pay, negative = shorts pay.
 *
 * @param {number} longSize  - Pool long OI in USD
 * @param {number} shortSize - Pool short OI in USD
 * @returns {number} Funding rate per 8 h (decimal)
 */
export function calculateTwilightFundingRate(longSize, shortSize) {
  const allPositionSize = longSize + shortSize;
  if (allPositionSize === 0) return 0;
  const imbalance = (longSize - shortSize) / allPositionSize;
  const fundingRate = Math.pow(imbalance, 2) / (TWILIGHT_FUNDING_PSI * 8.0 * TWILIGHT_FUNDING_SCALE);
  return imbalance >= 0 ? fundingRate : -fundingRate;
}

/**
 * Apply a percentage cap on the Twilight funding rate relative to Binance.
 *
 * @param {number} rawTwilight - Raw Twilight funding rate
 * @param {number} binanceRate - Binance funding rate (same sign convention)
 * @param {number} capPct      - Cap as % of Binance rate (0 = no cap)
 * @returns {number} Capped Twilight funding rate
 */
export function applyTwilightFundingCap(rawTwilight, binanceRate, capPct) {
  if (capPct <= 0) return rawTwilight;
  const capValue = (capPct / 100) * binanceRate;
  if (binanceRate >= 0) return rawTwilight > capValue ? capValue : rawTwilight;
  return rawTwilight < capValue ? capValue : rawTwilight;
}

/**
 * Resolve the effective Twilight funding rate given cap/peg settings.
 *
 * @param {object} p
 * @param {number} p.longSize
 * @param {number} p.shortSize
 * @param {number} p.binanceFundingRate
 * @param {number} p.twilightFundingCapPct
 * @param {boolean} p.pegTwilightToCapRate
 * @returns {number} Effective funding rate per 8 h
 */
export function resolveEffectiveTwilightRate({
  longSize, shortSize, binanceFundingRate, twilightFundingCapPct, pegTwilightToCapRate,
}) {
  const raw = calculateTwilightFundingRate(longSize, shortSize);
  if (pegTwilightToCapRate && twilightFundingCapPct > 0) {
    return (twilightFundingCapPct / 100) * binanceFundingRate;
  }
  return applyTwilightFundingCap(raw, binanceFundingRate, twilightFundingCapPct);
}

// ─── Trade Impact ─────────────────────────────────────────────────────────────

/**
 * Compute the effect of a new trade on pool skew and funding rate.
 *
 * @param {object} p
 * @param {number}          p.tradeSize           - USD value of the trade
 * @param {'LONG'|'SHORT'}  p.direction           - Trade direction
 * @param {number}          p.longSize            - Current pool long OI
 * @param {number}          p.shortSize           - Current pool short OI
 * @param {number}          p.binanceFundingRate
 * @param {number}          p.twilightFundingCapPct
 * @param {boolean}         p.pegTwilightToCapRate
 * @returns {object} Trade impact metrics
 */
export function calculateTradeImpact({
  tradeSize, direction, longSize, shortSize,
  binanceFundingRate, twilightFundingCapPct, pegTwilightToCapRate,
}) {
  const newLongs = direction === 'LONG' ? longSize + tradeSize : longSize;
  const newShorts = direction === 'SHORT' ? shortSize + tradeSize : shortSize;
  const totalSize = newLongs + newShorts;

  if (totalSize === 0) {
    return {
      newSkew: 0.5, newLongs: 0, newShorts: 0, skewChange: 0,
      newFundingRate: 0, annualizedAPY: 0,
      youPay: false, youEarn: false, helpsBalance: false,
    };
  }

  const currentSkew = (longSize + shortSize) > 0
    ? longSize / (longSize + shortSize)
    : 0.5;
  const newSkew = newLongs / totalSize;
  const skewChange = newSkew - currentSkew;

  const imbalance = (newLongs - newShorts) / totalSize;
  const raw = Math.pow(imbalance, 2) / (TWILIGHT_FUNDING_PSI * 8.0 * TWILIGHT_FUNDING_SCALE);
  const signed = imbalance >= 0 ? raw : -raw;

  const newFundingRate = (pegTwilightToCapRate && twilightFundingCapPct > 0)
    ? (twilightFundingCapPct / 100) * binanceFundingRate
    : applyTwilightFundingCap(signed, binanceFundingRate, twilightFundingCapPct);

  const annualizedAPY = Math.abs(newFundingRate) * 3 * 365 * 100;
  const longsDominate = newSkew > 0.5;
  const youPay = direction === 'LONG' && longsDominate;
  const youEarn = direction === 'SHORT' && longsDominate;
  const helpsBalance = (direction === 'LONG' && currentSkew < 0.5)
    || (direction === 'SHORT' && currentSkew > 0.5);

  return {
    newSkew, newLongs, newShorts, skewChange,
    newFundingRate, annualizedAPY,
    youPay, youEarn, helpsBalance,
  };
}

// ─── Per-strategy P&L Calculator ─────────────────────────────────────────────

/**
 * Calculate detailed APY and risk metrics for a single Twilight/Binance strategy.
 *
 * @param {object} strategy - Strategy definition (positions, sizes, leverage)
 * @param {object} ctx      - Market context
 * @param {number} ctx.twilightPrice
 * @param {number} ctx.cexPrice
 * @param {number} ctx.binanceFundingRate
 * @param {number} ctx.twilightFundingRate  - Already-resolved effective rate
 * @param {number} ctx.spread              - twilightPrice − cexPrice
 * @returns {object} Full strategy metrics
 */
export function calculateStrategyAPY(strategy, ctx) {
  const {
    twilightPosition, twilightSize = 0, twilightLeverage = 0,
    binancePosition, binanceSize = 0, binanceLeverage = 0,
  } = strategy;
  const { twilightPrice, cexPrice, binanceFundingRate, twilightFundingRate, spread } = ctx;

  // ── Margin ────────────────────────────────────────────────────────────────
  const twilightMarginBTC = twilightSize > 0
    ? twilightSize / (twilightLeverage * twilightPrice)
    : 0;
  const twilightMarginUSD = twilightMarginBTC * twilightPrice;
  const binanceMarginUSDT = binanceSize > 0 ? binanceSize / binanceLeverage : 0;
  const totalMarginUSD = twilightMarginUSD + binanceMarginUSDT;

  if (totalMarginUSD === 0) {
    return {
      apy: 0, dailyPnL: 0, monthlyPnL: 0,
      totalMargin: 0, twilightMarginBTC: 0, twilightMarginUSD: 0, binanceMarginUSDT: 0,
      totalFees: 0, basisProfit: 0, monthlyFundingPnL: 0,
      twilightLiquidationPrice: null, twilightLiquidationPct: null,
      binanceLiquidationPrice: null, binanceLiquidationPct: null,
      twilightStopLoss: null, twilightStopLossPct: null,
      binanceStopLoss: null, binanceStopLossPct: null,
      totalMaxLoss: 0, breakEvenDays: null,
      marketDirection: 'NEUTRAL', directionDescription: '',
      pnlUp5: 0, pnlDown5: 0, pnlUp10: 0, pnlDown10: 0,
      priceOnlyUp5: 0, priceOnlyDown5: 0, priceOnlyUp10: 0, priceOnlyDown10: 0,
      marginChangeUp5: 0, marginChangeDown5: 0, marginChangeUp10: 0, marginChangeDown10: 0,
      apyUp5: 0, apyDown5: 0, breakEvenPriceMove: 0, targetTwilightRatePct: null,
    };
  }

  // ── Liquidation prices ────────────────────────────────────────────────────
  let twilightLiquidationPrice = null;
  let twilightLiquidationPct = null;
  if (twilightPosition === 'LONG' && twilightLeverage > 0) {
    twilightLiquidationPrice = twilightPrice * twilightLeverage
      / (twilightLeverage + 1 - twilightLeverage * TWILIGHT_MAINT_MARGIN);
    twilightLiquidationPct = ((twilightPrice - twilightLiquidationPrice) / twilightPrice) * 100;
  } else if (twilightPosition === 'SHORT' && twilightLeverage > 1) {
    twilightLiquidationPrice = twilightPrice * twilightLeverage
      / (twilightLeverage - 1 + twilightLeverage * TWILIGHT_MAINT_MARGIN);
    twilightLiquidationPct = ((twilightLiquidationPrice - twilightPrice) / twilightPrice) * 100;
  }

  let binanceLiquidationPrice = null;
  let binanceLiquidationPct = null;
  if (binancePosition === 'LONG' && binanceLeverage > 0) {
    binanceLiquidationPrice = cexPrice * (1 - (1 - BINANCE_MAINT_MARGIN) / binanceLeverage);
    binanceLiquidationPct = ((cexPrice - binanceLiquidationPrice) / cexPrice) * 100;
  } else if (binancePosition === 'SHORT' && binanceLeverage > 0) {
    binanceLiquidationPrice = cexPrice * (1 + (1 - BINANCE_MAINT_MARGIN) / binanceLeverage);
    binanceLiquidationPct = ((binanceLiquidationPrice - cexPrice) / cexPrice) * 100;
  }

  // ── Stop losses (50% to liquidation) ─────────────────────────────────────
  let twilightStopLoss = null;
  let twilightStopLossPct = null;
  if (twilightLiquidationPrice && twilightPosition === 'LONG') {
    twilightStopLoss = twilightPrice - (twilightPrice - twilightLiquidationPrice) * 0.5;
    twilightStopLossPct = ((twilightPrice - twilightStopLoss) / twilightPrice) * 100;
  } else if (twilightLiquidationPrice && twilightPosition === 'SHORT') {
    twilightStopLoss = twilightPrice + (twilightLiquidationPrice - twilightPrice) * 0.5;
    twilightStopLossPct = ((twilightStopLoss - twilightPrice) / twilightPrice) * 100;
  }

  let binanceStopLoss = null;
  let binanceStopLossPct = null;
  if (binanceLiquidationPrice && binancePosition === 'LONG') {
    binanceStopLoss = cexPrice - (cexPrice - binanceLiquidationPrice) * 0.5;
    binanceStopLossPct = ((cexPrice - binanceStopLoss) / cexPrice) * 100;
  } else if (binanceLiquidationPrice && binancePosition === 'SHORT') {
    binanceStopLoss = cexPrice + (binanceLiquidationPrice - cexPrice) * 0.5;
    binanceStopLossPct = ((binanceStopLoss - cexPrice) / cexPrice) * 100;
  }

  const twilightMaxLoss = twilightStopLossPct ? (twilightStopLossPct / 100) * twilightSize : 0;
  const binanceMaxLoss = binanceStopLossPct ? (binanceStopLossPct / 100) * binanceSize : 0;
  const totalMaxLoss = twilightMaxLoss + binanceMaxLoss;

  // ── Fees ──────────────────────────────────────────────────────────────────
  const binanceEntryFee = binanceSize * BINANCE_TAKER_FEE;
  const totalFees = (binanceEntryFee) * 2; // entry + exit; Twilight fee = 0

  // ── Funding ───────────────────────────────────────────────────────────────
  const binanceFundingPerDayUSDT = binanceSize * binanceFundingRate * 3;
  const twilightFundingPerDayUSD = twilightSize * Math.abs(twilightFundingRate) * 3;

  let dailyFundingPnL = 0;

  if (binancePosition === 'LONG' && binanceFundingRate > 0) dailyFundingPnL -= binanceFundingPerDayUSDT;
  else if (binancePosition === 'LONG' && binanceFundingRate < 0) dailyFundingPnL += Math.abs(binanceFundingPerDayUSDT);
  else if (binancePosition === 'SHORT' && binanceFundingRate > 0) dailyFundingPnL += binanceFundingPerDayUSDT;
  else if (binancePosition === 'SHORT' && binanceFundingRate < 0) dailyFundingPnL -= Math.abs(binanceFundingPerDayUSDT);

  if (twilightPosition === 'LONG' && twilightFundingRate > 0) dailyFundingPnL -= twilightFundingPerDayUSD;
  else if (twilightPosition === 'LONG' && twilightFundingRate < 0) dailyFundingPnL += twilightFundingPerDayUSD;
  else if (twilightPosition === 'SHORT' && twilightFundingRate > 0) dailyFundingPnL += twilightFundingPerDayUSD;
  else if (twilightPosition === 'SHORT' && twilightFundingRate < 0) dailyFundingPnL -= twilightFundingPerDayUSD;

  const monthlyFundingPnL = dailyFundingPnL * 30;

  // ── Basis profit (hedged positions) ──────────────────────────────────────
  let basisProfit = 0;
  if (twilightPosition && binancePosition && twilightPosition !== binancePosition) {
    const positionBTC = Math.min(twilightSize, binanceSize) / twilightPrice;
    basisProfit = Math.abs(spread) * positionBTC;
  }

  const monthlyPnLFlat = basisProfit + monthlyFundingPnL - totalFees;
  const dailyPnL = monthlyPnLFlat / 30;
  const breakEvenDays = dailyFundingPnL > 0
    ? Math.ceil(totalFees / dailyFundingPnL)
    : null;

  // ── Price movement scenarios ──────────────────────────────────────────────
  const calcPricePnL = (pct) => {
    const newBtcPrice = twilightPrice * (1 + pct);
    let twilightPricePnL = 0;
    let marginValueChange = 0;

    if (twilightPosition === 'LONG') {
      twilightPricePnL = pct * twilightLeverage * twilightMarginUSD;
      marginValueChange = twilightMarginBTC * (newBtcPrice - twilightPrice);
    } else if (twilightPosition === 'SHORT') {
      twilightPricePnL = -pct * twilightLeverage * twilightMarginUSD;
      marginValueChange = twilightMarginBTC * (newBtcPrice - twilightPrice);
    }

    let binancePricePnL = 0;
    if (binancePosition === 'LONG') binancePricePnL = pct * binanceLeverage * binanceMarginUSDT;
    else if (binancePosition === 'SHORT') binancePricePnL = -pct * binanceLeverage * binanceMarginUSDT;

    const netPositionPnL = twilightPricePnL + binancePricePnL;
    const netPricePnL = netPositionPnL + marginValueChange;
    return {
      total: netPricePnL + basisProfit + monthlyFundingPnL - totalFees,
      priceOnly: netPricePnL,
      positionPnL: netPositionPnL,
      marginChange: marginValueChange,
    };
  };

  const r5u = calcPricePnL(0.05);
  const r5d = calcPricePnL(-0.05);
  const r10u = calcPricePnL(0.10);
  const r10d = calcPricePnL(-0.10);

  // ── Market direction ──────────────────────────────────────────────────────
  let marketDirection = 'NEUTRAL';
  let directionDescription = '';
  if (twilightPosition && binancePosition && twilightPosition !== binancePosition) {
    marketDirection = 'NEUTRAL';
    directionDescription = 'Profits from funding regardless of price direction. Best for sideways/ranging markets.';
  } else if (
    (twilightPosition === 'LONG' && !binancePosition) ||
    (binancePosition === 'LONG' && !twilightPosition) ||
    (twilightPosition === 'LONG' && binancePosition === 'LONG')
  ) {
    marketDirection = 'BULLISH';
    directionDescription = 'Profits when BTC price goes UP. Loses when price goes DOWN.';
  } else if (
    (twilightPosition === 'SHORT' && !binancePosition) ||
    (binancePosition === 'SHORT' && !twilightPosition) ||
    (twilightPosition === 'SHORT' && binancePosition === 'SHORT')
  ) {
    marketDirection = 'BEARISH';
    directionDescription = 'Profits when BTC price goes DOWN. Loses when price goes UP.';
  }

  // ── Break-even price move ─────────────────────────────────────────────────
  let breakEvenPriceMove = 0;
  if (monthlyFundingPnL < 0) {
    const totalLevMargin =
      (twilightPosition ? twilightLeverage * twilightMarginUSD : 0) +
      (binancePosition ? binanceLeverage * binanceMarginUSDT : 0);
    if (totalLevMargin > 0) {
      breakEvenPriceMove = Math.abs(monthlyFundingPnL - totalFees) / totalLevMargin;
    }
  }

  // ── APY ───────────────────────────────────────────────────────────────────
  const monthlyROI = (monthlyPnLFlat / totalMarginUSD) * 100;
  const apy = monthlyROI * 12;
  const apyUp5 = ((r5u.total / totalMarginUSD) * 100) * 12;
  const apyDown5 = ((r5d.total / totalMarginUSD) * 100) * 12;

  // ── Target Twilight rate for profitability ────────────────────────────────
  let targetTwilightRatePct = null;
  if (twilightSize > 0 && binanceSize > 0 && Math.abs(binanceFundingRate) > 0.000001) {
    const dailyFeeCost = totalFees / 30;
    let binanceDailyNet = 0;
    if (binancePosition === 'SHORT' && binanceFundingRate > 0) binanceDailyNet = binanceSize * binanceFundingRate * 3;
    else if (binancePosition === 'LONG' && binanceFundingRate < 0) binanceDailyNet = binanceSize * Math.abs(binanceFundingRate) * 3;
    else if (binancePosition === 'LONG' && binanceFundingRate > 0) binanceDailyNet = -binanceSize * binanceFundingRate * 3;
    else if (binancePosition === 'SHORT' && binanceFundingRate < 0) binanceDailyNet = -binanceSize * Math.abs(binanceFundingRate) * 3;

    const requiredTwilightDaily = dailyFeeCost - binanceDailyNet;
    if (requiredTwilightDaily > 0) {
      const targetRate = requiredTwilightDaily / (twilightSize * 3);
      const pct = (targetRate / Math.abs(binanceFundingRate)) * 100;
      if (isFinite(pct) && pct >= 0) targetTwilightRatePct = pct;
    } else {
      targetTwilightRatePct = 0;
    }
  }

  return {
    apy: isNaN(apy) ? 0 : apy,
    dailyPnL: isNaN(dailyPnL) ? 0 : dailyPnL,
    monthlyPnL: isNaN(monthlyPnLFlat) ? 0 : monthlyPnLFlat,
    totalMargin: totalMarginUSD,
    twilightMarginBTC,
    twilightMarginUSD,
    binanceMarginUSDT,
    totalFees,
    basisProfit,
    monthlyFundingPnL,
    twilightLiquidationPrice,
    twilightLiquidationPct,
    binanceLiquidationPrice,
    binanceLiquidationPct,
    twilightStopLoss,
    twilightStopLossPct,
    binanceStopLoss,
    binanceStopLossPct,
    totalMaxLoss,
    breakEvenDays,
    marketDirection,
    directionDescription,
    pnlUp5: r5u.total,
    pnlDown5: r5d.total,
    pnlUp10: r10u.total,
    pnlDown10: r10d.total,
    priceOnlyUp5: r5u.priceOnly,
    priceOnlyDown5: r5d.priceOnly,
    priceOnlyUp10: r10u.priceOnly,
    priceOnlyDown10: r10d.priceOnly,
    marginChangeUp5: r5u.marginChange,
    marginChangeDown5: r5d.marginChange,
    marginChangeUp10: r10u.marginChange,
    marginChangeDown10: r10d.marginChange,
    apyUp5: isNaN(apyUp5) ? 0 : apyUp5,
    apyDown5: isNaN(apyDown5) ? 0 : apyDown5,
    breakEvenPriceMove: breakEvenPriceMove * 100,
    targetTwilightRatePct,
  };
}

// ─── Bybit Inverse Strategy Calculator ───────────────────────────────────────

/**
 * Calculate metrics for Twilight ↔ Bybit inverse (BTC-margined) strategies.
 * Both platforms are BTC-margined, creating true BTC delta-neutral positions.
 *
 * @param {object} p
 * @returns {object} Strategy metrics
 */
export function calculateBybitStrategy({
  twilightPos, twilightSize, twilightLev,
  bybitPos, bybitSize, bybitLev,
  twilightPrice, bybitPrice,
  currentTwilightAPY, isShortHeavy, isLongHeavy,
  bybitFundingRate,
}) {
  const isBybitNegative = bybitFundingRate < 0;
  const isBybitPositive = bybitFundingRate > 0.00005;
  const bybitAnnualizedFunding = Math.abs(bybitFundingRate) * 3 * 365 * 100;

  const twilightMarginBTC = twilightSize / (twilightLev * twilightPrice);
  const twilightMarginUSD = twilightMarginBTC * twilightPrice;
  const bybitMarginBTC = bybitSize / (bybitLev * bybitPrice);
  const bybitMarginUSD = bybitMarginBTC * bybitPrice;
  const totalMargin = twilightMarginUSD + bybitMarginUSD;

  const twilightFundingEarned = twilightPos === 'LONG'
    ? (isShortHeavy ? currentTwilightAPY : -currentTwilightAPY)
    : (isLongHeavy ? currentTwilightAPY : -currentTwilightAPY);

  const bybitFundingEarned = bybitPos === 'LONG'
    ? (isBybitNegative ? bybitAnnualizedFunding : -bybitAnnualizedFunding)
    : (isBybitPositive ? bybitAnnualizedFunding : -bybitAnnualizedFunding);

  const twilightMonthlyFunding = twilightSize * (twilightFundingEarned / 100) / 12;
  const bybitMonthlyFunding = bybitSize * (bybitFundingEarned / 100) / 12;
  const monthlyFundingPnL = twilightMonthlyFunding + bybitMonthlyFunding;

  const bybitFees = bybitSize * BYBIT_TAKER_FEE * 2;
  const totalFees = bybitFees;
  const monthlyPnL = monthlyFundingPnL - (totalFees / 12);

  const twilightLiqPct = (100 / twilightLev) * 0.9;
  const twilightLiqPrice = twilightPos === 'LONG'
    ? twilightPrice * (1 - twilightLiqPct / 100)
    : twilightPrice * (1 + twilightLiqPct / 100);

  const bybitLiqPct = (100 / bybitLev) * 0.9;
  const bybitLiqPrice = bybitPos === 'LONG'
    ? bybitPrice * (1 - bybitLiqPct / 100)
    : bybitPrice * (1 + bybitLiqPct / 100);

  return {
    twilightMarginBTC,
    twilightMarginUSD,
    bybitMarginBTC,
    bybitMarginUSD,
    totalMargin,
    monthlyFundingPnL,
    basisProfit: 0,
    totalFees,
    monthlyPnL,
    apy: totalMargin > 0 ? (monthlyPnL / totalMargin) * 12 * 100 : 0,
    dailyPnL: monthlyPnL / 30,
    pnlUp5: monthlyPnL,
    pnlUp10: monthlyPnL,
    pnlDown5: monthlyPnL,
    pnlDown10: monthlyPnL,
    priceOnlyUp5: 0, priceOnlyUp10: 0, priceOnlyDown5: 0, priceOnlyDown10: 0,
    marginChangeUp5: 0, marginChangeUp10: 0, marginChangeDown5: 0, marginChangeDown10: 0,
    twilightLiquidationPrice: twilightLiqPrice,
    twilightLiquidationPct: twilightLiqPct,
    bybitLiquidationPrice: bybitLiqPrice,
    bybitLiquidationPct: bybitLiqPct,
    twilightStopLoss: twilightPos === 'LONG' ? twilightLiqPrice * 1.1 : twilightLiqPrice * 0.9,
    twilightStopLossPct: twilightLiqPct * 0.8,
    totalMaxLoss: totalMargin * 0.1,
    breakEvenDays: monthlyFundingPnL > 0
      ? Math.ceil(totalFees / (monthlyFundingPnL / 30))
      : null,
    marketDirection: 'NEUTRAL',
    directionDescription: 'Delta-neutral inverse perp arb. Both BTC-margined. Profits from funding.',
    apyUp5: totalMargin > 0 ? (monthlyPnL / totalMargin) * 12 * 100 : 0,
    apyDown5: totalMargin > 0 ? (monthlyPnL / totalMargin) * 12 * 100 : 0,
    breakEvenPriceMove: 0,
    targetTwilightRatePct: null,
    binanceLiquidationPrice: bybitLiqPrice,
    binanceLiquidationPct: bybitLiqPct,
    binanceStopLoss: null,
    binanceStopLossPct: null,
  };
}

// ─── Strategy Generator ───────────────────────────────────────────────────────

/**
 * Generate all Twilight trading strategies for a given set of market parameters.
 *
 * @param {object} params - Market parameters (see DEFAULT_PARAMS for defaults)
 * @returns {Array<object>} Strategies sorted by APY descending
 */
export function generateTwilightStrategies(params = {}) {
  const {
    twilightPrice,
    cexPrice,
    bybitPrice,
    binanceFundingRate,
    bybitFundingRate,
    tvl,
    twilightLongSize,
    twilightShortSize,
    twilightFundingCapPct,
    pegTwilightToCapRate,
  } = { ...DEFAULT_PARAMS, ...params };

  // Derived market state
  const spread = twilightPrice - cexPrice;
  const rawTwilightFundingRate = calculateTwilightFundingRate(twilightLongSize, twilightShortSize);
  const twilightFundingRate = (pegTwilightToCapRate && twilightFundingCapPct > 0)
    ? (twilightFundingCapPct / 100) * binanceFundingRate
    : applyTwilightFundingCap(rawTwilightFundingRate, binanceFundingRate, twilightFundingCapPct);

  const currentSkew = (twilightLongSize + twilightShortSize) > 0
    ? twilightLongSize / (twilightLongSize + twilightShortSize)
    : 0.5;
  const currentTwilightAPY = Math.abs(twilightFundingRate) * 3 * 365 * 100;
  const isLongHeavy = currentSkew > 0.55;
  const isShortHeavy = currentSkew < 0.45;
  const isBinanceNegative = binanceFundingRate < 0;
  const isBinancePositive = binanceFundingRate > 0.0001;

  const ctx = { twilightPrice, cexPrice, binanceFundingRate, twilightFundingRate, spread };
  const strategies = [];
  let id = 1;

  const mk = (def, apyParams) => ({
    ...def,
    ...calculateStrategyAPY(apyParams, ctx),
  });

  // ── 1-4: Directional — Twilight Only ─────────────────────────────────────
  for (const lev of [10, 20]) {
    const size = Math.min(150, tvl);

    strategies.push(mk({
      id: id++,
      name: `Twilight Long ${lev}x`,
      description: `Long BTC on Twilight only. No hedge. Directional bet.`,
      category: 'Directional',
      twilightPosition: 'LONG', twilightSize: size, twilightLeverage: lev,
      binancePosition: null, binanceSize: 0, binanceLeverage: 0,
      risk: 'HIGH',
    }, { twilightPosition: 'LONG', twilightSize: size, twilightLeverage: lev, binancePosition: null, binanceSize: 0, binanceLeverage: 0 }));

    strategies.push(mk({
      id: id++,
      name: `Twilight Short ${lev}x`,
      description: `Short BTC on Twilight only. No hedge. Directional bet.`,
      category: 'Directional',
      twilightPosition: 'SHORT', twilightSize: size, twilightLeverage: lev,
      binancePosition: null, binanceSize: 0, binanceLeverage: 0,
      risk: 'HIGH',
    }, { twilightPosition: 'SHORT', twilightSize: size, twilightLeverage: lev, binancePosition: null, binanceSize: 0, binanceLeverage: 0 }));
  }

  // ── 5-8: CEX Only — Binance Futures ──────────────────────────────────────
  for (const lev of [10, 20]) {
    const size = Math.min(150, tvl);

    strategies.push(mk({
      id: id++,
      name: `Binance Long ${lev}x`,
      description: `Long BTC on Binance Futures. Subject to funding fees.`,
      category: 'CEX Only',
      twilightPosition: null, twilightSize: 0, twilightLeverage: 0,
      binancePosition: 'LONG', binanceSize: size, binanceLeverage: lev,
      risk: 'HIGH',
    }, { twilightPosition: null, twilightSize: 0, twilightLeverage: 0, binancePosition: 'LONG', binanceSize: size, binanceLeverage: lev }));

    strategies.push(mk({
      id: id++,
      name: `Binance Short ${lev}x`,
      description: `Short BTC on Binance Futures. Collect funding if rate positive.`,
      category: 'CEX Only',
      twilightPosition: null, twilightSize: 0, twilightLeverage: 0,
      binancePosition: 'SHORT', binanceSize: size, binanceLeverage: lev,
      risk: 'HIGH',
    }, { twilightPosition: null, twilightSize: 0, twilightLeverage: 0, binancePosition: 'SHORT', binanceSize: size, binanceLeverage: lev }));
  }

  // ── 9-16: Delta-Neutral — Long Twi / Short Bin ───────────────────────────
  for (const size of [100, 150]) {
    if (size > tvl) continue;
    for (const lev of [10, 20]) {
      strategies.push(mk({
        id: id++,
        name: `Hedge: Long Twi / Short Bin ${lev}x ($${size})`,
        description: `Delta-neutral: Long on Twilight (0 funding), Short on Binance (collect funding). Capture spread + funding arb.`,
        category: 'Delta-Neutral',
        twilightPosition: 'LONG', twilightSize: size, twilightLeverage: lev,
        binancePosition: 'SHORT', binanceSize: size, binanceLeverage: lev,
        risk: 'LOW',
      }, { twilightPosition: 'LONG', twilightSize: size, twilightLeverage: lev, binancePosition: 'SHORT', binanceSize: size, binanceLeverage: lev }));
    }
  }

  // ── 17-24: Delta-Neutral — Short Twi / Long Bin ──────────────────────────
  for (const size of [100, 150]) {
    if (size > tvl) continue;
    for (const lev of [10, 20]) {
      strategies.push(mk({
        id: id++,
        name: `Hedge: Short Twi / Long Bin ${lev}x ($${size})`,
        description: `Delta-neutral: Short on Twilight, Long on Binance. Pay Binance funding but earn Twilight funding if shorts > longs.`,
        category: 'Delta-Neutral',
        twilightPosition: 'SHORT', twilightSize: size, twilightLeverage: lev,
        binancePosition: 'LONG', binanceSize: size, binanceLeverage: lev,
        risk: 'LOW',
      }, { twilightPosition: 'SHORT', twilightSize: size, twilightLeverage: lev, binancePosition: 'LONG', binanceSize: size, binanceLeverage: lev }));
    }
  }

  // ── Funding Arbitrage — Max Size ──────────────────────────────────────────
  const maxSize = Math.min(tvl, 300);

  strategies.push(mk({
    id: id++,
    name: `Max Funding Arb: Long Twi / Short Bin`,
    description: `Maximum capital deployment for funding arbitrage. Long Twilight (0 funding), Short Binance (collect ${(binanceFundingRate * 100).toFixed(4)}% per 8h).`,
    category: 'Funding Arb',
    twilightPosition: 'LONG', twilightSize: maxSize, twilightLeverage: 20,
    binancePosition: 'SHORT', binanceSize: maxSize, binanceLeverage: 20,
    risk: 'MEDIUM',
  }, { twilightPosition: 'LONG', twilightSize: maxSize, twilightLeverage: 20, binancePosition: 'SHORT', binanceSize: maxSize, binanceLeverage: 20 }));

  strategies.push(mk({
    id: id++,
    name: `Max Funding Arb: Short Twi / Long Bin`,
    description: `Reverse funding arb. Useful when Binance funding is negative (shorts pay longs).`,
    category: 'Funding Arb',
    twilightPosition: 'SHORT', twilightSize: maxSize, twilightLeverage: 20,
    binancePosition: 'LONG', binanceSize: maxSize, binanceLeverage: 20,
    risk: 'MEDIUM',
  }, { twilightPosition: 'SHORT', twilightSize: maxSize, twilightLeverage: 20, binancePosition: 'LONG', binanceSize: maxSize, binanceLeverage: 20 }));

  // ── Conservative Hedges ───────────────────────────────────────────────────
  strategies.push(mk({
    id: id++,
    name: `Conservative Hedge 5x ($100)`,
    description: `Low leverage delta-neutral for safety. Long Twilight, Short Binance.`,
    category: 'Conservative',
    twilightPosition: 'LONG', twilightSize: 100, twilightLeverage: 5,
    binancePosition: 'SHORT', binanceSize: 100, binanceLeverage: 5,
    risk: 'VERY LOW',
  }, { twilightPosition: 'LONG', twilightSize: 100, twilightLeverage: 5, binancePosition: 'SHORT', binanceSize: 100, binanceLeverage: 5 }));

  strategies.push(mk({
    id: id++,
    name: `Conservative Hedge 5x ($50)`,
    description: `Minimal capital at risk. Test strategy for learning.`,
    category: 'Conservative',
    twilightPosition: 'LONG', twilightSize: 50, twilightLeverage: 5,
    binancePosition: 'SHORT', binanceSize: 50, binanceLeverage: 5,
    risk: 'VERY LOW',
  }, { twilightPosition: 'LONG', twilightSize: 50, twilightLeverage: 5, binancePosition: 'SHORT', binanceSize: 50, binanceLeverage: 5 }));

  // ── Capital Efficient — No Hedge ──────────────────────────────────────────
  const stablecoinSize = Math.min(150, tvl);
  strategies.push(mk({
    id: id++,
    name: `Stablecoin Position (No Hedge)`,
    description: `SHORT on Twilight only. No CEX hedge = no funding bleed. Creates stable USD value if you hold spot BTC.`,
    category: 'Capital Efficient',
    twilightPosition: 'SHORT', twilightSize: stablecoinSize, twilightLeverage: 10,
    binancePosition: null, binanceSize: 0, binanceLeverage: 0,
    risk: 'LOW',
  }, { twilightPosition: 'SHORT', twilightSize: stablecoinSize, twilightLeverage: 10, binancePosition: null, binanceSize: 0, binanceLeverage: 0 }));

  strategies.push(mk({
    id: id++,
    name: `Leveraged Long (No Hedge)`,
    description: `LONG on Twilight only. No CEX hedge. Earn funding when shorts > longs.`,
    category: 'Capital Efficient',
    twilightPosition: 'LONG', twilightSize: stablecoinSize, twilightLeverage: 10,
    binancePosition: null, binanceSize: 0, binanceLeverage: 0,
    risk: 'MEDIUM',
  }, { twilightPosition: 'LONG', twilightSize: stablecoinSize, twilightLeverage: 10, binancePosition: null, binanceSize: 0, binanceLeverage: 0 }));

  // ── Funding Harvest ───────────────────────────────────────────────────────
  const harvestSize = Math.min(200, tvl);

  const shortHarvestBase = calculateStrategyAPY(
    { twilightPosition: 'SHORT', twilightSize: harvestSize, twilightLeverage: 15, binancePosition: null, binanceSize: 0, binanceLeverage: 0 },
    ctx,
  );
  strategies.push({
    id: id++,
    name: `Funding Harvest ${isLongHeavy ? '(Active)' : '(Inactive)'} (SHORT)`,
    description: isLongHeavy
      ? `PROFITABLE NOW! Book is ${(currentSkew * 100).toFixed(1)}% long. Shorts EARN ${currentTwilightAPY.toFixed(1)}% APY.`
      : `NOT PROFITABLE NOW. Book is ${(currentSkew * 100).toFixed(1)}% long. Wait until >55% long to SHORT.`,
    category: 'Funding Harvest',
    twilightPosition: 'SHORT', twilightSize: harvestSize, twilightLeverage: 15,
    binancePosition: null, binanceSize: 0, binanceLeverage: 0,
    risk: isLongHeavy ? 'LOW' : 'HIGH',
    ...shortHarvestBase,
    apy: isLongHeavy ? currentTwilightAPY : -currentTwilightAPY,
    monthlyPnL: isLongHeavy
      ? (harvestSize * (currentTwilightAPY / 100) / 12)
      : -(harvestSize * (currentTwilightAPY / 100) / 12),
  });

  const longHarvestBase = calculateStrategyAPY(
    { twilightPosition: 'LONG', twilightSize: harvestSize, twilightLeverage: 15, binancePosition: null, binanceSize: 0, binanceLeverage: 0 },
    ctx,
  );
  strategies.push({
    id: id++,
    name: `Funding Harvest ${isShortHeavy ? '(Active)' : '(Inactive)'} (LONG)`,
    description: isShortHeavy
      ? `PROFITABLE NOW! Book is ${(currentSkew * 100).toFixed(1)}% long. Longs EARN ${currentTwilightAPY.toFixed(1)}% APY.`
      : `NOT PROFITABLE NOW. Book is ${(currentSkew * 100).toFixed(1)}% long. Wait until <45% long to go LONG.`,
    category: 'Funding Harvest',
    twilightPosition: 'LONG', twilightSize: harvestSize, twilightLeverage: 15,
    binancePosition: null, binanceSize: 0, binanceLeverage: 0,
    risk: isShortHeavy ? 'LOW' : 'HIGH',
    ...longHarvestBase,
    apy: isShortHeavy ? currentTwilightAPY : -currentTwilightAPY,
    monthlyPnL: isShortHeavy
      ? (harvestSize * (currentTwilightAPY / 100) / 12)
      : -(harvestSize * (currentTwilightAPY / 100) / 12),
  });

  // ── Dual Arbitrage ────────────────────────────────────────────────────────
  const isDualArbProfitable = isLongHeavy && isBinanceNegative;
  const dualShortBase = calculateStrategyAPY(
    { twilightPosition: 'SHORT', twilightSize: harvestSize, twilightLeverage: 15, binancePosition: 'SHORT', binanceSize: harvestSize, binanceLeverage: 5 },
    ctx,
  );
  strategies.push({
    id: id++,
    name: `Dual SHORT Arb${isDualArbProfitable ? ' (Active)' : ''}`,
    description: isDualArbProfitable
      ? `RARE OPPORTUNITY! Both sides pay YOU.`
      : `NOT PROFITABLE. Need: Twilight long-heavy AND Binance funding negative.`,
    category: 'Dual Arb',
    twilightPosition: 'SHORT', twilightSize: harvestSize, twilightLeverage: 15,
    binancePosition: 'SHORT', binanceSize: harvestSize, binanceLeverage: 5,
    risk: isDualArbProfitable ? 'LOW' : 'HIGH',
    ...dualShortBase,
    apy: isDualArbProfitable
      ? currentTwilightAPY + Math.abs(binanceFundingRate * 3 * 365 * 100)
      : -(currentTwilightAPY + Math.abs(binanceFundingRate * 3 * 365 * 100)),
  });

  const isDualLongArbProfitable = isShortHeavy && isBinancePositive;
  const dualLongBase = calculateStrategyAPY(
    { twilightPosition: 'LONG', twilightSize: harvestSize, twilightLeverage: 15, binancePosition: 'LONG', binanceSize: harvestSize, binanceLeverage: 5 },
    ctx,
  );
  strategies.push({
    id: id++,
    name: `Dual LONG Arb${isDualLongArbProfitable ? ' (Active)' : ''}`,
    description: isDualLongArbProfitable
      ? `RARE OPPORTUNITY! Both sides pay YOU.`
      : `NOT PROFITABLE. Need: Twilight short-heavy AND Binance funding positive.`,
    category: 'Dual Arb',
    twilightPosition: 'LONG', twilightSize: harvestSize, twilightLeverage: 15,
    binancePosition: 'LONG', binanceSize: harvestSize, binanceLeverage: 5,
    risk: isDualLongArbProfitable ? 'LOW' : 'HIGH',
    ...dualLongBase,
    apy: isDualLongArbProfitable
      ? currentTwilightAPY + Math.abs(binanceFundingRate * 3 * 365 * 100)
      : -(currentTwilightAPY + Math.abs(binanceFundingRate * 3 * 365 * 100)),
  });

  // ── Bybit Inverse Strategies (only when bybitPrice > 0) ───────────────────
  if (bybitPrice > 0) {
    const bybitCtx = {
      twilightPrice, bybitPrice, currentTwilightAPY, isShortHeavy, isLongHeavy, bybitFundingRate,
    };
    const isBybitNegative = bybitFundingRate < 0;
    const isBybitPositive = bybitFundingRate > 0.00005;
    const spreadBps = Math.abs((twilightPrice - bybitPrice) / bybitPrice * 10000);

    const bybitDefs = [
      {
        twilightPos: 'SHORT', twilightSize: Math.min(200, tvl), twilightLev: 10,
        bybitPos: 'LONG', bybitSize: Math.min(200, tvl), bybitLev: 10,
        name: `Inverse Arb: Short Twi / Long Bybit 10x`,
        description: `Inverse perp hedge. Both BTC-margined. Short Twilight + Long Bybit @ 10x.`,
        category: 'Bybit Inverse',
        risk: (isLongHeavy && isBybitNegative) ? 'LOW' : 'MEDIUM',
      },
      {
        twilightPos: 'LONG', twilightSize: Math.min(200, tvl), twilightLev: 10,
        bybitPos: 'SHORT', bybitSize: Math.min(200, tvl), bybitLev: 10,
        name: `Inverse Arb: Long Twi / Short Bybit 10x`,
        description: `Reverse inverse perp hedge. Long Twilight + Short Bybit @ 10x.`,
        category: 'Bybit Inverse',
        risk: (isShortHeavy && isBybitPositive) ? 'LOW' : 'MEDIUM',
      },
      {
        twilightPos: 'SHORT', twilightSize: Math.min(300, tvl), twilightLev: 20,
        bybitPos: 'LONG', bybitSize: Math.min(300, tvl), bybitLev: 20,
        name: `Max Inverse Arb 20x: Short Twi / Long Bybit`,
        description: `Maximum leverage inverse arb. Both platforms BTC-margined. 20x leverage.`,
        category: 'Bybit Inverse', risk: 'HIGH',
      },
      {
        twilightPos: 'SHORT', twilightSize: 100, twilightLev: 5,
        bybitPos: 'LONG', bybitSize: 100, bybitLev: 5,
        name: `Conservative Inverse 5x: Short Twi / Long Bybit`,
        description: `Low leverage inverse arb for safety. Both BTC-margined.`,
        category: 'Bybit Inverse', risk: 'LOW',
      },
      {
        twilightPos: 'SHORT', twilightSize: 200, twilightLev: 15,
        bybitPos: 'LONG', bybitSize: 200, bybitLev: 15,
        name: `Funding Capture 15x: Short Twi / Long Bybit`,
        description: `Higher leverage (15x) for amplified funding capture. Both BTC-margined inverse perps.`,
        category: 'Bybit Inverse', risk: 'MEDIUM',
      },
      {
        twilightPos: 'SHORT', twilightSize: Math.min(500, tvl), twilightLev: 10,
        bybitPos: 'LONG', bybitSize: Math.min(500, tvl), bybitLev: 10,
        name: `Large Inverse Arb 10x: Short Twi / Long Bybit`,
        description: `Larger position @ 10x on both sides. More absolute profit potential.`,
        category: 'Bybit Inverse', risk: 'MEDIUM',
      },
      {
        twilightPos: 'SHORT', twilightSize: 50, twilightLev: 3,
        bybitPos: 'LONG', bybitSize: 50, bybitLev: 3,
        name: `Mini Inverse 3x: Short Twi / Long Bybit`,
        description: `Minimal leverage (3x) for beginners. Very low liquidation risk. $50 position.`,
        category: 'Bybit Inverse', risk: 'VERY LOW',
      },
      {
        twilightPos: 'SHORT', twilightSize: 150, twilightLev: 5,
        bybitPos: 'LONG', bybitSize: 150, bybitLev: 10,
        name: `Asymmetric 5x/10x: Short Twi / Long Bybit`,
        description: `Lower leverage on Twilight (5x) for safety, higher on Bybit (10x).`,
        category: 'Bybit Inverse', risk: 'LOW',
      },
      {
        twilightPos: twilightPrice > bybitPrice ? 'SHORT' : 'LONG',
        twilightSize: 300, twilightLev: 10,
        bybitPos: twilightPrice > bybitPrice ? 'LONG' : 'SHORT',
        bybitSize: 300, bybitLev: 10,
        name: `Spread Capture 10x${spreadBps > 5 ? ' (Active)' : ''}`,
        description: `Capture price spread between venues. Current spread: ${spreadBps.toFixed(1)} bps.`,
        category: 'Bybit Inverse', risk: 'MEDIUM',
        spreadBps,
      },
      {
        twilightPos: 'SHORT', twilightSize: 250, twilightLev: 10,
        bybitPos: 'LONG', bybitSize: 250, bybitLev: 10,
        name: `Funding Diff Capture`,
        description: `Capture funding rate differential. Twilight: ${(twilightFundingRate * 100).toFixed(4)}%/8h. Bybit: ${(bybitFundingRate * 100).toFixed(4)}%/8h.`,
        category: 'Bybit Inverse', risk: 'MEDIUM',
      },
      {
        twilightPos: 'LONG', twilightSize: Math.min(500, tvl), twilightLev: 10,
        bybitPos: 'SHORT', bybitSize: Math.min(500, tvl), bybitLev: 10,
        name: `Large Reverse Arb 10x: Long Twi / Short Bybit`,
        description: `Larger reverse position. Long Twilight + Short Bybit.`,
        category: 'Bybit Inverse',
        risk: (isShortHeavy && isBybitPositive) ? 'LOW' : 'MEDIUM',
      },
      {
        twilightPos: 'LONG', twilightSize: 100, twilightLev: 5,
        bybitPos: 'SHORT', bybitSize: 100, bybitLev: 5,
        name: `Conservative Reverse 5x: Long Twi / Short Bybit`,
        description: `Low leverage reverse position. Long Twilight + Short Bybit.`,
        category: 'Bybit Inverse', risk: 'LOW',
      },
    ];

    for (const def of bybitDefs) {
      const metrics = calculateBybitStrategy({ ...def, ...bybitCtx });
      strategies.push({
        id: id++,
        name: def.name,
        description: def.description,
        category: def.category,
        risk: def.risk,
        twilightPosition: def.twilightPos,
        twilightSize: def.twilightSize,
        twilightLeverage: def.twilightLev,
        binancePosition: def.bybitPos,
        binanceSize: def.bybitSize,
        binanceLeverage: def.bybitLev,
        isBybitStrategy: true,
        bybitPrice,
        bybitFundingRate,
        ...(def.spreadBps !== undefined && { spreadBps: def.spreadBps }),
        ...metrics,
      });
    }
  }

  return strategies.sort((a, b) => b.apy - a.apy);
}
