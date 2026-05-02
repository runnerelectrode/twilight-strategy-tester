const express = require('express');
const cors = require('cors');
const MarketDataManager = require('./lib/market');
const { generateStrategies } = require('./lib/strategies');
const { calculateStrategyAPY, calculateTradeImpact, getTwilightFundingRate } = require('./lib/calculations');

const app = express();
app.use(cors());
app.use(express.json());

// ===========================
// API KEY AUTH
// ===========================
const API_KEY = process.env.API_KEY || '123hEll@he';

function authMiddleware(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (!key || key !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized. Provide x-api-key header or api_key query param.' });
  }
  next();
}

// ===========================
// MARKET DATA
// ===========================
const market = new MarketDataManager();
market.start();

// ===========================
// POOL CONFIG (mutable state)
// ===========================
let poolConfig = {
  totalPoolSize: 10000000,
  poolSkewPct: 65,
  twilightLongSize: Math.round(10000000 * 0.65),
  twilightShortSize: Math.round(10000000 * 0.35),
  twilightFundingCapPct: 0,
  tvl: 30000000,
};

function updatePoolDerived() {
  poolConfig.twilightLongSize = Math.round(poolConfig.totalPoolSize * (poolConfig.poolSkewPct / 100));
  poolConfig.twilightShortSize = Math.round(poolConfig.totalPoolSize * ((100 - poolConfig.poolSkewPct) / 100));
}

// ===========================
// PUBLIC ROUTES
// ===========================
app.get('/api/health', (req, res) => {
  const md = market.getMarketData();
  const st = market.getStatus();
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    market: {
      twilightPrice: md.twilightPrice,
      cexPrice: md.cexPrice,
      bybitPrice: md.bybitPrice,
    },
    connections: st,
  });
});

// ===========================
// AUTHENTICATED ROUTES
// ===========================
app.use('/api', authMiddleware);

// --- Market Data ---
app.get('/api/market', (req, res) => {
  const md = market.getMarketData();
  const st = market.getStatus();
  const tfr = getTwilightFundingRate(md.twilightFundingRate, poolConfig.twilightLongSize, poolConfig.twilightShortSize, md.binanceFundingRate, poolConfig.twilightFundingCapPct);
  const tfrSource = (typeof md.twilightFundingRate === 'number' && Number.isFinite(md.twilightFundingRate)) ? 'relayer' : 'computed';
  const tfrEst = (typeof md.twilightEstimatedFundingRate === 'number' && Number.isFinite(md.twilightEstimatedFundingRate)) ? md.twilightEstimatedFundingRate : null;
  const currentSkew = (poolConfig.twilightLongSize + poolConfig.twilightShortSize) > 0
    ? poolConfig.twilightLongSize / (poolConfig.twilightLongSize + poolConfig.twilightShortSize) : 0.5;
  const currentTwilightAPY = Math.abs(tfr) * 3 * 365 * 100;

  const spread = md.twilightPrice - md.cexPrice;
  const spreadPercent = md.cexPrice > 0 ? ((spread / md.cexPrice) * 100) : 0;
  const bybitSpread = md.bybitPrice > 0 ? md.twilightPrice - md.bybitPrice : 0;
  const bybitSpreadPercent = md.bybitPrice > 0 ? ((bybitSpread / md.bybitPrice) * 100) : 0;

  res.json({
    prices: {
      twilight: md.twilightPrice,
      binanceFutures: md.cexPrice,
      binanceMarkPrice: md.markPrice,
      bybit: md.bybitPrice,
    },
    fundingRates: {
      binance: { rate: md.binanceFundingRate, ratePct: (md.binanceFundingRate * 100).toFixed(4) + '%', annualizedAPY: (Math.abs(md.binanceFundingRate) * 3 * 365 * 100).toFixed(2) + '%', nextFundingTime: md.nextFundingTime },
      twilight: {
        rate: tfr,
        ratePct: (tfr * 100).toFixed(4) + '%',
        annualizedAPY: currentTwilightAPY.toFixed(2) + '%',
        source: tfrSource,
        lastFundingTimestamp: md.twilightFundingTimestamp,
        estimatedRate: tfrEst,
        estimatedRatePct: tfrEst !== null ? (tfrEst * 100).toFixed(4) + '%' : null,
        estimatedAPY: tfrEst !== null ? (Math.abs(tfrEst) * 3 * 365 * 100).toFixed(2) + '%' : null,
        nextFundingTimestamp: md.twilightEstimatedFundingTimestamp,
      },
      bybit: md.bybitPrice > 0 ? { rate: md.bybitFundingRate, ratePct: (md.bybitFundingRate * 100).toFixed(4) + '%', annualizedAPY: (Math.abs(md.bybitFundingRate) * 3 * 365 * 100).toFixed(2) + '%', nextFundingTime: md.bybitNextFundingTime } : null,
    },
    spreads: {
      twilightVsBinance: { usd: spread, pct: spreadPercent.toFixed(4) + '%' },
      twilightVsBybit: md.bybitPrice > 0 ? { usd: bybitSpread, pct: bybitSpreadPercent.toFixed(4) + '%' } : null,
    },
    pool: {
      currentSkew,
      currentSkewPct: (currentSkew * 100).toFixed(1) + '%',
      isLongHeavy: currentSkew > 0.55,
      isShortHeavy: currentSkew < 0.45,
    },
    chainPool: md.twilightStatus ? {
      status: md.twilightStatus,
      statusReason: md.twilightStatusReason,
      longPct: md.twilightLongPct,
      shortPct: md.twilightShortPct,
      totalLongBtc: md.twilightTotalLongBtc,
      totalShortBtc: md.twilightTotalShortBtc,
      openInterestBtc: md.twilightOpenInterestBtc,
      poolEquityBtc: md.twilightPoolEquityBtc,
      utilization: md.twilightUtilization,
      utilizationPct: md.twilightUtilization !== null ? (md.twilightUtilization * 100).toFixed(2) + '%' : null,
      riskParams: md.twilightRiskParams,
    } : null,
    connections: st,
  });
});

