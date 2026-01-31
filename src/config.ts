// Import dotenv to load environment variables from .env file
import 'dotenv/config';

// Interface defining the shape of our application configuration
export interface Config {
  // Apex controller connection settings
  apex: {
    host: string;           // IP address or hostname of the Apex
    username?: string;      // Optional username for authentication
    password?: string;      // Optional password for authentication
  };
  // InfluxDB 3.x connection settings
  influx: {
    url: string;            // Full URL to InfluxDB server (e.g., http://localhost:8086)
    token?: string;         // API token for authentication (required for cloud)
    database: string;       // Database/bucket name to write to
  };
  pollInterval: string;     // Cron expression for polling schedule
  backfillDays: number;     // Days of historical data to fetch on first run
  forceFullSync: boolean;   // If true, sync all data ignoring existing DB records (fills gaps)
}

// Helper function to get required environment variables
// Throws an error if the variable is not set
function requireEnv(name: string): string {
  // Attempt to read the environment variable
  const value = process.env[name];
  // If not found, throw descriptive error
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  // Return the value if found
  return value;
}

// Helper function to get optional environment variables
// Returns undefined if the variable is not set
function optionalEnv(name: string): string | undefined {
  // Return the value or undefined if empty/not set
  return process.env[name] || undefined;
}

// Build InfluxDB URL from host and port (for backwards compatibility)
function buildInfluxUrl(): string {
  // Check if full URL is provided
  const url = process.env.INFLUX_URL;
  if (url) {
    return url;
  }
  // Fall back to building URL from host and port (legacy config)
  const host = process.env.INFLUX_HOST || 'localhost';
  const port = process.env.INFLUX_PORT || '8086';
  return `http://${host}:${port}`;
}

// Export the configuration object built from environment variables
export const config: Config = {
  // Apex configuration section
  apex: {
    host: requireEnv('APEX_HOST'),              // Required: Apex IP/hostname
    username: optionalEnv('APEX_USERNAME'),     // Optional: auth username
    password: optionalEnv('APEX_PASSWORD'),     // Optional: auth password
  },
  // InfluxDB 3.x configuration section
  influx: {
    url: buildInfluxUrl(),                                    // Full URL to InfluxDB
    token: optionalEnv('INFLUX_TOKEN'),                       // Optional: API token
    database: process.env.INFLUX_DATABASE || 'aquarium',      // Database/bucket name
  },
  // Polling schedule - defaults to every 5 minutes
  pollInterval: process.env.POLL_INTERVAL || '*/5 * * * *',
  // Days of historical data to backfill on first run - defaults to 7 days
  backfillDays: parseInt(process.env.BACKFILL_DAYS || '7', 10),
  // Force full sync - writes all records, letting InfluxDB deduplicate (fills gaps)
  forceFullSync: process.env.FORCE_FULL_SYNC === 'true',
};
