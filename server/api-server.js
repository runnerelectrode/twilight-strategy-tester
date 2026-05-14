import http from 'node:http';
import { URL } from 'node:url';
import {
  DEFAULT_PARAMS,
  generateTwilightStrategies,
  calculateTradeImpact,
  calculateTwilightFundingRate,
  resolveEffectiveTwilightRate,
} from '../api/calculators/twilight.js';

const HOST = process.env.API_HOST ?? '0.0.0.0';
const PORT = Number(process.env.API_PORT ?? process.env.PORT ?? 3001);
const JSON_BODY_LIMIT_BYTES = 1024 * 1024;

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, statusCode, payload) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}

function sendNoContent(res) {
  setCorsHeaders(res);
  res.writeHead(204);
  res.end();
}

function sendMethodNotAllowed(res, allowedMethods) {
  res.setHeader('Allow', allowedMethods.join(', '));
  sendJson(res, 405, {
    error: 'Method Not Allowed',
    allowedMethods,
  });
}

function sendNotFound(res, pathname) {
  sendJson(res, 404, {
    error: 'Not Found',
    message: `No API route matches ${pathname}.`,
  });
}

function sendBadRequest(res, message, details) {
  sendJson(res, 400, {
    error: 'Bad Request',
    message,
    ...(details ? { details } : {}),
  });
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
  }
  return fallback;
}

function parseOptionalNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function buildStrategyParams(input = {}) {
  const params = {};
  const numericKeys = Object.keys(DEFAULT_PARAMS).filter((key) => key !== 'pegTwilightToCapRate');

  for (const key of numericKeys) {
    const parsed = parseOptionalNumber(input[key]);
    if (parsed === undefined) continue;
    if (Number.isNaN(parsed)) {
      throw new Error(`"${key}" must be a valid number.`);
    }
    params[key] = parsed;
  }

  if (input.pegTwilightToCapRate !== undefined) {
    params.pegTwilightToCapRate = parseBoolean(input.pegTwilightToCapRate, DEFAULT_PARAMS.pegTwilightToCapRate);
  }

  return params;
}

function buildTradeImpactParams(input = {}) {
  const direction = typeof input.direction === 'string'
    ? input.direction.trim().toUpperCase()
    : '';

  if (!['LONG', 'SHORT'].includes(direction)) {
    throw new Error('"direction" must be either "LONG" or "SHORT".');
  }

  const requiredNumericKeys = [
    'tradeSize',
    'longSize',
    'shortSize',
  ];

  const params = { direction };

  for (const key of requiredNumericKeys) {
    const parsed = parseOptionalNumber(input[key]);
    if (parsed === undefined || Number.isNaN(parsed)) {
      throw new Error(`"${key}" is required and must be a valid number.`);
    }
    params[key] = parsed;
  }

  const binanceFundingRate = parseOptionalNumber(input.binanceFundingRate);
  if (Number.isNaN(binanceFundingRate)) {
    throw new Error('"binanceFundingRate" must be a valid number when provided.');
  }

  const twilightFundingCapPct = parseOptionalNumber(input.twilightFundingCapPct);
  if (Number.isNaN(twilightFundingCapPct)) {
    throw new Error('"twilightFundingCapPct" must be a valid number when provided.');
  }

  params.binanceFundingRate = binanceFundingRate ?? 0;
  params.twilightFundingCapPct = twilightFundingCapPct ?? 0;
  params.pegTwilightToCapRate = parseBoolean(input.pegTwilightToCapRate, false);
  return params;
}

async function readJsonBody(req) {
  const chunks = [];
  let totalLength = 0;

  for await (const chunk of req) {
    totalLength += chunk.length;
    if (totalLength > JSON_BODY_LIMIT_BYTES) {
      throw new Error('Request body is too large. Limit is 1 MB.');
    }
    chunks.push(chunk);
  }

  if (totalLength === 0) return {};

  const raw = Buffer.concat(chunks).toString('utf8');

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Request body must be valid JSON.');
  }
}

function handleHealth(_req, res) {
  sendJson(res, 200, {
    ok: true,
    service: 'twilight-strategy-api',
    version: '1.0.0',
    endpoints: [
      '/api/health',
      '/api/strategies',
      '/api/trade-impact',
    ],
  });
}

async function handleStrategies(req, res, url) {
  const allowedMethods = ['GET', 'POST', 'OPTIONS'];
  if (!allowedMethods.includes(req.method)) {
    sendMethodNotAllowed(res, allowedMethods);
    return;
  }

  if (req.method === 'OPTIONS') {
    sendNoContent(res);
    return;
  }

  const input = req.method === 'GET'
    ? Object.fromEntries(url.searchParams.entries())
    : await readJsonBody(req);

  const params = buildStrategyParams(input);
  const mergedParams = { ...DEFAULT_PARAMS, ...params };
  const strategies = generateTwilightStrategies(params);

  sendJson(res, 200, {
    ok: true,
    endpoint: '/api/strategies',
    count: strategies.length,
    params: mergedParams,
    summary: {
      rawTwilightFundingRate: calculateTwilightFundingRate(
        mergedParams.twilightLongSize,
        mergedParams.twilightShortSize,
      ),
      effectiveTwilightFundingRate: resolveEffectiveTwilightRate({
        longSize: mergedParams.twilightLongSize,
        shortSize: mergedParams.twilightShortSize,
        binanceFundingRate: mergedParams.binanceFundingRate,
        twilightFundingCapPct: mergedParams.twilightFundingCapPct,
        pegTwilightToCapRate: mergedParams.pegTwilightToCapRate,
      }),
    },
    strategies,
  });
}

async function handleTradeImpact(req, res, url) {
  const allowedMethods = ['GET', 'POST', 'OPTIONS'];
  if (!allowedMethods.includes(req.method)) {
    sendMethodNotAllowed(res, allowedMethods);
    return;
  }

  if (req.method === 'OPTIONS') {
    sendNoContent(res);
    return;
  }

  const input = req.method === 'GET'
    ? Object.fromEntries(url.searchParams.entries())
    : await readJsonBody(req);

  const params = buildTradeImpactParams(input);
  const result = calculateTradeImpact(params);

  sendJson(res, 200, {
    ok: true,
    endpoint: '/api/trade-impact',
    params,
    result,
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${HOST}:${PORT}`}`);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    if (pathname === '/api/health') {
      handleHealth(req, res);
      return;
    }

    if (pathname === '/api/strategies') {
      await handleStrategies(req, res, url);
      return;
    }

    if (pathname === '/api/trade-impact') {
      await handleTradeImpact(req, res, url);
      return;
    }

    if (pathname.startsWith('/api/')) {
      sendNotFound(res, pathname);
      return;
    }

    sendJson(res, 404, {
      error: 'Not Found',
      message: 'This server only exposes API endpoints under /api.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    sendBadRequest(res, message);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Twilight strategy API listening on http://${HOST}:${PORT}`);
});
