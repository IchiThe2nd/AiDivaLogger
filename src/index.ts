// Import node-cron for scheduling periodic tasks
import cron from 'node-cron';
// Import application configuration
import { config } from './config.js';
// Import Apex client for fetching datalog
import { ApexClient } from './apex/client.js';
// Import types for Apex datalog and outlog structures
import type { ApexDatalog } from './apex/types.js';
// Import InfluxDB client factory and type
import { createInfluxClient, InfluxClient } from './influx/client.js';
// Import data transformation functions for probes and outlets
import { mapDatalogToPoints, mapAllRecordsToPoints, mapStatusToOutletPoints, mapAllOutlogToPoints } from './influx/mapper.js';

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

// Check if error is the InfluxDB file limit error
// Matches error patterns from InfluxDB 3 Core when query exceeds file limit
function isFileLimitError(error: unknown): boolean {
  // Match InfluxDB file limit error patterns
  if (error instanceof Error) {
    // Check for both common error message patterns
    return error.message.includes('exceeding the file limit') ||
           (error.message.includes('would scan') && error.message.includes('Parquet files'));
  }
  // Return false for non-Error objects
  return false;
}

// Query for newest record by iterating through time chunks (most recent first)
// Returns null if no data found within the lookback period
// Uses chunked queries to avoid InfluxDB file limit errors
async function queryNewestInChunks(
  influx: InfluxClient,
  measurement: string
): Promise<{ time: string } | null> {
  // Get chunk and lookback configuration
  const chunkDays = config.queryChunkDays;
  const maxLookback = config.queryLookbackDays;

  // Iterate through chunks from most recent to oldest
  for (let startDays = 0; startDays < maxLookback; startDays += chunkDays) {
    // Calculate end of this chunk (don't exceed max lookback)
    const endDays = Math.min(startDays + chunkDays, maxLookback);

    // Build time constraint for this chunk
    // Example: time > now() - 7d AND time <= now() - 0d (most recent week)
    const timeConstraint = `time > now() - interval '${endDays} days' AND time <= now() - interval '${startDays} days'`;

    try {
      // Query this chunk for newest record
      const result = await influx.query<{ time: string }>(
        `SELECT time FROM ${measurement} WHERE ${timeConstraint} ORDER BY time DESC LIMIT 1`
      );

      // Return first result found (newest in this chunk)
      if (result.length > 0) {
        return result[0];
      }
      // No data in this chunk, continue to older chunk
    } catch (error) {
      // Check if this chunk hit the file limit
      if (isFileLimitError(error)) {
        // Log warning and skip this chunk
        console.warn(`Chunk query (${startDays}-${endDays} days ago) exceeded file limit, skipping...`);
        continue;
      }
      // Re-throw other errors
      throw error;
    }
  }

  // No data found in any chunk
  return null;
}

// Query for oldest record by iterating through time chunks (oldest first)
// Returns null if no data found within the lookback period
// Uses chunked queries to avoid InfluxDB file limit errors
async function queryOldestInChunks(
  influx: InfluxClient,
  measurement: string
): Promise<{ time: string } | null> {
  // Get chunk and lookback configuration
  const chunkDays = config.queryChunkDays;
  const maxLookback = config.queryLookbackDays;

  // Iterate through chunks from oldest to most recent
  for (let endDays = maxLookback; endDays > 0; endDays -= chunkDays) {
    // Calculate start of this chunk (don't go below 0)
    const startDays = Math.max(endDays - chunkDays, 0);

    // Build time constraint for this chunk
    // Example: time > now() - 30d AND time <= now() - 23d (oldest week in 30-day window)
    const timeConstraint = `time > now() - interval '${endDays} days' AND time <= now() - interval '${startDays} days'`;

    try {
      // Query this chunk for oldest record
      const result = await influx.query<{ time: string }>(
        `SELECT time FROM ${measurement} WHERE ${timeConstraint} ORDER BY time ASC LIMIT 1`
      );

      // Return first result found (oldest in this chunk)
      if (result.length > 0) {
        return result[0];
      }
      // No data in this chunk, continue to newer chunk
    } catch (error) {
      // Check if this chunk hit the file limit
      if (isFileLimitError(error)) {
        // Log warning and skip this chunk
        console.warn(`Chunk query (${startDays}-${endDays} days ago) exceeded file limit, skipping...`);
        continue;
      }
      // Re-throw other errors
      throw error;
    }
  }

  // No data found in any chunk
  return null;
}

