/**
 * SpreadStrategiesTable
 *
 * Renders the "Spot–Futures Spread Strategies" section: a single table of strategies
 * that have category "Spread" / isSpreadStrategy. These are spot–futures basis
 * trades (Twilight = Binance spot vs Binance futures) plus optional cross-venue
 * (Twi vs Bybit). See src/strategies/spreadStrategies.js for definitions and PnL.
 *
 * Props: strategies (full list), selectedStrategy, onSelectStrategy,
 * getTtmApr, getCategoryColor, getRiskColor, getAPYColor.
 */

export function SpreadStrategiesTable({
  strategies,
  selectedStrategy,
  onSelectStrategy,
  getTtmApr,
  getCategoryColor,
  getRiskColor,
  getAPYColor,
}) {
  const spreadStrategies = strategies.filter((s) => s.isSpreadStrategy);
  if (spreadStrategies.length === 0) return null;

  function renderRow(strategy, idx) {
    const ttmApr = getTtmApr(strategy);
    const isSelected = selectedStrategy?.id === strategy.id;
    return (
      <tr
        key={strategy.id}
        className={`border-b hover:bg-teal-50 cursor-pointer ${isSelected ? 'bg-teal-100' : ''}`}
        onClick={() => onSelectStrategy(strategy)}
      >
        <td className="p-2 text-slate-400">{idx + 1}</td>
        <td className="p-2">
          <div className="font-medium text-slate-800">{strategy.name}</div>
          <div className="text-xs text-slate-500 max-w-xs truncate">{strategy.description}</div>
        </td>
        <td className="p-2 text-center">
          <span className={`px-2 py-0.5 rounded text-xs ${getCategoryColor(strategy.category)}`}>
            {strategy.category}
          </span>
        </td>
        <td className="p-2">
          <span className={`px-2 py-0.5 rounded text-xs ${getRiskColor(strategy.risk)}`}>
            {strategy.risk}
          </span>
        </td>
        <td className="p-2 text-right font-mono">${strategy.totalMargin?.toFixed(2) ?? '0'}</td>
        <td className={`p-2 text-right font-mono ${(strategy.monthlyPnL ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          {(strategy.monthlyPnL ?? 0) >= 0 ? '+' : ''}${(strategy.monthlyPnL ?? 0)?.toFixed(2) || '0'}
        </td>
        <td className={`p-2 text-right font-mono font-bold ${getAPYColor(strategy.apy ?? 0)}`}>
          {(strategy.apy ?? 0) >= 0 ? '+' : ''}{(strategy.apy ?? 0)?.toFixed(1) || '0'}%
        </td>
        <td className="p-2 text-right font-mono text-xs text-amber-700">
          {ttmApr != null ? `${ttmApr >= 0 ? '+' : ''}${ttmApr.toFixed(1)}%` : '—'}
        </td>
        <td className="p-2 text-right font-mono text-xs text-violet-600">
          {strategy.targetTwilightRatePct != null ? `${strategy.targetTwilightRatePct.toFixed(0)}%` : '—'}
        </td>
        <td className={`p-2 text-right font-mono font-bold ${(strategy.pnlUp5 ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          {(strategy.pnlUp5 ?? 0) >= 0 ? '+' : ''}${(strategy.pnlUp5 ?? 0)?.toFixed(2) || '0'}
        </td>
        <td className={`p-2 text-right font-mono font-bold ${(strategy.pnlDown5 ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          {(strategy.pnlDown5 ?? 0) >= 0 ? '+' : ''}${(strategy.pnlDown5 ?? 0)?.toFixed(2) || '0'}
        </td>
        <td className="p-2 text-center">
          <button
            type="button"
            className="px-2 py-1 bg-teal-500 text-white rounded text-xs hover:bg-teal-600"
            onClick={(e) => {
              e.stopPropagation();
              onSelectStrategy(strategy);
            }}
          >
            Details
          </button>
        </td>
      </tr>
    );
  }

  return (
    <div className="bg-gradient-to-r from-teal-50 to-cyan-50 rounded-lg p-4 shadow mb-6 border-2 border-teal-200">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-slate-800 flex items-center gap-2">
          <span className="text-teal-600">Spot–Futures</span>
          Spot–Futures Spread Strategies
        </h3>
        <span className="text-xs text-slate-500">Twilight = Binance spot vs Binance futures — basis + funding</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-teal-100">
              <th className="text-left p-2">#</th>
              <th className="text-left p-2">Strategy</th>
              <th className="text-center p-2">Category</th>
              <th className="text-left p-2">Risk</th>
              <th className="text-right p-2">Margin</th>
              <th className="text-right p-2">Monthly P&L</th>
              <th className="text-right p-2">APY</th>
              <th className="text-right p-2 text-amber-600">TTM APR</th>
              <th className="text-right p-2 text-violet-600">Target</th>
              <th className="text-right p-2 text-green-700">If +5%</th>
              <th className="text-right p-2 text-red-700">If -5%</th>
              <th className="text-center p-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {spreadStrategies.map((s, i) => renderRow(s, i))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
