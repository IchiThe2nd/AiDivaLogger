// Import node-cron for scheduling periodic tasks
import cron from 'node-cron';
// Import InfluxDB type for client
import type Influx from 'influx';
// Import application configuration
import { config } from './config.js';
// Import Apex client for fetching datalog
import { ApexClient } from './apex/client.js';
// Import InfluxDB client factory
import { createInfluxClient } from './influx/client.js';
// Import data transformation functions
import { mapDatalogToPoints, mapAllRecordsToPoints } from './influx/mapper.js';

// Parse Apex date format (MM/DD/YYYY HH:MM:SS) to Date object
function parseApexDate(dateStr: string): Date {
  // Split date and time parts
  const [datePart, timePart] = dateStr.split(' ');
  // Split date into components
  const [month, day, year] = datePart.split('/').map(Number);
  // Split time into components
  const [hours, minutes, seconds] = timePart.split(':').map(Number);
  // Create and return Date object
  return new Date(year, month - 1, day, hours, minutes, seconds);
}

// Format duration in human-readable format
function formatDuration(ms: number): string {
  // Calculate time components
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / (1000 * 60)) % 60;
  const hours = Math.floor(ms / (1000 * 60 * 60)) % 24;
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));

  // Build human-readable string
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(' ');
}

// Get oldest record timestamp from InfluxDB
// Returns null if database is empty
async function getOldestDbTime(influx: Influx.InfluxDB): Promise<Date | null> {
  try {
    // Query for oldest data point (only fetch time column - network optimization)
    const result = await influx.query('SELECT time FROM apex_probe ORDER BY time ASC LIMIT 1', {
      precision: 'ms',
    });
    // Return null if no data
    if (result.length === 0) {
      return null;
    }
    // Parse and return the timestamp
    return new Date(String(result[0].time));
  } catch (error) {
    // Log error and return null
    console.error('Failed to get oldest DB time:', error);
    return null;
  }
}

