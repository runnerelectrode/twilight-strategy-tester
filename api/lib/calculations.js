// ===========================
// CONFIGURATION CONSTANTS
// ===========================
const BINANCE_TAKER_FEE = 0.0004;   // 0.04%
const BINANCE_MAKER_FEE = 0.0002;   // 0.02%
const BYBIT_TAKER_FEE = 0.00055;    // 0.055%
const TWILIGHT_FEE = 0;             // 0%
const TWILIGHT_FUNDING_PSI = 1.0;
const TWILIGHT_FUNDING_SCALE = 100;
const TWILIGHT_MAINT_MARGIN = 0.005; // 0.5%
const BINANCE_MAINT_MARGIN = 0.004;  // 0.4%

// ===========================
// FUNDING RATE
// ===========================

function calculateTwilightFundingRate(twilightLongSize, twilightShortSize) {
  const allPositionSize = twilightLongSize + twilightShortSize;
  if (allPositionSize === 0) return 0;
  const imbalance = (twilightLongSize - twilightShortSize) / allPositionSize;
  const fundingRate = Math.pow(imbalance, 2) / (TWILIGHT_FUNDING_PSI * 8.0 * TWILIGHT_FUNDING_SCALE);
  return imbalance >= 0 ? fundingRate : -fundingRate;
}

function applyTwilightFundingCap(rawTwilight, binanceRate, capPct) {
  if (capPct <= 0) return rawTwilight;
  const capValue = (capPct / 100) * binanceRate;
  if (binanceRate >= 0) return rawTwilight > capValue ? capValue : rawTwilight;
  return rawTwilight < capValue ? capValue : rawTwilight;
}

function getTwilightFundingRate(twilightLongSize, twilightShortSize, binanceFundingRate, twilightFundingCapPct) {
  const raw = calculateTwilightFundingRate(twilightLongSize, twilightShortSize);
  if (twilightFundingCapPct > 0) {
    return (twilightFundingCapPct / 100) * binanceFundingRate;
  }
  return applyTwilightFundingCap(raw, binanceFundingRate, twilightFundingCapPct);
}

// ===========================
// STRATEGY APY CALCULATION
// ===========================

