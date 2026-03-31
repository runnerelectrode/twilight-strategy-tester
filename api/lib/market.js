const WebSocket = require('ws');

class MarketDataManager {
  constructor() {
    this.data = {
      twilightPrice: 0,
      cexPrice: 0,
      markPrice: 0,
      binanceFundingRate: 0.0001,
      nextFundingTime: null,
      bybitPrice: 0,
      bybitFundingRate: 0.0001,
      bybitNextFundingTime: null,
    };
    this.status = {
      spotConnected: false,
      futuresConnected: false,
      markPriceConnected: false,
      bybitConnected: false,
      lastSpotUpdate: null,
      lastFuturesUpdate: null,
      lastMarkPriceUpdate: null,
      lastBybitUpdate: null,
    };
    this._ws = {};
    this._reconnectTimeouts = {};
    this._bybitPingInterval = null;
  }

  start() {
    this._connectSpot();
    this._connectFutures();
    this._connectMarkPrice();
    this._connectBybit();
    console.log('[Market] WebSocket connections initiated');
  }

  stop() {
    for (const key of Object.keys(this._ws)) {
      if (this._ws[key]) { this._ws[key].close(); this._ws[key] = null; }
    }
    for (const key of Object.keys(this._reconnectTimeouts)) {
      if (this._reconnectTimeouts[key]) clearTimeout(this._reconnectTimeouts[key]);
    }
    if (this._bybitPingInterval) clearInterval(this._bybitPingInterval);
  }

  getMarketData() {
    const d = { ...this.data };
    // Fallback: if spot feed (twilightPrice) is down, use futures price
    if (d.twilightPrice === 0 && d.cexPrice > 0) d.twilightPrice = d.cexPrice;
    return d;
  }

  getStatus() {
    return { ...this.status };
  }

  // ---- Binance Spot (Twilight price proxy) ----
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
      ws.on('error', () => { this.status.spotConnected = false; });
      ws.on('close', () => {
        this.status.spotConnected = false;
        this._reconnectTimeouts.spot = setTimeout(() => this._connectSpot(), 3000);
      });
      this._ws.spot = ws;
    } catch (e) { this.status.spotConnected = false; }
  }

  // ---- Binance Futures (CEX price) ----
  _connectFutures() {
    try {
      const ws = new WebSocket('wss://fstream.binance.com/ws/btcusdt@aggTrade');
      ws.on('open', () => { this.status.futuresConnected = true; console.log('[Market] Binance Futures connected'); });
      ws.on('message', (raw) => {
        const data = JSON.parse(raw);
        const price = Math.round(parseFloat(data.p));
        if (price > 0) {
          this.data.cexPrice = price;
          this.status.lastFuturesUpdate = new Date().toISOString();
        }
      });
      ws.on('error', () => { this.status.futuresConnected = false; });
      ws.on('close', () => {
        this.status.futuresConnected = false;
        this._reconnectTimeouts.futures = setTimeout(() => this._connectFutures(), 3000);
      });
      this._ws.futures = ws;
    } catch (e) { this.status.futuresConnected = false; }
  }

  // ---- Binance Mark Price + Funding Rate ----
  _connectMarkPrice() {
    try {
      const ws = new WebSocket('wss://fstream.binance.com/ws/btcusdt@markPrice@1s');
      ws.on('open', () => { this.status.markPriceConnected = true; console.log('[Market] Binance Mark Price connected'); });
      ws.on('message', (raw) => {
        const data = JSON.parse(raw);
        if (data.p) this.data.markPrice = Math.round(parseFloat(data.p));
        if (data.r) this.data.binanceFundingRate = parseFloat(data.r);
        if (data.T) this.data.nextFundingTime = parseInt(data.T);
        this.status.lastMarkPriceUpdate = new Date().toISOString();
      });
      ws.on('error', () => { this.status.markPriceConnected = false; });
      ws.on('close', () => {
        this.status.markPriceConnected = false;
        this._reconnectTimeouts.markPrice = setTimeout(() => this._connectMarkPrice(), 3000);
      });
      this._ws.markPrice = ws;
    } catch (e) { this.status.markPriceConnected = false; }
  }

  // ---- Bybit Inverse BTCUSD ----
  _connectBybit() {
    try {
      const ws = new WebSocket('wss://stream.bybit.com/v5/public/inverse');
      ws.on('open', () => {
        this.status.bybitConnected = true;
        console.log('[Market] Bybit Inverse connected');
        ws.send(JSON.stringify({ op: 'subscribe', args: ['tickers.BTCUSD'] }));
        this._bybitPingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 'ping' }));
        }, 20000);
      });
      ws.on('message', (raw) => {
        try {
          const message = JSON.parse(raw);
          if (message.op === 'pong' || message.ret_msg === 'pong' || message.op === 'subscribe') return;
          if (message.topic && message.topic.startsWith('tickers.BTCUSD') && message.data) {
            const data = message.data;
            const price = parseFloat(data.lastPrice) || parseFloat(data.markPrice) || 0;
            const fundingRate = parseFloat(data.fundingRate) || 0;
            const nextFunding = parseInt(data.nextFundingTime) || null;
            if (Math.round(price) > 0) {
              this.data.bybitPrice = Math.round(price);
              this.status.lastBybitUpdate = new Date().toISOString();
            }
            if (fundingRate !== 0) this.data.bybitFundingRate = fundingRate;
            if (nextFunding) this.data.bybitNextFundingTime = nextFunding;
          }
        } catch (e) {}
      });
      ws.on('error', () => { this.status.bybitConnected = false; });
      ws.on('close', () => {
        this.status.bybitConnected = false;
        if (this._bybitPingInterval) { clearInterval(this._bybitPingInterval); this._bybitPingInterval = null; }
        this._reconnectTimeouts.bybit = setTimeout(() => this._connectBybit(), 5000);
      });
      this._ws.bybit = ws;
    } catch (e) { this.status.bybitConnected = false; }
  }
}

module.exports = MarketDataManager;
