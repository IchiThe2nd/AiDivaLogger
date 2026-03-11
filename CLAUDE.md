# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Coding Standards

1. Write in TypeScript
2. Comment each line for understanding
3. Use test driven development
4. Each test must only test one item
5. Use best practices and explain what they are
6. Write tests following the ZOMBIES heuristic (by James Grenning):
   - **Z — Zero**: test the empty/initial state first
   - **O — One**: test a single interaction
   - **M — Many**: generalize to multiple items (forces loops, ordering, accumulation)
   - **B — Boundary**: test edges where behavior changes (empty→non-empty, full, off-by-one)
   - **I — Interface**: each test defines the public API from the caller's perspective
   - **E — Exercise exceptional behavior**: test errors, invalid inputs, and failure paths
   - **S — Simple scenarios / Simple solutions**: write the minimum code to pass the current test; defer complexity until a test forces it

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
    ├── client.ts      # InfluxDB 3.x client setup
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
