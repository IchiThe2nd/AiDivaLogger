// Import node-cron for scheduling periodic tasks
import cron from 'node-cron';
// Import application configuration
import { config } from './config.js';
// Import Apex client for fetching datalog
import { ApexClient } from './apex/client.js';
// Import types for Apex datalog structure
import type { ApexDatalog } from './apex/types.js';
// Import InfluxDB client factory and type
import { createInfluxClient, InfluxClient } from './influx/client.js';
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
// Uses a bounded search starting from 90 days ago to avoid scanning too many files
async function getOldestDbTime(influx: InfluxClient): Promise<Date | null> {
  try {
    // Query for oldest data point within the last 90 days (avoids full table scan)
    // InfluxDB 3 Core has file limits, so we bound the query to prevent errors
    const result = await influx.query<{ time: string }>(
      "SELECT time FROM apex_probe WHERE time > now() - interval '90 days' ORDER BY time ASC LIMIT 1"
    );
    // Return null if no data
    if (result.length === 0) {
      return null;
    }
    // Parse and return the timestamp
    return new Date(result[0].time);
  } catch (error) {
    // Log error and return null
    console.error('Failed to get oldest DB time:', error);
    return null;
  }
}

// Check database freshness, sync Apex data to database, and report status
async function checkDatabaseFreshness(influx: InfluxClient, apexClient: ApexClient): Promise<void> {
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
    // This allows us to skip data that already exists (InfluxDB 3.x uses SQL)
    // Bound query to last 90 days to avoid InfluxDB 3 Core file limit errors
    const preCheckResult = await influx.query<{ time: string }>(
      "SELECT time FROM apex_probe WHERE time > now() - interval '90 days' ORDER BY time DESC LIMIT 1"
    );
    const newestDbTimeBefore = preCheckResult.length > 0
      ? new Date(preCheckResult[0].time)
      : null;

    // Track total points written and skipped during coverage scan
    let pointsWrittenDuringCoverage = 0;
    let recordsSkipped = 0;

    // Get data coverage information from Apex
    // Pass callback to write each day's data to InfluxDB (only newer data)
    // If forceFullSync is enabled, write all records and let InfluxDB deduplicate
    if (config.forceFullSync) {
      console.log('FORCE_FULL_SYNC enabled - writing all records (InfluxDB will deduplicate)...');
    }
    console.log('Scanning Apex data and syncing new data to database...');

    // Pre-compute the cutoff time once (instead of calling getTime() for every filter comparison)
    // When forceFullSync is true, we set cutoff to 0 to include all records
    const cutoffTimeMs = config.forceFullSync ? 0 : (newestDbTimeBefore?.getTime() ?? 0);

    const coverage = await apexClient.getDataCoverage(async (chunkDatalog) => {
      // Filter records BEFORE mapping to points (more efficient than creating Points to discard)
      // InfluxDB 3.x Points don't expose timestamp property, so we filter at record level
      // When forceFullSync is true, process all records (cutoffTimeMs=0 means all pass)
      const recordsToProcess = newestDbTimeBefore && !config.forceFullSync
        ? chunkDatalog.records.filter((record) => {
            // Parse record date and compare to cutoff
            const recordTime = parseApexDate(record.date);
            return recordTime.getTime() > cutoffTimeMs;
          })
        : chunkDatalog.records;

      // Track skipped records
      recordsSkipped += chunkDatalog.records.length - recordsToProcess.length;

      // Only process if there are new records
      if (recordsToProcess.length > 0) {
        // Sort records by date before mapping (ensures chronological write order)
        recordsToProcess.sort((a, b) => {
          return parseApexDate(a.date).getTime() - parseApexDate(b.date).getTime();
        });

        // Create a filtered datalog with only new records for mapping
        const filteredDatalog: ApexDatalog = {
          ...chunkDatalog,
          records: recordsToProcess,
        };

        // Transform filtered records to InfluxDB points
        const points = mapAllRecordsToPoints(filteredDatalog);

        // Batch size for writing to InfluxDB (prevents dedup fanout warning)
        const batchSize = 500;
        // Write points in small batches with delays between each
        for (let i = 0; i < points.probes.length; i += batchSize) {
          // Single-pass batch extraction (avoids slice+map double allocation)
          const end = Math.min(i + batchSize, points.probes.length);
          const batch: typeof points.probes = [];
          for (let j = i; j < end; j++) {
            batch.push(points.probes[j]);
          }
          // Write batch to InfluxDB
          await influx.writePoints(batch);
          // Small delay to let InfluxDB process before next batch
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        pointsWrittenDuringCoverage += points.probes.length;

        // Longer delay after each chunk to let InfluxDB fully process before next chunk
        // With 3-day chunks (~82k points), InfluxDB needs time to deduplicate
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    });

    // Query InfluxDB for most recent data point (only fetch time - network optimization)
    // InfluxDB 3.x uses SQL queries
    // Bound query to last 90 days to avoid InfluxDB 3 Core file limit errors
    const newestResult = await influx.query<{ time: string }>(
      "SELECT time FROM apex_probe WHERE time > now() - interval '90 days' ORDER BY time DESC LIMIT 1"
    );

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
      // Show records written/skipped during coverage scan
      if (pointsWrittenDuringCoverage > 0 || recordsSkipped > 0) {
        console.log(`Points synced: ${pointsWrittenDuringCoverage}, records skipped: ${recordsSkipped} (already in DB)`);
      }
      console.log('---\n');
      return;
    }

    // Get newest timestamp from InfluxDB result
    const newestDbTime = new Date(newestResult[0].time);

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
    // Show records written/skipped during coverage scan
    if (pointsWrittenDuringCoverage > 0 || recordsSkipped > 0) {
      console.log(`Points synced: ${pointsWrittenDuringCoverage}, records skipped: ${recordsSkipped} (already in DB)`);
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
  // Log InfluxDB 3.x connection info
  console.log(`InfluxDB: ${config.influx.url}/${config.influx.database}`);
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
      // Fetch datalog from Apex (XML format) with minimal=true for polling efficiency
      const datalog = await apexClient.getDatalog(true);
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
  process.on('SIGINT', async () => {
    // Log shutdown message
    console.log('\nShutting down...');
    // Close InfluxDB client connection
    await influx.close();
    // Exit with success code
    process.exit(0);
  });

  // Handle SIGTERM for graceful shutdown
  process.on('SIGTERM', async () => {
    // Log shutdown message
    console.log('\nShutting down...');
    // Close InfluxDB client connection
    await influx.close();
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
