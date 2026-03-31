# Twilight Trading App

This project includes:

- A React + Vite frontend for exploring Twilight trading strategies
- A lightweight Node HTTP API for generating strategy data that other clients can fetch

## Run Locally

Install dependencies:

```bash
npm install
```

Start the API server:

```bash
npm run api
```

Start the frontend in a second terminal:

```bash
npm run dev
```

The frontend dev server proxies `/api/*` requests to `http://localhost:3001`.

## Available API Endpoints

- `GET /api/health`
- `GET /api/strategies`
- `POST /api/strategies`
- `GET /api/trade-impact`
- `POST /api/trade-impact`

The API server enables CORS with `Access-Control-Allow-Origin: *`, so external web clients can call it directly.

## Quick Examples

Fetch strategies with query parameters:

```bash
curl "http://localhost:3001/api/strategies?twilightPrice=84695&cexPrice=84670&tvl=300&twilightLongSize=220&twilightShortSize=80&binanceFundingRate=0.0001"
```

Generate strategies with a JSON body:

```bash
curl -X POST "http://localhost:3001/api/strategies" \
  -H "Content-Type: application/json" \
  -d '{
    "twilightPrice": 84695,
    "cexPrice": 84670,
    "tvl": 300,
    "twilightLongSize": 220,
    "twilightShortSize": 80,
    "binanceFundingRate": 0.0001,
    "bybitPrice": 84590,
    "bybitFundingRate": -0.00005
  }'
```

Calculate trade impact:

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

## API Documentation

Detailed request and response documentation lives in [docs/api.md](./docs/api.md).
