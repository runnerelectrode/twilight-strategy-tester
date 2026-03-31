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
  const tfr = getTwilightFundingRate(poolConfig.twilightLongSize, poolConfig.twilightShortSize, md.binanceFundingRate, poolConfig.twilightFundingCapPct);
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
      twilight: { rate: tfr, ratePct: (tfr * 100).toFixed(4) + '%', annualizedAPY: currentTwilightAPY.toFixed(2) + '%' },
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
app.post('/api/impact', (req, res) => {
  const md = market.getMarketData();
  if (md.twilightPrice === 0) return res.status(503).json({ error: 'Market data not yet available.' });

  const { tradeSize, direction } = req.body;
  if (!tradeSize || !direction) {
    return res.status(400).json({ error: 'tradeSize and direction (LONG/SHORT) required.' });
  }

  const longImpact = calculateTradeImpact(Number(tradeSize), 'LONG', poolConfig, md);
  const shortImpact = calculateTradeImpact(Number(tradeSize), 'SHORT', poolConfig, md);

  res.json({
    timestamp: new Date().toISOString(),
    tradeSize: Number(tradeSize),
    currentSkew: (poolConfig.twilightLongSize + poolConfig.twilightShortSize) > 0
      ? poolConfig.twilightLongSize / (poolConfig.twilightLongSize + poolConfig.twilightShortSize) : 0.5,
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
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n========================================`);
  console.log(`  Twilight Strategy API`);
  console.log(`  Running on port ${PORT}`);
  console.log(`  Health: http://0.0.0.0:${PORT}/api/health`);
  console.log(`========================================\n`);
});
