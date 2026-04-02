/**
 * Lending Pool + Perp Hedge Strategies
 * -----------------------------------
 * When you lend to the Twilight pool you earn APY. Depending on skew:
 * - Pool long-heavy (long_pct > 0.5) → lender is effectively short → hedge with Long Twilight perp.
 * - Pool short-heavy (short_pct > 0.5) → lender is effectively long → hedge with Short Twilight perp.
 * The hedge is an inverse perp position with NOTIONAL EQUAL to the amount lent (e.g. lend $68k at $68k/BTC = 1 BTC perp hedge).
 * APY and PnL = pool lending APY + perp funding/PnL; total margin = amount lent + perp margin.
 */

const LEND_SIZE_DEFAULT = 100_000; // USD notional lent to pool; hedge notional = same amount
const HEDGE_LEVERAGE = 10; // Used only for perp margin calculation; hedge size = lend amount

/**
 * Build lending-pool strategy objects.
 * Hedge notional = lend amount (USD). Position in BTC terms = lendSize / btcPrice.
 * @param {Object} params
 * @param {number} params.idStart
 * @param {Object} params.marketStats - { longPct, shortPct, poolEquityBtc, utilization, status }
 * @param {number|null} params.poolApy24h - last 24h APY % (e.g. 8.21)
 * @param {number} params.btcPrice - for USD conversion and BTC notional display
 * @param {number} params.tvl
 * @param {Function} params.calculateStrategyAPY - (strategy) => metrics (Twilight perp leg only; binancePosition null)
 * @returns {Array<Object>} Strategy objects with isLendingPoolStrategy: true, category: 'Lending Pool'
 */
