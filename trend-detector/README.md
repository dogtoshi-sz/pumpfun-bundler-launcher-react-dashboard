# Pump.fun Trend Detector Service

A standalone service for monitoring all new pump.fun token launches and identifying trending tokens based on momentum scoring.

## Features

- 🔍 **Real-time Monitoring**: Subscribes to ALL new token creations on pump.fun
- 📊 **Momentum Scoring**: Computes 0-100 scores based on trading activity
- 🎯 **Two-Stage Filtering**: Alive Gate (2 min) + Conversion Gate (3-10 min)
- 🖼️ **Metadata Fetching**: Uses Helius DAS API for token images/descriptions
- 📡 **REST API**: Easy integration with any frontend or tool
- 🔌 **SSE Stream**: Real-time updates via Server-Sent Events

## Quick Start

```bash
# Install dependencies
npm install

# Start the service
npm run dev
```

The service runs on **http://localhost:3003**

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/candidates` | GET | Top trending tokens |
| `/api/tokens` | GET | All tracked tokens |
| `/api/tokens/:mint` | GET | Token details |
| `/api/stats` | GET | Service statistics |
| `/api/heuristics` | GET | Current scoring config |
| `/api/heuristics` | POST | Update scoring config |
| `/api/heuristics/reset` | POST | Reset to defaults |
| `/api/stream` | GET | SSE real-time stream |

## How It Works

### 1. Token Discovery
Subscribes to PumpPortal WebSocket to receive ALL new token creations instantly.

### 2. Trade Tracking
For each new token, subscribes to its trade feed for 10 minutes.

### 3. Alive Gate (2 minutes)
Tokens must pass these checks:
- ≥6 unique buyers
- ≥10 buy transactions
- ≥2 SOL volume
- First buy within 45 seconds
- Second buyer within 60 seconds

### 4. Conversion Gate (3-10 minutes)
Candidates must maintain momentum:
- Continuous new buyers
- Buy/sell ratio ≥1.0
- No consecutive negative acceleration

### 5. Scoring
Score (0-100) computed from:
- Unique buyers in 60s
- Trade count in 60s
- SOL volume in 60s
- Buy/sell ratio bonus/penalty
- Acceleration bonus/penalty

## Configuration

The heuristics can be adjusted via the API or by editing `keys/trend-heuristics.json`.

## Environment Variables

Uses the parent `.env` file for:
- `RPC_ENDPOINT` (Helius API key extracted for metadata)
- `TREND_DETECTOR_PORT` (optional, defaults to 3003)

## Integration with Bundler

The bundler's frontend automatically connects to this service when running.
If the service is not running, the UI shows setup instructions.
