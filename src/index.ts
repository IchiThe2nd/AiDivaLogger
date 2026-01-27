// Import node-cron for scheduling periodic tasks
import cron from 'node-cron';
// Import application configuration
import { config } from './config.js';
// Import Apex client for fetching status
import { ApexClient } from './apex/client.js';
// Import InfluxDB client factory
import { createInfluxClient } from './influx/client.js';
// Import data transformation function
import { mapApexStatusToPoints } from './influx/mapper.js';

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

  // Define the polling function that fetches and writes data
  async function poll() {
    // Get current timestamp for logging
    const timestamp = new Date().toISOString();
    // Log poll start
    console.log(`[${timestamp}] Polling Apex...`);

    try {
      // Fetch current status from Apex
      const status = await apexClient.getStatus();
      // Transform status to InfluxDB points
      const points = mapApexStatusToPoints(status);

      // Combine all points into single array
      const allPoints = [
        ...points.probes,                           // Spread probe points
        ...points.outputs,                          // Spread output points
        ...(points.power ? [points.power] : []),    // Add power point if exists
      ];

      // Write all points to InfluxDB
      await influx.writePoints(allPoints);

      // Log success with point count
      console.log(`[${timestamp}] Wrote ${allPoints.length} points to InfluxDB`);
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