// --- Pool Configuration ---
app.get('/api/pool', (req, res) => {
  res.json(poolConfig);
});

app.post('/api/pool', (req, res) => {
  const { totalPoolSize, poolSkewPct, twilightFundingCapPct, tvl } = req.body;
  if (totalPoolSize !== undefined) poolConfig.totalPoolSize = Number(totalPoolSize);
  if (poolSkewPct !== undefined) poolConfig.poolSkewPct = Math.max(0, Math.min(100, Number(poolSkewPct)));
  if (twilightFundingCapPct !== undefined) poolConfig.twilightFundingCapPct = Math.max(0, Math.min(100, Number(twilightFundingCapPct)));
  if (tvl !== undefined) poolConfig.tvl = Number(tvl);
  updatePoolDerived();
  res.json({ message: 'Pool config updated', pool: poolConfig });
});

// --- Strategies ---
app.get('/api/strategies', (req, res) => {
  const md = market.getMarketData();
  if (md.twilightPrice === 0) {
    return res.status(503).json({ error: 'Market data not yet available. WebSockets connecting...' });
  }

  let strategies = generateStrategies(md, poolConfig);

  // Filter by category
  if (req.query.category) {
    strategies = strategies.filter(s => s.category.toLowerCase() === req.query.category.toLowerCase());
  }
  // Filter by risk
  if (req.query.risk) {
    strategies = strategies.filter(s => s.risk.toLowerCase() === req.query.risk.toLowerCase());
  }
  // Filter profitable only
  if (req.query.profitable === 'true') {
    strategies = strategies.filter(s => s.apy > 0);
  }
  // Filter by min APY
  if (req.query.minApy) {
    strategies = strategies.filter(s => s.apy >= Number(req.query.minApy));
  }
  // Limit
  if (req.query.limit) {
    strategies = strategies.slice(0, Number(req.query.limit));
  }

  res.json({
    count: strategies.length,
    timestamp: new Date().toISOString(),
    btcPrice: md.twilightPrice,
    strategies,
  });
});

app.get('/api/strategies/:id', (req, res) => {
  const md = market.getMarketData();
  if (md.twilightPrice === 0) return res.status(503).json({ error: 'Market data not yet available.' });

  const strategies = generateStrategies(md, poolConfig);
  const strategy = strategies.find(s => s.id === Number(req.params.id));
  if (!strategy) return res.status(404).json({ error: 'Strategy not found' });
  res.json(strategy);
});