function calculateStrategyAPY(strategy, marketData, poolConfig) {
  const {
    twilightPosition, twilightSize, twilightLeverage,
    binancePosition, binanceSize, binanceLeverage,
  } = strategy;

  const btcPrice = marketData.twilightPrice;
  const cexPrice = marketData.cexPrice;
  const spread = btcPrice - cexPrice;
  const binanceFundingRate = marketData.binanceFundingRate;
  const twilightFundingRate = getTwilightFundingRate(
    poolConfig.twilightLongSize, poolConfig.twilightShortSize,
    binanceFundingRate, poolConfig.twilightFundingCapPct
  );

  // Margin calculations
  const twilightMarginBTC = twilightSize > 0 ? twilightSize / (twilightLeverage * btcPrice) : 0;
  const twilightMarginUSD = twilightMarginBTC * btcPrice;
  const binanceMarginUSDT = binanceSize > 0 ? binanceSize / binanceLeverage : 0;
  const totalMarginUSD = twilightMarginUSD + binanceMarginUSDT;

  // Liquidation prices — Twilight (inverse perp)
  let twilightLiquidationPrice = null, twilightLiquidationPct = null;
  if (twilightPosition === 'LONG' && twilightLeverage > 0) {
    twilightLiquidationPrice = btcPrice * twilightLeverage / (twilightLeverage + 1 - twilightLeverage * TWILIGHT_MAINT_MARGIN);
    twilightLiquidationPct = ((btcPrice - twilightLiquidationPrice) / btcPrice) * 100;
  } else if (twilightPosition === 'SHORT' && twilightLeverage > 1) {
    twilightLiquidationPrice = btcPrice * twilightLeverage / (twilightLeverage - 1 + twilightLeverage * TWILIGHT_MAINT_MARGIN);
    twilightLiquidationPct = ((twilightLiquidationPrice - btcPrice) / btcPrice) * 100;
  }

  // Liquidation prices — Binance (linear perp)
  let binanceLiquidationPrice = null, binanceLiquidationPct = null;
  if (binancePosition === 'LONG' && binanceLeverage > 0) {
    binanceLiquidationPrice = cexPrice * (1 - (1 - BINANCE_MAINT_MARGIN) / binanceLeverage);
    binanceLiquidationPct = ((cexPrice - binanceLiquidationPrice) / cexPrice) * 100;
  } else if (binancePosition === 'SHORT' && binanceLeverage > 0) {
    binanceLiquidationPrice = cexPrice * (1 + (1 - BINANCE_MAINT_MARGIN) / binanceLeverage);
    binanceLiquidationPct = ((binanceLiquidationPrice - cexPrice) / cexPrice) * 100;
  }

  // Stop loss: 50% of distance to liquidation
  let twilightStopLoss = null, twilightStopLossPct = null;
  if (twilightLiquidationPrice && twilightPosition === 'LONG') {
    twilightStopLoss = btcPrice - (btcPrice - twilightLiquidationPrice) * 0.5;
    twilightStopLossPct = ((btcPrice - twilightStopLoss) / btcPrice) * 100;
  } else if (twilightLiquidationPrice && twilightPosition === 'SHORT') {
    twilightStopLoss = btcPrice + (twilightLiquidationPrice - btcPrice) * 0.5;
    twilightStopLossPct = ((twilightStopLoss - btcPrice) / btcPrice) * 100;
  }

  let binanceStopLoss = null, binanceStopLossPct = null;
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

  if (totalMarginUSD === 0) {
    return {
      apy: 0, dailyPnL: 0, monthlyPnL: 0, totalMargin: 0,
      twilightMarginBTC: 0, twilightMarginUSD: 0, binanceMarginUSDT: 0,
      totalFees: 0, basisProfit: 0, monthlyFundingPnL: 0,
      twilightLiquidationPrice: null, twilightLiquidationPct: null,
      binanceLiquidationPrice: null, binanceLiquidationPct: null,
      twilightStopLoss: null, twilightStopLossPct: null,
      binanceStopLoss: null, binanceStopLossPct: null,
      totalMaxLoss: 0, breakEvenDays: 0
    };
  }

  // Fee calculations
  const twilightEntryFee = twilightSize * TWILIGHT_FEE;
  const binanceEntryFee = binanceSize * BINANCE_TAKER_FEE;
  const totalEntryFee = twilightEntryFee + binanceEntryFee;
  const totalExitFee = totalEntryFee;
  const totalFees = totalEntryFee + totalExitFee;

  // Funding calculations
  const binanceFundingPerDayUSDT = binanceSize * binanceFundingRate * 3;
  const twilightFundingPerDayBTC = (twilightSize * Math.abs(twilightFundingRate) * 3) / btcPrice;
  const twilightFundingPerDayUSD = twilightFundingPerDayBTC * btcPrice;

  let dailyFundingPnL = 0;
  if (binancePosition === 'LONG' && binanceFundingRate > 0) dailyFundingPnL -= binanceFundingPerDayUSDT;
  else if (binancePosition === 'LONG' && binanceFundingRate < 0) dailyFundingPnL += Math.abs(binanceFundingPerDayUSDT);
  else if (binancePosition === 'SHORT' && binanceFundingRate > 0) dailyFundingPnL += binanceFundingPerDayUSDT;
  else if (binancePosition === 'SHORT' && binanceFundingRate < 0) dailyFundingPnL -= Math.abs(binanceFundingPerDayUSDT);

  if (twilightPosition === 'LONG' && twilightFundingRate > 0) dailyFundingPnL -= twilightFundingPerDayUSD;
  else if (twilightPosition === 'LONG' && twilightFundingRate < 0) dailyFundingPnL += twilightFundingPerDayUSD;
  else if (twilightPosition === 'SHORT' && twilightFundingRate > 0) dailyFundingPnL += twilightFundingPerDayUSD;
  else if (twilightPosition === 'SHORT' && twilightFundingRate < 0) dailyFundingPnL -= twilightFundingPerDayUSD;

  // Basis profit
  let basisProfit = 0;
  if (twilightPosition && binancePosition && twilightPosition !== binancePosition) {
    const positionBTC = Math.min(twilightSize, binanceSize) / btcPrice;
    basisProfit = Math.abs(spread) * positionBTC;
  }

  // Monthly P&L (flat price)
  const monthlyFundingPnL = dailyFundingPnL * 30;
  const monthlyPnLFlat = basisProfit + monthlyFundingPnL - totalFees;
  const dailyPnL = monthlyPnLFlat / 30;
  const breakEvenDays = dailyFundingPnL > 0 ? Math.ceil(totalFees / dailyFundingPnL) : Infinity;

  // Price movement scenarios
  const calculatePricePnL = (priceChangePct) => {
    const newBtcPrice = btcPrice * (1 + priceChangePct);
    let twilightPricePnL = 0, binancePricePnL = 0, marginValueChange = 0;

    if (twilightPosition === 'LONG') {
      twilightPricePnL = priceChangePct * twilightLeverage * twilightMarginUSD;
      marginValueChange += twilightMarginBTC * (newBtcPrice - btcPrice);
    } else if (twilightPosition === 'SHORT') {
      twilightPricePnL = -priceChangePct * twilightLeverage * twilightMarginUSD;
      marginValueChange += twilightMarginBTC * (newBtcPrice - btcPrice);
    }

    if (binancePosition === 'LONG') {
      binancePricePnL = priceChangePct * binanceLeverage * binanceMarginUSDT;
    } else if (binancePosition === 'SHORT') {
      binancePricePnL = -priceChangePct * binanceLeverage * binanceMarginUSDT;
    }

    const netPositionPnL = twilightPricePnL + binancePricePnL;
    const netPricePnL = netPositionPnL + marginValueChange;
    const totalPricePnL = netPricePnL + basisProfit + monthlyFundingPnL - totalFees;

    return {
      total: totalPricePnL,
      priceOnly: netPricePnL,
      positionPnL: netPositionPnL,
      marginChange: marginValueChange
    };
  };

  const pnlUp5Result = calculatePricePnL(0.05);
  const pnlDown5Result = calculatePricePnL(-0.05);
  const pnlUp10Result = calculatePricePnL(0.10);
  const pnlDown10Result = calculatePricePnL(-0.10);

  // Market direction
  let marketDirection = 'NEUTRAL', directionDescription = '';
  if (twilightPosition && binancePosition && twilightPosition !== binancePosition) {
    marketDirection = 'NEUTRAL';
    directionDescription = 'Profits from funding regardless of price direction. Best for sideways/ranging markets.';
  } else if ((twilightPosition === 'LONG' && !binancePosition) || (binancePosition === 'LONG' && !twilightPosition) || (twilightPosition === 'LONG' && binancePosition === 'LONG')) {
    marketDirection = 'BULLISH';
    directionDescription = 'Profits when BTC price goes UP. Loses when price goes DOWN.';
  } else if ((twilightPosition === 'SHORT' && !binancePosition) || (binancePosition === 'SHORT' && !twilightPosition) || (twilightPosition === 'SHORT' && binancePosition === 'SHORT')) {
    marketDirection = 'BEARISH';
    directionDescription = 'Profits when BTC price goes DOWN. Loses when price goes UP.';
  }

  // Break-even price move
  let breakEvenPriceMove = 0;
  if (monthlyFundingPnL < 0) {
    const totalLevMargin = (twilightPosition ? twilightLeverage * twilightMarginUSD : 0) +
                           (binancePosition ? binanceLeverage * binanceMarginUSDT : 0);
    if (totalLevMargin > 0) breakEvenPriceMove = Math.abs(monthlyFundingPnL - totalFees) / totalLevMargin;
  }

  // APY
  const monthlyROI = (monthlyPnLFlat / totalMarginUSD) * 100;
  const apy = monthlyROI * 12;
  const apyUp5 = ((pnlUp5Result.total / totalMarginUSD) * 100) * 12;
  const apyDown5 = ((pnlDown5Result.total / totalMarginUSD) * 100) * 12;

  // Target Twilight funding rate % for breakeven
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
    twilightMarginBTC, twilightMarginUSD, binanceMarginUSDT,
    totalFees, basisProfit, monthlyFundingPnL,
    twilightLiquidationPrice, twilightLiquidationPct,
    binanceLiquidationPrice, binanceLiquidationPct,
    twilightStopLoss, twilightStopLossPct,
    binanceStopLoss, binanceStopLossPct,
    totalMaxLoss,
    breakEvenDays: isFinite(breakEvenDays) ? breakEvenDays : null,
    marketDirection, directionDescription,
    pnlUp5: pnlUp5Result.total, pnlDown5: pnlDown5Result.total,
    pnlUp10: pnlUp10Result.total, pnlDown10: pnlDown10Result.total,
    priceOnlyUp5: pnlUp5Result.priceOnly, priceOnlyDown5: pnlDown5Result.priceOnly,
    priceOnlyUp10: pnlUp10Result.priceOnly, priceOnlyDown10: pnlDown10Result.priceOnly,
    marginChangeUp5: pnlUp5Result.marginChange, marginChangeDown5: pnlDown5Result.marginChange,
    marginChangeUp10: pnlUp10Result.marginChange, marginChangeDown10: pnlDown10Result.marginChange,
    apyUp5: isNaN(apyUp5) ? 0 : apyUp5,
    apyDown5: isNaN(apyDown5) ? 0 : apyDown5,
    breakEvenPriceMove: breakEvenPriceMove * 100,
    targetTwilightRatePct
  };
}