export function buildLendingPoolStrategies({
  idStart,
  marketStats,
  poolApy24h,
  btcPrice,
  tvl,
  calculateStrategyAPY,
}) {
  const strategies = [];
  let nextId = idStart;

  if (!marketStats || btcPrice <= 0) return strategies;
  const { longPct, shortPct } = marketStats;
  const apyDisplay = poolApy24h != null ? poolApy24h.toFixed(2) : '—';
  const lendSize = Math.min(LEND_SIZE_DEFAULT, tvl);
  // Hedge notional = lend amount (same USD); perp position size in BTC for display
  const hedgeNotionalUsd = lendSize;
  const hedgeBtc = hedgeNotionalUsd / btcPrice;
  const btcLabel = hedgeBtc >= 0.01 ? hedgeBtc.toFixed(2) : hedgeBtc.toFixed(4);

  const poolMonthlyPnL = poolApy24h != null ? lendSize * (poolApy24h / 100) / 12 : 0;

  // Pool long-heavy → lender short → hedge with Long perp (notional = lend amount)
  if (longPct > 0.5) {
    const hedgeMetrics = calculateStrategyAPY({
      twilightPosition: 'LONG',
      twilightSize: hedgeNotionalUsd,
      twilightLeverage: HEDGE_LEVERAGE,
      binancePosition: null,
      binanceSize: 0,
      binanceLeverage: 0,
    });
    const perpMargin = hedgeMetrics.totalMargin ?? 0;
    const totalMargin = lendSize + perpMargin;
    const monthlyPnL = poolMonthlyPnL + (hedgeMetrics.monthlyPnL ?? 0);
    const monthlyROI = totalMargin > 0 ? monthlyPnL / totalMargin : 0;
    const apy = totalMargin > 0 ? ((1 + monthlyROI) ** 12 - 1) * 100 : 0;
    const apr = totalMargin > 0 ? monthlyROI * 12 * 100 : 0;
    strategies.push({
      id: nextId++,
      name: `Lend to pool + Long perp hedge (${btcLabel} BTC notional)`,
      description: `Pool ${(longPct * 100).toFixed(1)}% long → lender short. Earn pool APY (${apyDisplay}%) + hedge with Long inverse perp of equal notional ($${hedgeNotionalUsd.toLocaleString()}).`,
      category: 'Lending Pool',
      isLendingPoolStrategy: true,
      twilightPosition: 'LONG',
      twilightSize: hedgeNotionalUsd,
      twilightLeverage: HEDGE_LEVERAGE,
      binancePosition: null,
      binanceSize: 0,
      binanceLeverage: 0,
      risk: 'LOW',
      poolApy24h: poolApy24h,
      ...hedgeMetrics,
      totalMargin,
      monthlyPnL,
      apy,
      apr,
      pnlUp5: poolMonthlyPnL + (hedgeMetrics.pnlUp5 ?? 0),
      pnlDown5: poolMonthlyPnL + (hedgeMetrics.pnlDown5 ?? 0),
    });
  }

  // Pool short-heavy → lender long → hedge with Short perp (notional = lend amount)
  if (shortPct > 0.5) {
    const hedgeMetrics = calculateStrategyAPY({
      twilightPosition: 'SHORT',
      twilightSize: hedgeNotionalUsd,
      twilightLeverage: HEDGE_LEVERAGE,
      binancePosition: null,
      binanceSize: 0,
      binanceLeverage: 0,
    });
    const perpMargin = hedgeMetrics.totalMargin ?? 0;
    const totalMargin = lendSize + perpMargin;
    const monthlyPnL = poolMonthlyPnL + (hedgeMetrics.monthlyPnL ?? 0);
    const monthlyROI = totalMargin > 0 ? monthlyPnL / totalMargin : 0;
    const apy = totalMargin > 0 ? ((1 + monthlyROI) ** 12 - 1) * 100 : 0;
    const apr = totalMargin > 0 ? monthlyROI * 12 * 100 : 0;
    strategies.push({
      id: nextId++,
      name: `Lend to pool + Short perp hedge (${btcLabel} BTC notional)`,
      description: `Pool ${(shortPct * 100).toFixed(1)}% short → lender long. Earn pool APY (${apyDisplay}%) + hedge with Short inverse perp of equal notional ($${hedgeNotionalUsd.toLocaleString()}).`,
      category: 'Lending Pool',
      isLendingPoolStrategy: true,
      twilightPosition: 'SHORT',
      twilightSize: hedgeNotionalUsd,
      twilightLeverage: HEDGE_LEVERAGE,
      binancePosition: null,
      binanceSize: 0,
      binanceLeverage: 0,
      risk: 'LOW',
      poolApy24h: poolApy24h,
      ...hedgeMetrics,
      totalMargin,
      monthlyPnL,
      apy,
      apr,
      pnlUp5: poolMonthlyPnL + (hedgeMetrics.pnlUp5 ?? 0),
      pnlDown5: poolMonthlyPnL + (hedgeMetrics.pnlDown5 ?? 0),
    });
  }

  // Lend only (no hedge) for comparison — use published pool APY as-is so it matches the API/card
  strategies.push({
    id: nextId++,
    name: `Lend to pool only (no hedge)`,
    description: `Earn pool APY (${apyDisplay}%). You take skew risk: long-heavy pool = you are short; short-heavy = you are long.`,
    category: 'Lending Pool',
    isLendingPoolStrategy: true,
    twilightPosition: null,
    twilightSize: 0,
    twilightLeverage: 0,
    binancePosition: null,
    binanceSize: 0,
    binanceLeverage: 0,
    risk: 'MEDIUM',
    poolApy24h: poolApy24h,
    totalMargin: lendSize,
    monthlyPnL: poolApy24h != null ? lendSize * (poolApy24h / 100) / 12 : 0,
    apy: poolApy24h ?? 0,
    apr: poolApy24h != null ? ((1 + poolApy24h / 100) ** (1 / 12) - 1) * 12 * 100 : 0,
    pnlUp5: null,
    pnlDown5: null,
    targetTwilightRatePct: null,
  });

  return strategies;
}