// Get oldest record timestamp from InfluxDB
// Returns null if database is empty
// Uses chunked queries to avoid scanning too many files at once
async function getOldestDbTime(influx: InfluxClient): Promise<Date | null> {
  try {
    // Query for oldest data point using chunked approach
    // Iterates from oldest to newest chunks until data is found
    const result = await queryOldestInChunks(influx, 'apex_probe');

    // Return null if no data found in any chunk
    if (!result) {
      return null;
    }

    // Parse and return the timestamp
    return new Date(result.time);
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
    // Uses chunked queries to avoid InfluxDB 3 Core file limit errors
    const preCheckResult = await queryNewestInChunks(influx, 'apex_probe');
    const newestDbTimeBefore = preCheckResult
      ? new Date(preCheckResult.time)
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
    // Uses chunked queries to avoid InfluxDB 3 Core file limit errors
    const newestResult = await queryNewestInChunks(influx, 'apex_probe');

    // Query InfluxDB for oldest data point
    const oldestDbTime = await getOldestDbTime(influx);

    // Check if database has any data
    if (!newestResult) {
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
    const newestDbTime = new Date(newestResult.time);

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
    // Check for file limit error and provide specific guidance
    if (isFileLimitError(error)) {
      // Display helpful error message with solutions
      console.error('=== InfluxDB File Limit Error ===');
      console.error(`Query lookback (${config.queryLookbackDays} days) exceeds file limit.`);
      console.error('Solutions:');
      console.error(`  1. Reduce QUERY_LOOKBACK_DAYS in .env (try: 14 or 7)`);
      console.error('  2. Run: influxdb3 compact --database aquarium');
      console.error('================================');
      // Return without re-throwing - let polling continue
      return;
    }
    // Log other errors but don't fail startup
    console.error('Failed to check database freshness:', error);
  }
}

// Write an array of InfluxDB points in batches to avoid overwhelming the server
// Returns the total number of points written
async function writeBatched(influx: InfluxClient, points: import('@influxdata/influxdb3-client').Point[], batchSize: number = 500): Promise<number> {
  let totalWritten = 0;
  for (let i = 0; i < points.length; i += batchSize) {
    // Extract batch of points
    const end = Math.min(i + batchSize, points.length);
    const batch: typeof points = [];
    for (let j = i; j < end; j++) {
      batch.push(points[j]);
    }
    // Write batch to InfluxDB
    await influx.writePoints(batch);
    totalWritten += batch.length;
    // Small delay between batches
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return totalWritten;
}

// Fill any gaps in the last 24 hours of data on startup
// Fetches the full 24 hours from Apex and writes all records (probes + outlets)
// InfluxDB deduplicates existing records, so this safely fills any gaps
async function backfillRecentGaps(influx: InfluxClient, apexClient: ApexClient): Promise<void> {
  console.log('Backfilling last 24 hours to fill any gaps...');
  try {
    // Calculate start date as 24 hours ago
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 1);

    // Fetch last 24 hours of probe data from Apex
    const datalog = await apexClient.getHistoricalDatalog(startDate, 1);
    // Fetch last 24 hours of outlet data from Apex
    const outlog = await apexClient.getHistoricalOutlog(startDate, 1);

    // Write probe data in batches
    let probeCount = 0;
    if (datalog.records.length > 0) {
      const probePoints = mapAllRecordsToPoints(datalog);
      probeCount = await writeBatched(influx, probePoints.probes);
    }

    // Write outlet data in batches
    let outletCount = 0;
    if (outlog.records.length > 0) {
      const outletPoints = mapAllOutlogToPoints(outlog);
      outletCount = await writeBatched(influx, outletPoints.outlets);
    }

    // Log results
    if (probeCount === 0 && outletCount === 0) {
      console.log('Backfill: No records found in last 24 hours');
    } else {
      console.log(`Backfill complete: wrote ${probeCount} probe + ${outletCount} outlet points (InfluxDB deduplicates existing)`);
    }
  } catch (error) {
    // Log error but don't fail startup
    console.error('Backfill failed:', error);
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

  // Backfill any gaps in the last 24 hours before starting polling
  // This runs synchronously to ensure recent data is complete before polls begin
  await backfillRecentGaps(influx, apexClient);

  // Sync Apex data to database in background (don't block polling)
  console.log('Starting background sync (polling will continue)...');
  checkDatabaseFreshness(influx, apexClient)
    .then(() => console.log('Background sync finished'))
    .catch((error) => console.error('Background sync failed:', error));

  // Define the polling function that fetches and writes probe + outlet data
  async function poll() {
    // Capture timestamp once — reused for InfluxDB point timestamps and log messages
    const timestamp = new Date();
    // Format as ISO string for log output
    const timestampStr = timestamp.toISOString();
    // Log poll start
    console.log(`[${timestampStr}] Polling Apex...`);

    try {
      // Fetch datalog from Apex (XML format) with minimal=true for polling efficiency
      const datalog = await apexClient.getDatalog(true);
      // Transform datalog to InfluxDB points (latest record only)
      const probePoints = mapDatalogToPoints(datalog);
      // Write all probe points to InfluxDB
      await influx.writePoints(probePoints.probes);

      // Fetch current state of ALL outputs from status.json (replaces outlog event-log approach)
      // status.json returns a live snapshot of every outlet — not just the most recent change
      const status = await apexClient.getStatus();
      // Transform status snapshot to InfluxDB points; share the same poll timestamp as probes
      const outletPoints = mapStatusToOutletPoints(status, timestamp);
      // Write all outlet points to InfluxDB
      await influx.writePoints(outletPoints.outlets);

      // Log success with point counts
      const latestDate = datalog.records[datalog.records.length - 1]?.date || 'N/A';
      console.log(`[${timestampStr}] Wrote ${probePoints.probes.length} probe + ${outletPoints.outlets.length} outlet points (record: ${latestDate})`);
    } catch (error) {
      // Log any errors that occur during polling
      console.error(`[${timestampStr}] Poll failed:`, error);
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
