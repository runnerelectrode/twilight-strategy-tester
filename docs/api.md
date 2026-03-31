# API Documentation

## Base URL

Local default:

```text
http://localhost:3001
```

When the frontend is running through Vite dev or preview, `/api/*` is proxied to the API server.

## Authentication

No authentication is required right now.

## Content Type

For `POST` requests, send:

```text
Content-Type: application/json
```

## CORS

The API responds with:

```text
Access-Control-Allow-Origin: *
```

This allows browser-based clients hosted on other origins to fetch the endpoints.

## Endpoints

### `GET /api/health`

Returns service metadata and a list of exposed endpoints.

Example response:

```json
{
  "ok": true,
  "service": "twilight-strategy-api",
  "version": "1.0.0",
  "endpoints": [
    "/api/health",
    "/api/strategies",
    "/api/trade-impact"
  ]
}
```

### `GET /api/strategies`

Generates trading strategies from query string parameters.

All parameters are optional. Missing values fall back to defaults from the calculator module.

Default values:

- `twilightPrice`: `84695`
- `cexPrice`: `84670`
- `bybitPrice`: `0`
- `binanceFundingRate`: `0.0001`
- `bybitFundingRate`: `0.0001`
- `tvl`: `300`
- `twilightLongSize`: `0`
- `twilightShortSize`: `0`
- `twilightFundingCapPct`: `0`
- `pegTwilightToCapRate`: `false`

Supported query parameters:

- `twilightPrice` number
- `cexPrice` number
- `bybitPrice` number
- `binanceFundingRate` number
- `bybitFundingRate` number
- `tvl` number
- `twilightLongSize` number
- `twilightShortSize` number
- `twilightFundingCapPct` number
- `pegTwilightToCapRate` boolean

Example:

```bash
curl "http://localhost:3001/api/strategies?twilightPrice=84695&cexPrice=84670&tvl=300&twilightLongSize=220&twilightShortSize=80&binanceFundingRate=0.0001"
```

### `POST /api/strategies`

Generates trading strategies from a JSON request body.

Request body fields:

- `twilightPrice` number
- `cexPrice` number
- `bybitPrice` number
- `binanceFundingRate` number
- `bybitFundingRate` number
- `tvl` number
- `twilightLongSize` number
- `twilightShortSize` number
- `twilightFundingCapPct` number
- `pegTwilightToCapRate` boolean

Example:

```bash
curl -X POST "http://localhost:3001/api/strategies" \
  -H "Content-Type: application/json" \
  -d '{
    "twilightPrice": 84695,
    "cexPrice": 84670,
    "bybitPrice": 84590,
    "binanceFundingRate": 0.0001,
    "bybitFundingRate": -0.00005,
    "tvl": 300,
    "twilightLongSize": 220,
    "twilightShortSize": 80,
    "twilightFundingCapPct": 0,
    "pegTwilightToCapRate": false
  }'
```

Example response shape:

```json
{
  "ok": true,
  "endpoint": "/api/strategies",
  "count": 32,
  "params": {
    "twilightPrice": 84695,
    "cexPrice": 84670,
    "bybitPrice": 84590,
    "binanceFundingRate": 0.0001,
    "bybitFundingRate": -0.00005,
    "tvl": 300,
    "twilightLongSize": 220,
    "twilightShortSize": 80,
    "twilightFundingCapPct": 0,
    "pegTwilightToCapRate": false
  },
  "summary": {
    "rawTwilightFundingRate": 0.00008148,
    "effectiveTwilightFundingRate": 0.00008148
  },
  "strategies": [
    {
      "id": 1,
      "name": "Twilight Long 10x",
      "description": "Long BTC on Twilight only. No hedge. Directional bet.",
      "category": "Directional",
      "risk": "HIGH",
      "twilightPosition": "LONG",
      "twilightSize": 150,
      "twilightLeverage": 10,
      "binancePosition": null,
      "binanceSize": 0,
      "binanceLeverage": 0,
      "apy": 0,
      "monthlyPnL": 0
    }
  ]
}
```

Important response fields:

- `count`: number of generated strategies
- `params`: final parameters after defaults are applied
- `summary.rawTwilightFundingRate`: funding rate before cap/peg logic
- `summary.effectiveTwilightFundingRate`: funding rate used for strategy calculations
- `strategies`: APY-sorted array of strategy objects

Notes:

- Response values vary based on the submitted market inputs.
- Bybit strategy variants are only included when `bybitPrice > 0`.

Each strategy object can include:

- Metadata such as `id`, `name`, `description`, `category`, `risk`
- Position fields such as `twilightPosition`, `binancePosition`, `twilightLeverage`, `binanceLeverage`
- Performance fields such as `apy`, `dailyPnL`, `monthlyPnL`, `monthlyFundingPnL`
- Risk fields such as `twilightLiquidationPrice`, `binanceLiquidationPrice`, `totalMaxLoss`
- Scenario fields such as `pnlUp5`, `pnlDown5`, `apyUp5`, `apyDown5`
- Extra fields for Bybit variants such as `isBybitStrategy`, `bybitPrice`, `bybitFundingRate`

### `GET /api/trade-impact`

Calculates how a proposed trade changes skew and funding.

Supported query parameters:

- `tradeSize` number, required
- `direction` string, required, must be `LONG` or `SHORT`
- `longSize` number, required
- `shortSize` number, required
- `binanceFundingRate` number, optional, defaults to `0`
- `twilightFundingCapPct` number, optional, defaults to `0`
- `pegTwilightToCapRate` boolean, optional, defaults to `false`

Example:

```bash
curl "http://localhost:3001/api/trade-impact?tradeSize=100&direction=LONG&longSize=220&shortSize=80&binanceFundingRate=0.0001&twilightFundingCapPct=0&pegTwilightToCapRate=false"
```

### `POST /api/trade-impact`

Calculates trade impact from a JSON request body.

Request body fields:

- `tradeSize` number, required
- `direction` string, required, must be `LONG` or `SHORT`
- `longSize` number, required
- `shortSize` number, required
- `binanceFundingRate` number, optional, defaults to `0`
- `twilightFundingCapPct` number, optional, defaults to `0`
- `pegTwilightToCapRate` boolean, optional, defaults to `false`

Example:

```bash
curl -X POST "http://localhost:3001/api/trade-impact" \
  -H "Content-Type: application/json" \
  -d '{
    "tradeSize": 100,
    "direction": "LONG",
    "longSize": 220,
    "shortSize": 80,
    "binanceFundingRate": 0.0001,
    "twilightFundingCapPct": 0,
    "pegTwilightToCapRate": false
  }'
```

Example response:

```json
{
  "ok": true,
  "endpoint": "/api/trade-impact",
  "params": {
    "direction": "LONG",
    "tradeSize": 100,
    "longSize": 220,
    "shortSize": 80,
    "binanceFundingRate": 0.0001,
    "twilightFundingCapPct": 0,
    "pegTwilightToCapRate": false
  },
  "result": {
    "newSkew": 0.64,
    "newLongs": 320,
    "newShorts": 80,
    "skewChange": 0.09,
    "newFundingRate": 0.00018,
    "annualizedAPY": 19.71,
    "youPay": true,
    "youEarn": false,
    "helpsBalance": false
  }
}
```

## Errors

Invalid input returns HTTP `400`.

Example:

```json
{
  "error": "Bad Request",
  "message": "\"direction\" must be either \"LONG\" or \"SHORT\"."
}
```

Unknown API routes return HTTP `404`.

Unsupported methods return HTTP `405`.
