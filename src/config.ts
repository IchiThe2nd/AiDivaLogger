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
  // InfluxDB connection settings
  influx: {
    host: string;           // InfluxDB server hostname
    port: number;           // InfluxDB server port
    database: string;       // Database name to write to
    username?: string;      // Optional username for authentication
    password?: string;      // Optional password for authentication
  };
  pollInterval: string;     // Cron expression for polling schedule
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

// Export the configuration object built from environment variables
export const config: Config = {
  // Apex configuration section
  apex: {
    host: requireEnv('APEX_HOST'),              // Required: Apex IP/hostname
    username: optionalEnv('APEX_USERNAME'),     // Optional: auth username
    password: optionalEnv('APEX_PASSWORD'),     // Optional: auth password
  },
  // InfluxDB configuration section
  influx: {
    host: process.env.INFLUX_HOST || 'localhost',                    // Default to localhost
    port: parseInt(process.env.INFLUX_PORT || '8086', 10),           // Default to 8086
    database: process.env.INFLUX_DATABASE || 'aquarium',             // Default database name
    username: optionalEnv('INFLUX_USERNAME'),                        // Optional: auth username
    password: optionalEnv('INFLUX_PASSWORD'),                        // Optional: auth password
  },
  // Polling schedule - defaults to every 5 minutes
  pollInterval: process.env.POLL_INTERVAL || '*/5 * * * *',
};
