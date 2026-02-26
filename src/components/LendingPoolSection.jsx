/**
 * Self-contained Lending Pool section: owns API polling, state, strategy building, and UI.
 * Parent passes: btcPrice, tvl, getPerpHedgeMetrics( { position, size, leverage } ), and selection/display helpers.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { getMarketStats, getLastDayApy } from '../utils/twilightLendingApi';
import { buildLendingPoolStrategies } from '../strategies/lendingPoolStrategies';

const TWILIGHT_RELAYER_TESTNET = 'https://relayer.twilight.rest/api';
const TWILIGHT_RELAYER_MAINNET = 'https://relayer.twilight.org/api';
const POLL_MS = 60_000;

export function LendingPoolSection({
  btcPrice,
  tvl,
  getPerpHedgeMetrics,
  currentTwilightFundingAPY,
  selectedStrategy,
  onSelectStrategy,
  getTtmApr,
  getCategoryColor,
  getRiskColor,
  getAPYColor,
  baseUrl = TWILIGHT_RELAYER_TESTNET,
}) {
  const [marketStats, setMarketStats] = useState(null);
  const [poolApy24h, setPoolApy24h] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      setLoading(true);
      setError(null);
      try {
        const [stats, apy] = await Promise.all([
          getMarketStats(baseUrl),
          getLastDayApy(baseUrl),
        ]);
        if (!cancelled) {
          setMarketStats(stats);
          setPoolApy24h(apy);
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Lending API error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [baseUrl]);

  const calculateStrategyAPY = useMemo(() => {
    if (!getPerpHedgeMetrics) return () => ({ apy: 0, monthlyPnL: 0, totalMargin: 0, pnlUp5: 0, pnlDown5: 0, targetTwilightRatePct: null });
    return (strategy) => {
      const { twilightPosition, twilightSize, twilightLeverage } = strategy;
      if (!twilightPosition || twilightSize <= 0) return { apy: 0, monthlyPnL: 0, totalMargin: 0, pnlUp5: 0, pnlDown5: 0, targetTwilightRatePct: null };
      return getPerpHedgeMetrics({ position: twilightPosition, size: twilightSize, leverage: twilightLeverage });
    };
  }, [getPerpHedgeMetrics]);

  const strategies = useMemo(() => {
    return buildLendingPoolStrategies({
      idStart: 1,
      marketStats,
      poolApy24h,
      btcPrice,
      tvl,
      calculateStrategyAPY,
    });
  }, [marketStats, poolApy24h, btcPrice, tvl, calculateStrategyAPY]);

  return (
    <div className="bg-gradient-to-r from-amber-50 to-yellow-50 rounded-lg p-4 shadow mb-6 border-2 border-amber-200">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-slate-800 flex items-center gap-2">
          <span className="text-amber-600">Lending Pool</span>
          Lending Pool + Perp Hedge
        </h3>
        <span className="text-xs text-slate-500">Lend to pool (APY) + hedge with Twilight perp by skew</span>
      </div>

      {/* Pool APY / APR card at top of section */}
      {poolApy24h != null && !error && (
        <div className="rounded-xl bg-gradient-to-r from-amber-100 to-yellow-100 border-2 border-amber-300 p-4 mb-4">
          <div className="text-sm font-semibold text-slate-700 mb-2">Pool rates (last 24h, annualized)</div>
          <div className="flex flex-wrap gap-6">
            <div>
              <div className="text-xs text-slate-500">Pool APY</div>
              <div className="text-2xl font-bold text-amber-800">{poolApy24h.toFixed(2)}%</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Pool APR (simple)</div>
              <div className="text-2xl font-bold text-amber-800">
                {(((1 + poolApy24h / 100) ** (1 / 12) - 1) * 12 * 100).toFixed(2)}%
              </div>
            </div>
            {currentTwilightFundingAPY != null && (
              <div>
                <div className="text-xs text-slate-500">Twilight funding</div>
                <div className={`text-2xl font-bold ${currentTwilightFundingAPY >= 0 ? 'text-amber-800' : 'text-red-700'}`}>
                  {currentTwilightFundingAPY >= 0 ? '+' : ''}{currentTwilightFundingAPY.toFixed(2)}%
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {loading && <div className="col-span-2 text-amber-600">Loading…</div>}
        {error && <div className="col-span-2 text-red-600">{error}</div>}
        {marketStats != null && !error && (
          <>
            <div className="rounded-lg bg-white p-2 border border-amber-200">
              <div className="text-xs text-slate-500">Long % / Short %</div>
              <div className="font-mono font-bold">{(marketStats.longPct * 100).toFixed(1)}% / {(marketStats.shortPct * 100).toFixed(1)}%</div>
            </div>
            <div className="rounded-lg bg-white p-2 border border-amber-200">
              <div className="text-xs text-slate-500">Pool equity (BTC)</div>
              <div className="font-mono font-bold">{marketStats.poolEquityBtc.toFixed(2)}</div>
            </div>
            <div className="rounded-lg bg-white p-2 border border-amber-200">
              <div className="text-xs text-slate-500">Utilization</div>
              <div className="font-mono font-bold">{(marketStats.utilization * 100).toFixed(1)}%</div>
            </div>
            <div className="rounded-lg bg-white p-2 border border-amber-200">
              <div className="text-xs text-slate-500">Last 24h APY</div>
              <div className="font-mono font-bold text-amber-700">{poolApy24h != null ? `${poolApy24h.toFixed(2)}%` : '—'}</div>
            </div>
          </>
        )}
      </div>

      {strategies.length === 0 && !loading && (
        <div className="text-slate-500 text-sm py-4">No lending pool strategies (enable API or check skew).</div>
      )}

      {strategies.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-amber-100">
                <th className="text-left p-2">#</th>
                <th className="text-left p-2">Strategy</th>
                <th className="text-center p-2">Category</th>
                <th className="text-left p-2">Risk</th>
                <th className="text-right p-2">Margin</th>
                <th className="text-right p-2">Monthly P&L</th>
                <th className="text-right p-2">APY</th>
                <th className="text-right p-2 text-amber-600">TTM APR</th>
                <th className="text-right p-2">Target</th>
                <th className="text-right p-2">If +5%</th>
                <th className="text-right p-2">If -5%</th>
                <th className="text-center p-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {strategies.map((s, i) => {
                const ttmApr = getTtmApr ? getTtmApr(s) : null;
                const isSelected = selectedStrategy?.id === s.id && selectedStrategy?.isLendingPoolStrategy;
                return (
                  <tr
                    key={s.id}
                    className={`border-b hover:bg-amber-50 cursor-pointer ${isSelected ? 'bg-amber-100' : ''}`}
                    onClick={() => onSelectStrategy(s)}
                  >
                    <td className="p-2 text-slate-400">{i + 1}</td>
                    <td className="p-2">
                      <div className="font-medium text-slate-800">{s.name}</div>
                      <div className="text-xs text-slate-500 max-w-xs truncate">{s.description}</div>
                    </td>
                    <td className="p-2 text-center">
                      <span className={`px-2 py-0.5 rounded text-xs ${getCategoryColor ? getCategoryColor(s.category) : 'bg-amber-100 text-amber-800'}`}>
                        {s.category}
                      </span>
                    </td>
                    <td className="p-2">
                      <span className={`px-2 py-0.5 rounded text-xs ${getRiskColor ? getRiskColor(s.risk) : 'bg-gray-100'}`}>{s.risk}</span>
                    </td>
                    <td className="p-2 text-right font-mono">${(s.totalMargin ?? 0).toFixed(2)}</td>
                    <td className={`p-2 text-right font-mono ${(s.monthlyPnL ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {(s.monthlyPnL ?? 0) >= 0 ? '+' : ''}${(s.monthlyPnL ?? 0).toFixed(2)}
                    </td>
                    <td className={`p-2 text-right font-mono font-bold ${getAPYColor ? getAPYColor(s.apy ?? 0) : ''}`}>
                      {(s.apy ?? 0) >= 0 ? '+' : ''}{(s.apy ?? 0).toFixed(1)}%
                    </td>
                    <td className="p-2 text-right font-mono text-xs">
                      {ttmApr != null ? `${ttmApr >= 0 ? '+' : ''}${ttmApr.toFixed(1)}%` : '—'}
                    </td>
                    <td className="p-2 text-right font-mono text-xs">
                      {s.targetTwilightRatePct != null ? `${s.targetTwilightRatePct.toFixed(0)}%` : '—'}
                    </td>
                    <td className="p-2 text-right font-mono font-bold">
                      {s.pnlUp5 != null ? `${(s.pnlUp5 >= 0 ? '+' : '')}$${s.pnlUp5.toFixed(2)}` : '—'}
                    </td>
                    <td className="p-2 text-right font-mono font-bold">
                      {s.pnlDown5 != null ? `${(s.pnlDown5 >= 0 ? '+' : '')}$${s.pnlDown5.toFixed(2)}` : '—'}
                    </td>
                    <td className="p-2 text-center">
                      <button
                        type="button"
                        className="px-2 py-1 bg-amber-500 text-white rounded text-xs hover:bg-amber-600"
                        onClick={(e) => { e.stopPropagation(); onSelectStrategy(s); }}
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
