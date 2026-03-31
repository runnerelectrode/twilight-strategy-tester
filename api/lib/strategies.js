const { calculateStrategyAPY, getTwilightFundingRate, BYBIT_TAKER_FEE } = require('./calculations');

function generateStrategies(marketData, poolConfig) {
  const strategies = [];
  const btcPrice = marketData.twilightPrice;
  const tvl = poolConfig.tvl || 30000000;
  const binanceFundingRate = marketData.binanceFundingRate;
  const bybitPrice = marketData.bybitPrice;
  const bybitFundingRate = marketData.bybitFundingRate;

  const twilightFundingRate = getTwilightFundingRate(
    poolConfig.twilightLongSize, poolConfig.twilightShortSize,
    binanceFundingRate, poolConfig.twilightFundingCapPct
  );
  const currentSkew = (poolConfig.twilightLongSize + poolConfig.twilightShortSize) > 0
    ? poolConfig.twilightLongSize / (poolConfig.twilightLongSize + poolConfig.twilightShortSize) : 0.5;
  const currentTwilightAPY = Math.abs(twilightFundingRate) * 3 * 365 * 100;
  const isLongHeavy = currentSkew > 0.55;
  const isShortHeavy = currentSkew < 0.45;

  if (btcPrice === 0) return strategies;

  let id = 1;
  const calc = (s) => calculateStrategyAPY(s, marketData, poolConfig);

  // ---- Directional (Twilight) ----
  for (const lev of [10, 20]) {
    const size = Math.min(150, tvl);
    strategies.push({
      id: id++, name: `Twilight Long ${lev}x`,
      description: `Long BTC on Twilight only. No hedge. Directional bet.`,
      category: 'Directional', risk: 'HIGH',
      twilightPosition: 'LONG', twilightSize: size, twilightLeverage: lev,
      binancePosition: null, binanceSize: 0, binanceLeverage: 0,
      ...calc({ twilightPosition: 'LONG', twilightSize: size, twilightLeverage: lev, binancePosition: null, binanceSize: 0, binanceLeverage: 0 })
    });
    strategies.push({
      id: id++, name: `Twilight Short ${lev}x`,
      description: `Short BTC on Twilight only. No hedge. Directional bet.`,
      category: 'Directional', risk: 'HIGH',
      twilightPosition: 'SHORT', twilightSize: size, twilightLeverage: lev,
      binancePosition: null, binanceSize: 0, binanceLeverage: 0,
      ...calc({ twilightPosition: 'SHORT', twilightSize: size, twilightLeverage: lev, binancePosition: null, binanceSize: 0, binanceLeverage: 0 })
    });
  }

  // ---- CEX Only (Binance) ----
  for (const lev of [10, 20]) {
    const size = Math.min(150, tvl);
    strategies.push({
      id: id++, name: `Binance Long ${lev}x`,
      description: `Long BTC on Binance Futures. Subject to funding fees.`,
      category: 'CEX Only', risk: 'HIGH',
      twilightPosition: null, twilightSize: 0, twilightLeverage: 0,
      binancePosition: 'LONG', binanceSize: size, binanceLeverage: lev,
      ...calc({ twilightPosition: null, twilightSize: 0, twilightLeverage: 0, binancePosition: 'LONG', binanceSize: size, binanceLeverage: lev })
    });
    strategies.push({
      id: id++, name: `Binance Short ${lev}x`,
      description: `Short BTC on Binance Futures. Collect funding if rate positive.`,
      category: 'CEX Only', risk: 'HIGH',
      twilightPosition: null, twilightSize: 0, twilightLeverage: 0,
      binancePosition: 'SHORT', binanceSize: size, binanceLeverage: lev,
      ...calc({ twilightPosition: null, twilightSize: 0, twilightLeverage: 0, binancePosition: 'SHORT', binanceSize: size, binanceLeverage: lev })
    });
  }

  // ---- Delta-Neutral: Long Twi / Short Bin ----
  for (const size of [100, 150]) {
    if (size > tvl) continue;
    for (const lev of [10, 20]) {
      strategies.push({
        id: id++, name: `Hedge: Long Twi / Short Bin ${lev}x ($${size})`,
        description: `Delta-neutral: Long on Twilight (0 funding), Short on Binance (collect funding). Capture spread + funding arb.`,
        category: 'Delta-Neutral', risk: 'LOW',
        twilightPosition: 'LONG', twilightSize: size, twilightLeverage: lev,
        binancePosition: 'SHORT', binanceSize: size, binanceLeverage: lev,
        ...calc({ twilightPosition: 'LONG', twilightSize: size, twilightLeverage: lev, binancePosition: 'SHORT', binanceSize: size, binanceLeverage: lev })
      });
    }
  }

  // ---- Delta-Neutral: Short Twi / Long Bin ----
  for (const size of [100, 150]) {
    if (size > tvl) continue;
    for (const lev of [10, 20]) {
      strategies.push({
        id: id++, name: `Hedge: Short Twi / Long Bin ${lev}x ($${size})`,
        description: `Delta-neutral: Short on Twilight, Long on Binance.`,
        category: 'Delta-Neutral', risk: 'LOW',
        twilightPosition: 'SHORT', twilightSize: size, twilightLeverage: lev,
        binancePosition: 'LONG', binanceSize: size, binanceLeverage: lev,
        ...calc({ twilightPosition: 'SHORT', twilightSize: size, twilightLeverage: lev, binancePosition: 'LONG', binanceSize: size, binanceLeverage: lev })
      });
    }
  }

  // ---- Funding Arb (max size) ----
  const maxSize = Math.min(tvl, 300);
  strategies.push({
    id: id++, name: `Max Funding Arb: Long Twi / Short Bin`,
    description: `Maximum capital deployment for funding arbitrage. Long Twilight, Short Binance.`,
    category: 'Funding Arb', risk: 'MEDIUM',
    twilightPosition: 'LONG', twilightSize: maxSize, twilightLeverage: 20,
    binancePosition: 'SHORT', binanceSize: maxSize, binanceLeverage: 20,
    ...calc({ twilightPosition: 'LONG', twilightSize: maxSize, twilightLeverage: 20, binancePosition: 'SHORT', binanceSize: maxSize, binanceLeverage: 20 })
  });
  strategies.push({
    id: id++, name: `Max Funding Arb: Short Twi / Long Bin`,
    description: `Reverse funding arb. Useful when Binance funding is negative.`,
    category: 'Funding Arb', risk: 'MEDIUM',
    twilightPosition: 'SHORT', twilightSize: maxSize, twilightLeverage: 20,
    binancePosition: 'LONG', binanceSize: maxSize, binanceLeverage: 20,
    ...calc({ twilightPosition: 'SHORT', twilightSize: maxSize, twilightLeverage: 20, binancePosition: 'LONG', binanceSize: maxSize, binanceLeverage: 20 })
  });

  // ---- Conservative ----
  strategies.push({
    id: id++, name: `Conservative Hedge 5x ($100)`,
    description: `Low leverage delta-neutral for safety.`,
    category: 'Conservative', risk: 'VERY LOW',
    twilightPosition: 'LONG', twilightSize: 100, twilightLeverage: 5,
    binancePosition: 'SHORT', binanceSize: 100, binanceLeverage: 5,
    ...calc({ twilightPosition: 'LONG', twilightSize: 100, twilightLeverage: 5, binancePosition: 'SHORT', binanceSize: 100, binanceLeverage: 5 })
  });
  strategies.push({
    id: id++, name: `Conservative Hedge 5x ($50)`,
    description: `Minimal capital at risk. Test strategy for learning.`,
    category: 'Conservative', risk: 'VERY LOW',
    twilightPosition: 'LONG', twilightSize: 50, twilightLeverage: 5,
    binancePosition: 'SHORT', binanceSize: 50, binanceLeverage: 5,
    ...calc({ twilightPosition: 'LONG', twilightSize: 50, twilightLeverage: 5, binancePosition: 'SHORT', binanceSize: 50, binanceLeverage: 5 })
  });

  // ---- Capital Efficient ----
  const stablecoinSize = Math.min(150, tvl);
  strategies.push({
    id: id++, name: `Stablecoin Position (No Hedge)`,
    description: `SHORT on Twilight only. No CEX hedge = no funding bleed. Earn funding when longs > shorts.`,
    category: 'Capital Efficient', risk: 'LOW',
    twilightPosition: 'SHORT', twilightSize: stablecoinSize, twilightLeverage: 10,
    binancePosition: null, binanceSize: 0, binanceLeverage: 0,
    ...calc({ twilightPosition: 'SHORT', twilightSize: stablecoinSize, twilightLeverage: 10, binancePosition: null, binanceSize: 0, binanceLeverage: 0 })
  });
  strategies.push({
    id: id++, name: `Leveraged Long (No Hedge)`,
    description: `LONG on Twilight only. No CEX hedge = no funding bleed.`,
    category: 'Capital Efficient', risk: 'MEDIUM',
    twilightPosition: 'LONG', twilightSize: stablecoinSize, twilightLeverage: 10,
    binancePosition: null, binanceSize: 0, binanceLeverage: 0,
    ...calc({ twilightPosition: 'LONG', twilightSize: stablecoinSize, twilightLeverage: 10, binancePosition: null, binanceSize: 0, binanceLeverage: 0 })
  });

  // ---- Funding Harvest ----
  const harvestSize = Math.min(200, tvl);
  strategies.push({
    id: id++, name: `Funding Harvest (SHORT)`,
    description: isLongHeavy
      ? `PROFITABLE NOW! Book is ${(currentSkew * 100).toFixed(1)}% long. Shorts EARN ${currentTwilightAPY.toFixed(1)}% APY.`
      : `NOT PROFITABLE NOW. Book is ${(currentSkew * 100).toFixed(1)}% long. Wait until >55% long to SHORT.`,
    category: 'Funding Harvest', risk: isLongHeavy ? 'LOW' : 'HIGH',
    twilightPosition: 'SHORT', twilightSize: harvestSize, twilightLeverage: 15,
    binancePosition: null, binanceSize: 0, binanceLeverage: 0,
    isProfitableNow: isLongHeavy,
    ...calc({ twilightPosition: 'SHORT', twilightSize: harvestSize, twilightLeverage: 15, binancePosition: null, binanceSize: 0, binanceLeverage: 0 }),
    apy: isLongHeavy ? currentTwilightAPY : -currentTwilightAPY,
    monthlyPnL: isLongHeavy ? (harvestSize * (currentTwilightAPY / 100) / 12) : -(harvestSize * (currentTwilightAPY / 100) / 12)
  });
  strategies.push({
    id: id++, name: `Funding Harvest (LONG)`,
    description: isShortHeavy
      ? `PROFITABLE NOW! Book is ${(currentSkew * 100).toFixed(1)}% long. Longs EARN ${currentTwilightAPY.toFixed(1)}% APY.`
      : `NOT PROFITABLE NOW. Book is ${(currentSkew * 100).toFixed(1)}% long. Wait until <45% long to go LONG.`,
    category: 'Funding Harvest', risk: isShortHeavy ? 'LOW' : 'HIGH',
    twilightPosition: 'LONG', twilightSize: harvestSize, twilightLeverage: 15,
    binancePosition: null, binanceSize: 0, binanceLeverage: 0,
    isProfitableNow: isShortHeavy,
    ...calc({ twilightPosition: 'LONG', twilightSize: harvestSize, twilightLeverage: 15, binancePosition: null, binanceSize: 0, binanceLeverage: 0 }),
    apy: isShortHeavy ? currentTwilightAPY : -currentTwilightAPY,
    monthlyPnL: isShortHeavy ? (harvestSize * (currentTwilightAPY / 100) / 12) : -(harvestSize * (currentTwilightAPY / 100) / 12)
  });

  // ---- Dual Arb ----
  const isBinanceNegative = binanceFundingRate < 0;
  const isDualArbProfitable = isLongHeavy && isBinanceNegative;
  strategies.push({
    id: id++, name: `Dual SHORT Arb`,
    description: isDualArbProfitable
      ? `RARE OPPORTUNITY! Both sides pay YOU.`
      : `NOT PROFITABLE. Need Twilight long-heavy AND Binance funding negative.`,
    category: 'Dual Arb', risk: isDualArbProfitable ? 'LOW' : 'HIGH',
    twilightPosition: 'SHORT', twilightSize: harvestSize, twilightLeverage: 15,
    binancePosition: 'SHORT', binanceSize: harvestSize, binanceLeverage: 5,
    isProfitableNow: isDualArbProfitable,
    ...calc({ twilightPosition: 'SHORT', twilightSize: harvestSize, twilightLeverage: 15, binancePosition: 'SHORT', binanceSize: harvestSize, binanceLeverage: 5 }),
    apy: isDualArbProfitable
      ? currentTwilightAPY + Math.abs(binanceFundingRate * 3 * 365 * 100)
      : -(currentTwilightAPY + Math.abs(binanceFundingRate * 3 * 365 * 100))
  });

  const isBinancePositive = binanceFundingRate > 0.0001;
  const isDualLongArbProfitable = isShortHeavy && isBinancePositive;
  strategies.push({
    id: id++, name: `Dual LONG Arb`,
    description: isDualLongArbProfitable
      ? `RARE OPPORTUNITY! Both sides pay YOU.`
      : `NOT PROFITABLE. Need Twilight short-heavy AND Binance funding positive.`,
    category: 'Dual Arb', risk: isDualLongArbProfitable ? 'LOW' : 'HIGH',
    twilightPosition: 'LONG', twilightSize: harvestSize, twilightLeverage: 15,
    binancePosition: 'LONG', binanceSize: harvestSize, binanceLeverage: 5,
    isProfitableNow: isDualLongArbProfitable,
    ...calc({ twilightPosition: 'LONG', twilightSize: harvestSize, twilightLeverage: 15, binancePosition: 'LONG', binanceSize: harvestSize, binanceLeverage: 5 }),
    apy: isDualLongArbProfitable
      ? currentTwilightAPY + Math.abs(binanceFundingRate * 3 * 365 * 100)
      : -(currentTwilightAPY + Math.abs(binanceFundingRate * 3 * 365 * 100))
  });

  // ---- Bybit Inverse Strategies ----
  if (bybitPrice > 0) {
    const bybitAnnualizedFunding = Math.abs(bybitFundingRate) * 3 * 365 * 100;
    const isBybitNegative = bybitFundingRate < 0;
    const isBybitPositive = bybitFundingRate > 0.00005;

    const calcBybit = (twilightPos, tSize, tLev, bybitPos, bSize, bLev) => {
      const twilightMarginBTC = tSize / (tLev * btcPrice);
      const twilightMarginUSD = twilightMarginBTC * btcPrice;
      const bybitMarginBTC = bSize / (bLev * bybitPrice);
      const bybitMarginUSD = bybitMarginBTC * bybitPrice;
      const totalMargin = twilightMarginUSD + bybitMarginUSD;

      const twilightFundingEarned = twilightPos === 'LONG'
        ? (isShortHeavy ? currentTwilightAPY : -currentTwilightAPY)
        : (isLongHeavy ? currentTwilightAPY : -currentTwilightAPY);
      const bybitFundingEarned = bybitPos === 'LONG'
        ? (isBybitNegative ? bybitAnnualizedFunding : -bybitAnnualizedFunding)
        : (isBybitPositive ? bybitAnnualizedFunding : -bybitAnnualizedFunding);

      const combinedAPY = twilightFundingEarned + bybitFundingEarned;
      const twilightMonthlyFunding = tSize * (twilightFundingEarned / 100) / 12;
      const bybitMonthlyFunding = bSize * (bybitFundingEarned / 100) / 12;
      const monthlyFundingPnL = twilightMonthlyFunding + bybitMonthlyFunding;
      const bybitFees = bSize * BYBIT_TAKER_FEE * 2;
      const totalFees = bybitFees;
      const monthlyPnL = monthlyFundingPnL - (totalFees / 12);

      const twilightLiqPct = 100 / tLev * 0.9;
      const twilightLiqPrice = twilightPos === 'LONG'
        ? btcPrice * (1 - twilightLiqPct / 100) : btcPrice * (1 + twilightLiqPct / 100);
      const bybitLiqPct = 100 / bLev * 0.9;
      const bybitLiqPrice = bybitPos === 'LONG'
        ? bybitPrice * (1 - bybitLiqPct / 100) : bybitPrice * (1 + bybitLiqPct / 100);

      return {
        twilightMarginBTC, twilightMarginUSD, bybitMarginBTC, bybitMarginUSD,
        totalMargin, monthlyFundingPnL, basisProfit: 0, totalFees, monthlyPnL,
        apy: (monthlyPnL / totalMargin) * 12 * 100,
        pnlUp5: monthlyPnL, pnlUp10: monthlyPnL, pnlDown5: monthlyPnL, pnlDown10: monthlyPnL,
        priceOnlyUp5: 0, priceOnlyUp10: 0, priceOnlyDown5: 0, priceOnlyDown10: 0,
        marginChangeUp5: 0, marginChangeUp10: 0, marginChangeDown5: 0, marginChangeDown10: 0,
        twilightLiquidationPrice: twilightLiqPrice, twilightLiquidationPct: twilightLiqPct,
        binanceLiquidationPrice: bybitLiqPrice, binanceLiquidationPct: bybitLiqPct,
        twilightStopLoss: twilightPos === 'LONG' ? twilightLiqPrice * 1.1 : twilightLiqPrice * 0.9,
        twilightStopLossPct: twilightLiqPct * 0.8,
        totalMaxLoss: totalMargin * 0.1,
        breakEvenDays: totalFees > 0 ? Math.ceil(totalFees / (monthlyFundingPnL / 30)) : 1
      };
    };

    const bybitConfigs = [
      { name: 'Inverse Arb: Short Twi / Long Bybit 10x', tP: 'SHORT', bP: 'LONG', size: Math.min(200, tvl), tL: 10, bL: 10, risk: 'MEDIUM' },
      { name: 'Inverse Arb: Long Twi / Short Bybit 10x', tP: 'LONG', bP: 'SHORT', size: Math.min(200, tvl), tL: 10, bL: 10, risk: 'MEDIUM' },
      { name: 'Max Inverse Arb 20x: Short Twi / Long Bybit', tP: 'SHORT', bP: 'LONG', size: Math.min(300, tvl), tL: 20, bL: 20, risk: 'HIGH' },
      { name: 'Conservative Inverse 5x: Short Twi / Long Bybit', tP: 'SHORT', bP: 'LONG', size: 100, tL: 5, bL: 5, risk: 'LOW' },
      { name: 'Funding Capture 15x: Short Twi / Long Bybit', tP: 'SHORT', bP: 'LONG', size: 200, tL: 15, bL: 15, risk: 'MEDIUM' },
      { name: 'Large Inverse Arb 10x: Short Twi / Long Bybit', tP: 'SHORT', bP: 'LONG', size: Math.min(500, tvl), tL: 10, bL: 10, risk: 'MEDIUM' },
      { name: 'Mini Inverse 3x: Short Twi / Long Bybit', tP: 'SHORT', bP: 'LONG', size: 50, tL: 3, bL: 3, risk: 'VERY LOW' },
      { name: 'Asymmetric 5x/10x: Short Twi / Long Bybit', tP: 'SHORT', bP: 'LONG', size: 150, tL: 5, bL: 10, risk: 'LOW' },
      { name: 'Large Reverse Arb 10x: Long Twi / Short Bybit', tP: 'LONG', bP: 'SHORT', size: Math.min(500, tvl), tL: 10, bL: 10, risk: 'MEDIUM' },
      { name: 'Conservative Reverse 5x: Long Twi / Short Bybit', tP: 'LONG', bP: 'SHORT', size: 100, tL: 5, bL: 5, risk: 'LOW' },
    ];

    // Spread capture
    const spreadBps = bybitPrice > 0 ? Math.abs((btcPrice - bybitPrice) / bybitPrice * 10000) : 0;
    const spreadStrat = calcBybit('SHORT', 300, 10, 'LONG', 300, 10);
    strategies.push({
      id: id++, name: `Spread Capture 10x`,
      description: `Capture price spread between venues. Current spread: ${spreadBps.toFixed(1)} bps.`,
      category: 'Bybit Inverse', risk: 'MEDIUM', isBybitStrategy: true,
      twilightPosition: btcPrice > bybitPrice ? 'SHORT' : 'LONG',
      twilightSize: 300, twilightLeverage: 10,
      binancePosition: btcPrice > bybitPrice ? 'LONG' : 'SHORT',
      binanceSize: 300, binanceLeverage: 10,
      bybitPrice, bybitFundingRate, spreadBps,
      ...spreadStrat
    });

    // Funding diff capture
    const twilightPer8hPct = twilightFundingRate * 100;
    const bybitPer8hPct = bybitFundingRate * 100;
    const fundingDiff = Math.abs(twilightPer8hPct - bybitPer8hPct);
    const fdStrat = calcBybit('SHORT', 250, 10, 'LONG', 250, 10);
    strategies.push({
      id: id++, name: `Funding Diff Capture`,
      description: `Capture funding rate differential. Twilight: ${twilightPer8hPct.toFixed(4)}%/8h. Bybit: ${bybitPer8hPct.toFixed(4)}%/8h. Diff: ${fundingDiff.toFixed(4)}%/8h.`,
      category: 'Bybit Inverse', risk: 'MEDIUM', isBybitStrategy: true,
      twilightPosition: 'SHORT', twilightSize: 250, twilightLeverage: 10,
      binancePosition: 'LONG', binanceSize: 250, binanceLeverage: 10,
      bybitPrice, bybitFundingRate, fundingDiff,
      ...fdStrat
    });

    for (const cfg of bybitConfigs) {
      const strat = calcBybit(cfg.tP, cfg.size, cfg.tL, cfg.bP, cfg.size, cfg.bL);
      strategies.push({
        id: id++, name: cfg.name,
        description: `Bybit inverse perp strategy. ${cfg.tP} Twilight / ${cfg.bP} Bybit @ ${cfg.tL}x/${cfg.bL}x, $${cfg.size}.`,
        category: 'Bybit Inverse', risk: cfg.risk, isBybitStrategy: true,
        twilightPosition: cfg.tP, twilightSize: cfg.size, twilightLeverage: cfg.tL,
        binancePosition: cfg.bP, binanceSize: cfg.size, binanceLeverage: cfg.bL,
        bybitPrice, bybitFundingRate,
        ...strat
      });
    }
  }

  return strategies.sort((a, b) => b.apy - a.apy);
}

module.exports = { generateStrategies };
