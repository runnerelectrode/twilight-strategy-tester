/**
 * Spread Strategies
 * ================
 *
 * Twilight's price is based on Binance spot. The first two strategies are therefore
 * Binance spot (via Twilight) vs Binance futures: classic spot–futures basis trades.
 *
 * 1. Long Twi / Short Bin = Long Binance spot (Twilight) + Short Binance perpetual.
 *    When futures trade above spot (positive basis), you capture convergence + funding.
 *
 * 2. Short Twi / Long Bin = Short Binance spot (Twilight) + Long Binance perpetual.
 *    When futures trade below spot (negative basis), you capture convergence + funding.
 *
 * Spread in the app: spread = twilightPrice - cexPrice (= Binance spot - Binance futures).
 * When spread < 0, futures > spot (typical positive funding). When spread > 0, spot > futures.
 *
 * P&L components:
 *
 * 1. BASIS (convergence)
 *    When the spot–futures gap narrows, the hedge locks in profit.
 *    In the main APY calculator, for opposite-side hedges:
 *      basisProfit = |spread| × positionBTC
 *    where positionBTC = min(twilightSize, binanceSize) / btcPrice.
 *
 * 2. FUNDING
 *    - Twilight: earn or pay based on pool skew.
 *    - Binance futures: earn or pay the exchange funding rate (8h).
 *    Net funding adds to or subtracts from basis profit.
 *
 * 3. FEES
 *    CEX round-trip fees (e.g. Binance 0.04% × 2) reduce net P&L.
 *
 * Monthly P&L: monthlyPnL ≈ basisProfit + monthlyFundingPnL - (totalFees / 12)
 * APY: (monthlyPnL / totalMargin) × 12 × 100.
 *
 * Third strategy: Cross-venue (Twi spot vs Bybit perp), short higher venue / long lower; when Bybit connected.
 */

/** Default notional (USD) and leverage for spread strategies. */
const SPREAD_DEFAULT_SIZE = 150;
const SPREAD_LEVERAGE = 10;

/**
 * Build the list of spread strategy objects. Each strategy uses the shared APY
 * calculator (and optionally the Bybit calculator) so PnL includes basis + funding - fees.
 *
 * @param {Object} params
 * @param {number} params.idStart - Next id to assign (ids will be idStart, idStart+1, ...).
 * @param {number} params.tvl - Total value locked; spread size is min(SPREAD_DEFAULT_SIZE, tvl).
 * @param {number} params.twilightPrice - Twilight price (= Binance spot in the app).
 * @param {number} params.cexPrice - Binance futures price (for basis bps and Binance legs).
 * @param {number} params.bybitPrice - Bybit price; when > 0 we add the Twi vs Bybit strategy.
 * @param {number} params.bybitFundingRate - Bybit funding rate (used for Twi vs Bybit strategy).
 * @param {Function} params.calculateStrategyAPY - (strategy) => metrics (used for Binance spread strategies).
 * @param {Function|null} params.calculateBybitStrategy - (twPos, twSize, twLev, bybitPos, bybitSize, bybitLev) => metrics, or null to skip Bybit spread.
 * @returns {Array<Object>} Array of strategy objects (id, name, description, category, isSpreadStrategy, positions, risk, ...metrics).
 */
export function buildSpreadStrategies({
  idStart,
  tvl,
  twilightPrice,
  cexPrice,
  bybitPrice,
  bybitFundingRate,
  calculateStrategyAPY,
  calculateBybitStrategy,
}) {
  const spreadSize = Math.min(SPREAD_DEFAULT_SIZE, tvl);
  const spreadLev = SPREAD_LEVERAGE;
  const strategies = [];
  let nextId = idStart;

  // Basis (bps) = |Binance spot (Twi) - Binance futures|; when futures > spot, typical positive funding.
  const spreadBps = cexPrice > 0 ? Math.abs((twilightPrice - cexPrice) / cexPrice * 10000) : 0;

  // --- Spot–futures basis: Long spot (Twilight) / Short Binance perpetual ---
  strategies.push({
    id: nextId++,
    name: `Spot–futures basis: Long spot / Short perp ${spreadLev}x`,
    description: `Twilight = Binance spot. Long spot + Short Binance perp. Capture basis (${spreadBps.toFixed(1)} bps) when futures converge to spot + funding.`,
    category: 'Spread',
    isSpreadStrategy: true,
    twilightPosition: 'LONG',
    twilightSize: spreadSize,
    twilightLeverage: spreadLev,
    binancePosition: 'SHORT',
    binanceSize: spreadSize,
    binanceLeverage: spreadLev,
    risk: 'LOW',
    ...calculateStrategyAPY({
      twilightPosition: 'LONG',
      twilightSize: spreadSize,
      twilightLeverage: spreadLev,
      binancePosition: 'SHORT',
      binanceSize: spreadSize,
      binanceLeverage: spreadLev,
    }),
  });

  // --- Spot–futures basis: Short spot (Twilight) / Long Binance perpetual ---
  strategies.push({
    id: nextId++,
    name: `Spot–futures basis: Short spot / Long perp ${spreadLev}x`,
    description: `Twilight = Binance spot. Short spot + Long Binance perp. Capture basis when futures trade below spot + funding.`,
    category: 'Spread',
    isSpreadStrategy: true,
    twilightPosition: 'SHORT',
    twilightSize: spreadSize,
    twilightLeverage: spreadLev,
    binancePosition: 'LONG',
    binanceSize: spreadSize,
    binanceLeverage: spreadLev,
    risk: 'LOW',
    ...calculateStrategyAPY({
      twilightPosition: 'SHORT',
      twilightSize: spreadSize,
      twilightLeverage: spreadLev,
      binancePosition: 'LONG',
      binanceSize: spreadSize,
      binanceLeverage: spreadLev,
    }),
  });

  // --- Cross-venue spread: Twilight vs Bybit (only when Bybit calculator is provided) ---
  if (bybitPrice > 0 && typeof calculateBybitStrategy === 'function') {
    const bybitSpreadBps = Math.abs((twilightPrice - bybitPrice) / bybitPrice * 10000);
    const twiShort = twilightPrice > bybitPrice;
    strategies.push({
      id: nextId++,
      name: `Cross-venue spread: Twi spot vs Bybit perp ${spreadLev}x`,
      description: `Twilight = Binance spot vs Bybit perp. Short higher venue, long lower. Spread: ${bybitSpreadBps.toFixed(1)} bps. Capture when they converge.`,
      category: 'Spread',
      isSpreadStrategy: true,
      twilightPosition: twiShort ? 'SHORT' : 'LONG',
      twilightSize: spreadSize,
      twilightLeverage: spreadLev,
      binancePosition: twiShort ? 'LONG' : 'SHORT',
      binanceSize: spreadSize,
      binanceLeverage: spreadLev,
      risk: 'MEDIUM',
      isBybitStrategy: true,
      bybitPrice,
      bybitFundingRate,
      ...calculateBybitStrategy(
        twiShort ? 'SHORT' : 'LONG',
        spreadSize,
        spreadLev,
        twiShort ? 'LONG' : 'SHORT',
        spreadSize,
        spreadLev
      ),
    });
  }

  return strategies;
}
