# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Coding Standards

1. Write in TypeScript
2. Comment each line for understanding
3. Use test driven development
4. Each test must only test one item

## Build Commands

```bash
npm install        # Install dependencies
npm run dev        # Run in development mode with tsx
npm run build      # Compile TypeScript to dist/
npm start          # Run compiled production build
npm run typecheck  # Type check without emitting
```

## Project Architecture

AiDivaLogger polls a Neptune Apex aquarium controller and writes metrics to InfluxDB 1.x.

```
src/
├── index.ts           # Main entry point with cron scheduler
├── config.ts          # Environment variable configuration
├── apex/
│   ├── client.ts      # HTTP client for Neptune Apex API
│   └── types.ts       # TypeScript interfaces for Apex responses
└── influx/
    ├── client.ts      # InfluxDB 1.x client setup
    └── mapper.ts      # Transform Apex data to InfluxDB points
```

## Configuration

Copy `.env.example` to `.env` and configure:

- `APEX_HOST` - Neptune Apex IP address
- `APEX_USERNAME` / `APEX_PASSWORD` - Optional auth credentials
- `INFLUX_HOST` / `INFLUX_PORT` / `INFLUX_DATABASE` - InfluxDB connection
- `POLL_INTERVAL` - Cron expression (default: every 5 minutes)

## Key Entry Points

- [src/index.ts](src/index.ts) - Application entry, initializes clients and scheduler
- [src/apex/client.ts](src/apex/client.ts) - Fetches `/cgi-bin/status.json` from Apex
- [src/influx/mapper.ts](src/influx/mapper.ts) - Converts Apex status to InfluxDB points