// --- Run Custom Strategy ---
app.post('/api/strategies/run', (req, res) => {
  const md = market.getMarketData();
  if (md.twilightPrice === 0) return res.status(503).json({ error: 'Market data not yet available.' });

  const {
    twilightPosition, twilightSize, twilightLeverage,
    binancePosition, binanceSize, binanceLeverage,
    // Optional pool overrides
    totalPoolSize, poolSkewPct, twilightFundingCapPct
  } = req.body;

  if (!twilightPosition && !binancePosition) {
    return res.status(400).json({ error: 'At least one of twilightPosition or binancePosition must be provided.' });
  }

  // Use custom pool or default
  const customPool = { ...poolConfig };
  if (totalPoolSize !== undefined) customPool.totalPoolSize = Number(totalPoolSize);
  if (poolSkewPct !== undefined) customPool.poolSkewPct = Math.max(0, Math.min(100, Number(poolSkewPct)));
  if (twilightFundingCapPct !== undefined) customPool.twilightFundingCapPct = Math.max(0, Math.min(100, Number(twilightFundingCapPct)));
  customPool.twilightLongSize = Math.round(customPool.totalPoolSize * (customPool.poolSkewPct / 100));
  customPool.twilightShortSize = Math.round(customPool.totalPoolSize * ((100 - customPool.poolSkewPct) / 100));

  const strategyInput = {
    twilightPosition: twilightPosition || null,
    twilightSize: Number(twilightSize) || 0,
    twilightLeverage: Number(twilightLeverage) || 0,
    binancePosition: binancePosition || null,
    binanceSize: Number(binanceSize) || 0,
    binanceLeverage: Number(binanceLeverage) || 0,
  };

  const result = calculateStrategyAPY(strategyInput, md, customPool);

  res.json({
    timestamp: new Date().toISOString(),
    btcPrice: md.twilightPrice,
    input: strategyInput,
    poolConfig: customPool,
    result,
  });
});

// --- Trade Impact ---
// Phase 3.5: prefer live chain pool sizes over the manually-configured poolConfig.
// When chain data is available, the impact answer agrees with the chainPool block
// in /api/market — same skew baseline, same long/short notional. Falls back to
// poolConfig only if chain feed is missing.
app.post('/api/impact', (req, res) => {
  const md = market.getMarketData();
  if (md.twilightPrice === 0) return res.status(503).json({ error: 'Market data not yet available.' });

  const { tradeSize, direction } = req.body;
  if (!tradeSize || !direction) {
    return res.status(400).json({ error: 'tradeSize and direction (LONG/SHORT) required.' });
  }

  const useChain = Number.isFinite(md.twilightTotalLongBtc)
                && Number.isFinite(md.twilightTotalShortBtc)
                && Number.isFinite(md.twilightPrice) && md.twilightPrice > 0;
  const effectivePool = useChain
    ? {
        ...poolConfig,
        // Chain values look like BTC by field name but are actually sats —
        // verified empirically: pre-trade total_*_btc=4040 and a 102000-sat
        // short reported back as total_short_btc=106040 (delta = exactly the
        // sat amount). Divide by 1e8 to convert sats → BTC before pricing.
        twilightLongSize:  Math.round(md.twilightTotalLongBtc  * md.twilightPrice / 1e8),
        twilightShortSize: Math.round(md.twilightTotalShortBtc * md.twilightPrice / 1e8),
      }
    : poolConfig;

  const longImpact  = calculateTradeImpact(Number(tradeSize), 'LONG',  effectivePool, md);
  const shortImpact = calculateTradeImpact(Number(tradeSize), 'SHORT', effectivePool, md);
  const totalSize   = effectivePool.twilightLongSize + effectivePool.twilightShortSize;
  const currentSkew = totalSize > 0 ? effectivePool.twilightLongSize / totalSize : 0.5;

  res.json({
    timestamp: new Date().toISOString(),
    tradeSize: Number(tradeSize),
    source: useChain ? 'chain' : 'config',
    poolUsed: {
      twilightLongSize:  effectivePool.twilightLongSize,
      twilightShortSize: effectivePool.twilightShortSize,
      twilightFundingCapPct: effectivePool.twilightFundingCapPct,
    },
    currentSkew,
    longImpact,
    shortImpact,
  });
});

// --- Categories & Filters Info ---
app.get('/api/categories', (req, res) => {
  res.json({
    categories: ['Directional', 'CEX Only', 'Delta-Neutral', 'Funding Arb', 'Conservative', 'Capital Efficient', 'Funding Harvest', 'Dual Arb', 'Bybit Inverse'],
    riskLevels: ['VERY LOW', 'LOW', 'MEDIUM', 'HIGH'],
    filters: {
      category: 'Filter by strategy category',
      risk: 'Filter by risk level',
      profitable: 'Set to "true" to show only profitable strategies',
      minApy: 'Minimum APY threshold',
      limit: 'Max number of strategies to return',
    },
  });
});

// ===========================
// START SERVER
// ===========================
const PORT = process.env.PORT || 3000;
// Hardening: bind localhost only by default. nginx is the public-facing layer
// (port 80/443) and proxies /api/* to localhost:3000. Set STRATEGY_API_BIND=0.0.0.0
// to expose port 3000 directly (legacy / development).
const BIND_HOST = process.env.STRATEGY_API_BIND || '127.0.0.1';
app.listen(PORT, BIND_HOST, () => {
  console.log(`\n========================================`);
  console.log(`  Twilight Strategy API`);
  console.log(`  Bound on ${BIND_HOST}:${PORT}`);
  console.log(`  Health: http://${BIND_HOST}:${PORT}/api/health`);
  console.log(`========================================\n`);
});
