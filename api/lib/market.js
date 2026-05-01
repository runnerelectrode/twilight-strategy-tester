const WebSocket = require('ws');

const STALE_MS = 60_000;
const WATCHDOG_INTERVAL_MS = 30_000;
const SPOT_BACKOFF_MS = 60_000;
const REST_POLL_MS = 5_000;            // fapi.binance.com REST polling cadence
const REST_TIMEOUT_MS = 4_000;
const RELAYER_POLL_MS = 5_000;          // Twilight relayer get_market_stats polling cadence
const RELAYER_TIMEOUT_MS = 4_000;
const TWILIGHT_RELAYER_URL = process.env.TWILIGHT_RELAYER_URL || 'https://api.ephemeral.fi/api';

class MarketDataManager {
  constructor() {
    this.data = {
      twilightPrice: 0, cexPrice: 0, markPrice: 0,
      binanceFundingRate: 0.0001, nextFundingTime: null,
      bybitPrice: 0, bybitFundingRate: 0.0001, bybitNextFundingTime: null,
      // ---- Twilight chain-side data from get_market_stats (null until first poll succeeds) ----
      twilightFundingRate: null,
      twilightEstimatedFundingRate: null,
      twilightFundingTimestamp: null,
      twilightEstimatedFundingTimestamp: null,
      twilightLongPct: null,
      twilightShortPct: null,
      twilightTotalLongBtc: null,
      twilightTotalShortBtc: null,
      twilightOpenInterestBtc: null,
      twilightPoolEquityBtc: null,
      twilightUtilization: null,
      twilightStatus: null,
      twilightStatusReason: null,
      twilightRiskParams: null,
    };
    this.status = {
      spotConnected: false, futuresConnected: false,
      markPriceConnected: false, bybitConnected: false,
      relayerConnected: false,
      lastSpotUpdate: null, lastFuturesUpdate: null,
      lastMarkPriceUpdate: null, lastBybitUpdate: null,
      lastRelayerUpdate: null,
    };
    this._ws = {};
    this._reconnectTimeouts = {};
    this._bybitPingInterval = null;
    this._watchdogInterval = null;
    this._restPollInterval = null;
    this._relayerPollInterval = null;
  }

  start() {
    this._connectSpot();
    this._connectFutures();
    this._connectMarkPrice();
    this._connectBybit();
    this._restPollInterval = setInterval(() => this._pollFapiRest(), REST_POLL_MS);
    this._pollFapiRest();
    this._relayerPollInterval = setInterval(() => this._pollTwilightRelayer(), RELAYER_POLL_MS);
    this._pollTwilightRelayer();
    this._watchdogInterval = setInterval(() => this._watchdog(), WATCHDOG_INTERVAL_MS);
    console.log('[Market] WS initiated; fapi REST every ' + (REST_POLL_MS/1000) + 's; relayer ' + TWILIGHT_RELAYER_URL + ' every ' + (RELAYER_POLL_MS/1000) + 's; watchdog every ' + (WATCHDOG_INTERVAL_MS/1000) + 's');
  }

  stop() {
    if (this._watchdogInterval) { clearInterval(this._watchdogInterval); this._watchdogInterval = null; }
    if (this._restPollInterval) { clearInterval(this._restPollInterval); this._restPollInterval = null; }
    if (this._relayerPollInterval) { clearInterval(this._relayerPollInterval); this._relayerPollInterval = null; }
    for (const key of Object.keys(this._ws)) {
      if (this._ws[key]) { try { this._ws[key].removeAllListeners(); this._ws[key].terminate(); } catch (e) {} this._ws[key] = null; }
    }
    for (const key of Object.keys(this._reconnectTimeouts)) {
      if (this._reconnectTimeouts[key]) { clearTimeout(this._reconnectTimeouts[key]); this._reconnectTimeouts[key] = null; }
    }
    if (this._bybitPingInterval) { clearInterval(this._bybitPingInterval); this._bybitPingInterval = null; }
  }

  getMarketData() {
    const d = { ...this.data };
    if (d.twilightPrice === 0 && d.cexPrice > 0) d.twilightPrice = d.cexPrice;
    return d;
  }

  getStatus() { return { ...this.status }; }