// ===========================
// TRADE IMPACT CALCULATOR
// ===========================

function calculateTradeImpact(tradeSizeUSD, direction, poolConfig, marketData) {
  const { twilightLongSize, twilightShortSize, twilightFundingCapPct } = poolConfig;
  const { binanceFundingRate } = marketData;

  const newLongs = direction === 'LONG' ? twilightLongSize + tradeSizeUSD : twilightLongSize;
  const newShorts = direction === 'SHORT' ? twilightShortSize + tradeSizeUSD : twilightShortSize;
  const totalSize = newLongs + newShorts;

  if (totalSize === 0) return { newSkew: 0.5, newFundingRate: 0, skewChange: 0, annualizedAPY: 0, youPay: false, youEarn: false, helpsBalance: false };

  const currentSkew = (twilightLongSize + twilightShortSize) > 0
    ? twilightLongSize / (twilightLongSize + twilightShortSize) : 0.5;
  const newSkew = newLongs / totalSize;
  const skewChange = newSkew - currentSkew;

  const imbalance = (newLongs - newShorts) / totalSize;
  const newFundingRateRaw = Math.pow(imbalance, 2) / (TWILIGHT_FUNDING_PSI * 8.0 * TWILIGHT_FUNDING_SCALE);
  const signedFundingRate = imbalance >= 0 ? newFundingRateRaw : -newFundingRateRaw;
  const cappedFundingRate = twilightFundingCapPct > 0
    ? (twilightFundingCapPct / 100) * binanceFundingRate
    : applyTwilightFundingCap(signedFundingRate, binanceFundingRate, twilightFundingCapPct);

  const annualizedAPY = Math.abs(cappedFundingRate) * 3 * 365 * 100;
  const longsDominate = newSkew > 0.5;

  return {
    newSkew, newLongs, newShorts, skewChange,
    newFundingRate: cappedFundingRate, annualizedAPY,
    youPay: direction === 'LONG' && longsDominate,
    youEarn: direction === 'SHORT' && longsDominate,
    helpsBalance: (direction === 'LONG' && currentSkew < 0.5) || (direction === 'SHORT' && currentSkew > 0.5)
  };
}

module.exports = {
  BINANCE_TAKER_FEE, BINANCE_MAKER_FEE, BYBIT_TAKER_FEE, TWILIGHT_FEE,
  TWILIGHT_FUNDING_PSI, TWILIGHT_FUNDING_SCALE,
  TWILIGHT_MAINT_MARGIN, BINANCE_MAINT_MARGIN,
  calculateTwilightFundingRate, applyTwilightFundingCap, getTwilightFundingRate,
  calculateStrategyAPY, calculateTradeImpact
};