// Check database freshness, sync Apex data to database, and report status
async function checkDatabaseFreshness(influx: Influx.InfluxDB, apexClient: ApexClient): Promise<void> {
  try {
    // Fetch current datalog from Apex
    const datalog = await apexClient.getDatalog();
    // Get the most recent record's timestamp
    const latestRecord = datalog.records[datalog.records.length - 1];
    if (!latestRecord) {
      console.log('No records found in Apex datalog.');
      return;
    }
    // Parse Apex timestamp
    const apexTime = parseApexDate(latestRecord.date);

    // Query DB for newest timestamp BEFORE syncing (only fetch time - network optimization)
    // This allows us to skip data that already exists
    const preCheckResult = await influx.query('SELECT time FROM apex_probe ORDER BY time DESC LIMIT 1', {
      precision: 'ms',
    });
    const newestDbTimeBefore = preCheckResult.length > 0
      ? new Date(String(preCheckResult[0].time))
      : null;

    // Track total points written and skipped during coverage scan
    let pointsWrittenDuringCoverage = 0;
    let pointsSkipped = 0;

    // Get data coverage information from Apex
    // Pass callback to write each day's data to InfluxDB (only newer data)
    console.log('Scanning Apex data and syncing new data to database...');
    // Helper to convert timestamp to milliseconds (computed once per point)
    const getTimeMs = (timestamp: Date | string | number | undefined): number => {
      if (timestamp instanceof Date) return timestamp.getTime();
      if (timestamp === undefined) return 0;
      return new Date(timestamp).getTime();
    };

    // Pre-compute the cutoff time once (instead of calling getTime() for every filter comparison)
    const cutoffTimeMs = newestDbTimeBefore?.getTime() ?? 0;

    const coverage = await apexClient.getDataCoverage(async (chunkDatalog) => {
      // Transform datalog records to InfluxDB points
      const points = mapAllRecordsToPoints(chunkDatalog);

      // Pre-compute timestamps once for all points (CPU optimization)
      // This avoids repeated Date parsing during filter and sort operations
      const pointsWithTime = points.probes.map((point) => ({
        point,
        timeMs: getTimeMs(point.timestamp),
      }));

      // Filter using pre-computed timestamps
      const newPointsWithTime = newestDbTimeBefore
        ? pointsWithTime.filter(({ timeMs }) => timeMs > cutoffTimeMs)
        : pointsWithTime;

      // Track skipped points
      pointsSkipped += pointsWithTime.length - newPointsWithTime.length;

      // Only write if there are new points
      if (newPointsWithTime.length > 0) {
        // Sort in-place using pre-computed timestamps (no array copy needed)
        newPointsWithTime.sort((a, b) => a.timeMs - b.timeMs);

        // Batch size for writing to InfluxDB (prevents dedup fanout warning)
        const batchSize = 500;
        // Write points in small batches with delays between each
        for (let i = 0; i < newPointsWithTime.length; i += batchSize) {
          // Get the current batch of points (extract original point objects)
          const batch = newPointsWithTime.slice(i, i + batchSize).map(({ point }) => point);
          // Write batch to InfluxDB
          await influx.writePoints(batch);
          // Small delay to let InfluxDB process before next batch
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        pointsWrittenDuringCoverage += newPointsWithTime.length;

        // Longer delay after each chunk to let InfluxDB fully process before next chunk
        // With 3-day chunks (~82k points), InfluxDB needs time to deduplicate
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    });

    // Query InfluxDB for most recent data point (only fetch time - network optimization)
    const newestResult = await influx.query('SELECT time FROM apex_probe ORDER BY time DESC LIMIT 1', {
      precision: 'ms',
    });

    // Query InfluxDB for oldest data point
    const oldestDbTime = await getOldestDbTime(influx);

    // Check if database has any data
    if (newestResult.length === 0) {
      console.log('\n--- Database Status ---');
      console.log(`Apex latest record: ${latestRecord.date}`);
      console.log('InfluxDB: No existing data (first run)');
      // Display Apex data coverage
      if (coverage.oldestUsefulRecordDate) {
        console.log(`Apex oldest useful record: ${coverage.oldestUsefulRecordDate}`);
        console.log(`Apex data coverage: ${coverage.daysWithData} days (${coverage.coveragePercent}%)`);
      } else {
        console.log('Apex: No useful records found');
      }
      // Show points written/skipped during coverage scan
      if (pointsWrittenDuringCoverage > 0 || pointsSkipped > 0) {
        console.log(`Points synced: ${pointsWrittenDuringCoverage}, skipped: ${pointsSkipped} (already in DB)`);
      }
      console.log('---\n');
      return;
    }

    // Get newest timestamp from InfluxDB result
    const newestDbTime = new Date(String(newestResult[0].time));

    // Calculate time difference in milliseconds
    const timeDiff = apexTime.getTime() - newestDbTime.getTime();

    // Display results
    console.log('\n--- Database Status ---');
    console.log(`Apex latest record: ${latestRecord.date}`);
    console.log(`InfluxDB newest record: ${newestDbTime.toLocaleString()}`);
    if (oldestDbTime) {
      console.log(`InfluxDB oldest record: ${oldestDbTime.toLocaleString()}`);
    }
    if (timeDiff > 0) {
      console.log(`Database is ${formatDuration(timeDiff)} behind Apex`);
    } else if (timeDiff < 0) {
      console.log(`Database is up to date (${formatDuration(Math.abs(timeDiff))} ahead)`);
    } else {
      console.log('Database is up to date');
    }
    // Display Apex data coverage
    if (coverage.oldestUsefulRecordDate) {
      console.log(`Apex oldest useful record: ${coverage.oldestUsefulRecordDate}`);
      console.log(`Apex data coverage: ${coverage.daysWithData} days (${coverage.coveragePercent}%)`);
    } else {
      console.log('Apex: No useful records found');
    }
    // Show points written/skipped during coverage scan
    if (pointsWrittenDuringCoverage > 0 || pointsSkipped > 0) {
      console.log(`Points synced: ${pointsWrittenDuringCoverage}, skipped: ${pointsSkipped} (already in DB)`);
    }
    console.log('---\n');
  } catch (error) {
    // Log error but don't fail startup
    console.error('Failed to check database freshness:', error);
  }
}

// Main application entry point
async function main() {
  // Log startup message
  console.log('AiDivaLogger starting...');
  // Log Apex connection info
  console.log(`Apex host: ${config.apex.host}`);
  // Log InfluxDB connection info
  console.log(`InfluxDB: ${config.influx.host}:${config.influx.port}/${config.influx.database}`);
  // Log polling schedule
  console.log(`Poll interval: ${config.pollInterval}`);

  // Create Apex client with configuration
  const apexClient = new ApexClient(config.apex);
  // Create and initialize InfluxDB client
  const influx = await createInfluxClient(config.influx);

  // Sync Apex data to database in background (don't block polling)
  console.log('Starting background sync (polling will continue)...');
  checkDatabaseFreshness(influx, apexClient)
    .then(() => console.log('Background sync finished'))
    .catch((error) => console.error('Background sync failed:', error));

  // Define the polling function that fetches and writes data
  async function poll() {
    // Get current timestamp for logging
    const timestamp = new Date().toISOString();
    // Log poll start
    console.log(`[${timestamp}] Polling Apex datalog...`);

    try {
      // Fetch datalog from Apex (XML format)
      const datalog = await apexClient.getDatalog();
      // Transform datalog to InfluxDB points (latest record only)
      const points = mapDatalogToPoints(datalog);

      // Write all probe points to InfluxDB
      await influx.writePoints(points.probes);

      // Log success with point count and latest record date
      const latestDate = datalog.records[datalog.records.length - 1]?.date || 'N/A';
      console.log(`[${timestamp}] Wrote ${points.probes.length} points (record: ${latestDate})`);
    } catch (error) {
      // Log any errors that occur during polling
      console.error(`[${timestamp}] Poll failed:`, error);
    }
  }

  // Execute initial poll immediately on startup
  await poll();

  // Schedule recurring polls using cron expression
  cron.schedule(config.pollInterval, poll);

  // Log that scheduler is running
  console.log('Scheduler started. Press Ctrl+C to stop.');

  // Handle SIGINT (Ctrl+C) for graceful shutdown
  process.on('SIGINT', () => {
    // Log shutdown message
    console.log('\nShutting down...');
    // Exit with success code
    process.exit(0);
  });

  // Handle SIGTERM for graceful shutdown
  process.on('SIGTERM', () => {
    // Log shutdown message
    console.log('\nShutting down...');
    // Exit with success code
    process.exit(0);
  });
}

// Execute main function and handle fatal errors
main().catch((error) => {
  // Log fatal error
  console.error('Fatal error:', error);
  // Exit with error code
  process.exit(1);
});