  // ---- Twilight relayer get_market_stats (canonical chain-side funding rate + pool state) ----
  async _pollTwilightRelayer() {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), RELAYER_TIMEOUT_MS);
    try {
      const res = await fetch(TWILIGHT_RELAYER_URL, {
        method: 'POST',
        signal: ac.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'get_market_stats', params: {}, id: 1 }),
      });
      if (!res.ok) {
        console.log('[Market] relayer poll non-2xx: ' + res.status);
        this.status.relayerConnected = false;
        return;
      }
      const body = await res.json();
      const r = body && body.result;
      if (!r) {
        console.log('[Market] relayer returned no result');
        this.status.relayerConnected = false;
        return;
      }
      const fr = r.funding_rate || {};
      if (typeof fr.funding_rate === 'number') this.data.twilightFundingRate = fr.funding_rate;
      if (typeof fr.estimated_funding_rate === 'number') this.data.twilightEstimatedFundingRate = fr.estimated_funding_rate;
      if (fr.funding_rate_timestamp) this.data.twilightFundingTimestamp = fr.funding_rate_timestamp;
      if (fr.estimated_funding_rate_timestamp) this.data.twilightEstimatedFundingTimestamp = fr.estimated_funding_rate_timestamp;
      if (typeof r.long_pct === 'number') this.data.twilightLongPct = r.long_pct;
      if (typeof r.short_pct === 'number') this.data.twilightShortPct = r.short_pct;
      if (typeof r.total_long_btc === 'number') this.data.twilightTotalLongBtc = r.total_long_btc;
      if (typeof r.total_short_btc === 'number') this.data.twilightTotalShortBtc = r.total_short_btc;
      if (typeof r.open_interest_btc === 'number') this.data.twilightOpenInterestBtc = r.open_interest_btc;
      if (typeof r.pool_equity_btc === 'number') this.data.twilightPoolEquityBtc = r.pool_equity_btc;
      if (typeof r.utilization === 'number') this.data.twilightUtilization = r.utilization;
      if (r.status) this.data.twilightStatus = r.status;
      this.data.twilightStatusReason = r.status_reason ?? null;
      if (r.params) this.data.twilightRiskParams = r.params;
      this.status.relayerConnected = true;
      this.status.lastRelayerUpdate = new Date().toISOString();
    } catch (e) {
      console.log('[Market] relayer poll error: ' + (e && e.message ? e.message : String(e)));
      this.status.relayerConnected = false;
    } finally {
      clearTimeout(t);
    }
  }

  // ---- REST poll fapi.binance.com (canonical for futures price + funding when WS is geo-blocked) ----
  async _pollFapiRest() {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), REST_TIMEOUT_MS);
    try {
      const [tickerRes, premIdxRes] = await Promise.all([
        fetch('https://fapi.binance.com/fapi/v1/ticker/price?symbol=BTCUSDT', { signal: ac.signal }),
        fetch('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT', { signal: ac.signal }),
      ]);
      if (!tickerRes.ok || !premIdxRes.ok) {
        console.log('[Market] fapi REST non-2xx: ticker=' + tickerRes.status + ' premiumIndex=' + premIdxRes.status);
        return;
      }
      const ticker = await tickerRes.json();
      const prem   = await premIdxRes.json();
      const price = Math.round(parseFloat(ticker.price));
      if (price > 0) {
        this.data.cexPrice = price;
        this.status.lastFuturesUpdate = new Date().toISOString();
        this.status.futuresConnected = true;
      }
      const mark = Math.round(parseFloat(prem.markPrice));
      if (mark > 0) {
        this.data.markPrice = mark;
        this.status.lastMarkPriceUpdate = new Date().toISOString();
        this.status.markPriceConnected = true;
      }
      const fr = parseFloat(prem.lastFundingRate);
      if (Number.isFinite(fr)) this.data.binanceFundingRate = fr;
      const nft = parseInt(prem.nextFundingTime);
      if (nft) this.data.nextFundingTime = nft;
    } catch (e) {
      console.log('[Market] fapi REST error: ' + (e && e.message ? e.message : String(e)));
    } finally {
      clearTimeout(t);
    }
  }

  _watchdog() {
    const now = Date.now();
    const ageMs = (iso) => iso ? now - new Date(iso).getTime() : Infinity;
    if (this._ws.bybit && ageMs(this.status.lastBybitUpdate) > STALE_MS) {
      console.log('[Market] bybit stale; forcing reconnect');
      this._forceReconnect('bybit', () => this._connectBybit());
    }
    // Spot WS is best-effort; futures+markPrice driven by REST poll; relayer driven by REST poll.
  }

  _forceReconnect(key, connectFn) {
    if (this._reconnectTimeouts[key]) { clearTimeout(this._reconnectTimeouts[key]); this._reconnectTimeouts[key] = null; }
    const dead = this._ws[key];
    this._ws[key] = null;
    if (dead) {
      try { dead.removeAllListeners(); } catch (e) {}
      try { dead.terminate(); } catch (e) {}
    }
    setTimeout(connectFn, 0);
  }

  // ---- Binance Spot WS (Twilight price proxy when reachable) ----
  _connectSpot() {
    try {
      const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@aggTrade');
      ws.on('open', () => { this.status.spotConnected = true; console.log('[Market] Binance Spot connected'); });
      ws.on('message', (raw) => {
        const data = JSON.parse(raw);
        const price = Math.round(parseFloat(data.p));
        if (price > 0) {
          this.data.twilightPrice = price;
          this.status.lastSpotUpdate = new Date().toISOString();
        }
      });
      ws.on('error', () => { this.status.spotConnected = false; try { ws.close(); } catch (e) {} });
      ws.on('close', () => {
        if (this._ws.spot !== ws) return;
        this.status.spotConnected = false;
        this._reconnectTimeouts.spot = setTimeout(() => this._connectSpot(), SPOT_BACKOFF_MS);
      });
      this._ws.spot = ws;
    } catch (e) { this.status.spotConnected = false; }
  }

  _connectFutures() {
    try {
      const ws = new WebSocket('wss://fstream.binance.com/ws/btcusdt@aggTrade');
      ws.on('open', () => { console.log('[Market] Binance Futures WS connected (REST poll is the canonical source)'); });
      ws.on('message', (raw) => {
        const data = JSON.parse(raw);
        const price = Math.round(parseFloat(data.p));
        if (price > 0) {
          this.data.cexPrice = price;
          this.status.lastFuturesUpdate = new Date().toISOString();
          this.status.futuresConnected = true;
        }
      });
      ws.on('error', () => { try { ws.close(); } catch (e) {} });
      ws.on('close', () => {
        if (this._ws.futures !== ws) return;
        this._reconnectTimeouts.futures = setTimeout(() => this._connectFutures(), 30_000);
      });
      this._ws.futures = ws;
    } catch (e) {}
  }

  _connectMarkPrice() {
    try {
      const ws = new WebSocket('wss://fstream.binance.com/ws/btcusdt@markPrice@1s');
      ws.on('open', () => { console.log('[Market] Binance Mark Price WS connected (REST poll is the canonical source)'); });
      ws.on('message', (raw) => {
        const data = JSON.parse(raw);
        if (data.p) this.data.markPrice = Math.round(parseFloat(data.p));
        if (data.r) this.data.binanceFundingRate = parseFloat(data.r);
        if (data.T) this.data.nextFundingTime = parseInt(data.T);
        this.status.lastMarkPriceUpdate = new Date().toISOString();
        this.status.markPriceConnected = true;
      });
      ws.on('error', () => { try { ws.close(); } catch (e) {} });
      ws.on('close', () => {
        if (this._ws.markPrice !== ws) return;
        this._reconnectTimeouts.markPrice = setTimeout(() => this._connectMarkPrice(), 30_000);
      });
      this._ws.markPrice = ws;
    } catch (e) {}
  }

  _connectBybit() {
    try {
      const ws = new WebSocket('wss://stream.bybit.com/v5/public/inverse');
      ws.on('open', () => {
        this.status.bybitConnected = true;
        console.log('[Market] Bybit Inverse connected');
        ws.send(JSON.stringify({ op: 'subscribe', args: ['tickers.BTCUSD'] }));
        if (this._bybitPingInterval) clearInterval(this._bybitPingInterval);
        this._bybitPingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 'ping' }));
        }, 20000);
      });
      ws.on('message', (raw) => {
        try {
          const message = JSON.parse(raw);
          if (message.op === 'pong' || message.ret_msg === 'pong' || message.op === 'subscribe') return;
          if (message.topic && message.topic.startsWith('tickers.BTCUSD') && message.data) {
            const d = message.data;
            const price = parseFloat(d.lastPrice) || parseFloat(d.markPrice) || 0;
            const fundingRate = parseFloat(d.fundingRate) || 0;
            const nextFunding = parseInt(d.nextFundingTime) || null;
            if (Math.round(price) > 0) {
              this.data.bybitPrice = Math.round(price);
              this.status.lastBybitUpdate = new Date().toISOString();
            }
            if (fundingRate !== 0) this.data.bybitFundingRate = fundingRate;
            if (nextFunding) this.data.bybitNextFundingTime = nextFunding;
          }
        } catch (e) {}
      });
      ws.on('error', () => { this.status.bybitConnected = false; try { ws.close(); } catch (e) {} });
      ws.on('close', () => {
        if (this._ws.bybit !== ws) return;
        this.status.bybitConnected = false;
        if (this._bybitPingInterval) { clearInterval(this._bybitPingInterval); this._bybitPingInterval = null; }
        this._reconnectTimeouts.bybit = setTimeout(() => this._connectBybit(), 5000);
      });
      this._ws.bybit = ws;
    } catch (e) { this.status.bybitConnected = false; }
  }
}

module.exports = MarketDataManager;
