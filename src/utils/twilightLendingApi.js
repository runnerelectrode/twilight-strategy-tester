/**
 * Twilight Lending / Market API (JSON-RPC).
 * Base URL: Testnet https://relayer.twilight.rest/api, Mainnet https://relayer.twilight.org/api
 */

const JSON_RPC = { jsonrpc: '2.0', id: 1, params: null };

/**
 * Fetch market stats (open interest, skew, utilization, etc.).
 * @param {string} baseUrl - e.g. https://relayer.twilight.rest/api
 * @returns {Promise<{ longPct: number, shortPct: number, openInterestBtc: number, totalLongBtc: number, totalShortBtc: number, netExposureBtc: number, poolEquityBtc: number, utilization: number, status: string, maxLongBtc: number, maxShortBtc: number } | null>}
 */
export async function getMarketStats(baseUrl) {
  try {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...JSON_RPC, method: 'get_market_stats' }),
    });
    const data = await res.json();
    const r = data?.result;
    if (!r) return null;
    const satToBtc = (v) => (v != null ? Number(v) / 1e8 : 0);
    return {
      longPct: Number(r.long_pct) ?? 0,
      shortPct: Number(r.short_pct) ?? 0,
      openInterestBtc: satToBtc(r.open_interest_btc),
      totalLongBtc: satToBtc(r.total_long_btc),
      totalShortBtc: satToBtc(r.total_short_btc),
      netExposureBtc: satToBtc(r.net_exposure_btc),
      poolEquityBtc: satToBtc(r.pool_equity_btc),
      utilization: Number(r.utilization) ?? 0,
      status: r.status ?? '',
      maxLongBtc: satToBtc(r.max_long_btc),
      maxShortBtc: satToBtc(r.max_short_btc),
    };
  } catch (e) {
    console.error('getMarketStats', e);
    return null;
  }
}

/**
 * Fetch last 24h pool APY. Result is decimal string (e.g. "0.0821" = 8.21%). Multiply by 100 for display.
 * @param {string} baseUrl
 * @returns {Promise<number | null>} APY as percentage (e.g. 8.21), or null
 */
export async function getLastDayApy(baseUrl) {
  try {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...JSON_RPC, method: 'last_day_apy' }),
    });
    const data = await res.json();
    const result = data?.result;
    if (result == null) return null;
    const decimal = typeof result === 'string' ? parseFloat(result) : Number(result);
    return Number.isFinite(decimal) ? decimal * 100 : null;
  } catch (e) {
    console.error('getLastDayApy', e);
    return null;
  }
}
