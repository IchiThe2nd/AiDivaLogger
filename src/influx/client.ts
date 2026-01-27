// Import the InfluxDB client library for InfluxDB 1.x
import Influx from 'influx';

// Configuration interface for InfluxDB connection
export interface InfluxClientConfig {
  host: string;         // InfluxDB server hostname
  port: number;         // InfluxDB server port (default 8086)
  database: string;     // Database name to write to
  username?: string;    // Optional authentication username
  password?: string;    // Optional authentication password
}

// Define the schema for measurements we'll write to InfluxDB
// This helps with type checking and query optimization
const schema: Influx.ISchemaOptions[] = [
  {
    // Schema for probe/sensor readings
    measurement: 'apex_probe',
    fields: {
      value: Influx.FieldType.FLOAT,    // Probe reading as float
    },
    tags: ['host', 'name', 'probe_type', 'device_id'],  // Indexable tags
  },
  {
    // Schema for output device states
    measurement: 'apex_output',
    fields: {
      state: Influx.FieldType.STRING,      // Output state (AON, AOF, etc.)
      intensity: Influx.FieldType.INTEGER,  // Dimmer intensity percentage
    },
    tags: ['host', 'name', 'output_type', 'device_id'],  // Indexable tags
  },
  {
    // Schema for power failure tracking
    measurement: 'apex_power',
    fields: {
      failed: Influx.FieldType.INTEGER,    // Unix timestamp of failure
      restored: Influx.FieldType.INTEGER,  // Unix timestamp of restoration
    },
    tags: ['host'],  // Only tag is the Apex hostname
  },
];

// Factory function to create and initialize the InfluxDB client
export async function createInfluxClient(config: InfluxClientConfig): Promise<Influx.InfluxDB> {
  // Create new InfluxDB client instance with configuration
  const influx = new Influx.InfluxDB({
    host: config.host,            // Server hostname
    port: config.port,            // Server port
    database: config.database,    // Target database
    username: config.username,    // Optional auth username
    password: config.password,    // Optional auth password
    schema,                       // Measurement schemas
  });

  // Get list of existing databases
  const databases = await influx.getDatabaseNames();
  // Check if our target database exists
  if (!databases.includes(config.database)) {
    // Create the database if it doesn't exist
    console.log(`Creating database: ${config.database}`);
    await influx.createDatabase(config.database);
  }

  // Return the initialized client
  return influx;
}
