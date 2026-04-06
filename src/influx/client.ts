// Import the InfluxDB 3.x client library
import { InfluxDBClient, Point } from '@influxdata/influxdb3-client';

// Configuration interface for InfluxDB 3.x connection
export interface InfluxClientConfig {
  url: string;            // Full URL to InfluxDB server (e.g., http://localhost:8086)
  token?: string;         // API token for authentication (required for cloud)
  database: string;       // Database/bucket name to write to
}

// Wrapper class for InfluxDB 3.x client with simplified API
export class InfluxClient {
  // The underlying InfluxDB client instance
  private client: InfluxDBClient;
  // Database name for all operations
  private database: string;
  // Serial write queue — only one write is in flight at a time.
  // InfluxDB 3 Core's WAL rejects concurrent writes from the same process
  // ("another process has written to the WAL ahead of this one"), so all
  // callers (poll, backfill, background sync) must take turns.
  private writeQueue: Promise<void> = Promise.resolve();

  // Constructor creates the client connection
  constructor(config: InfluxClientConfig) {
    // Store database name for write/query operations
    this.database = config.database;

    // Create the InfluxDB 3.x client
    this.client = new InfluxDBClient({
      host: config.url,
      token: config.token || '',
    });
  }

  // Write an array of Point objects to the database
  async writePoints(points: Point[]): Promise<void> {
    // Skip if no points to write
    if (points.length === 0) {
      return;
    }

    // Chain this write onto the queue so it runs after the previous write completes.
    // `write` is what the caller awaits — it carries the real result or error.
    // `this.writeQueue` is always resolved (errors swallowed) so a failed write
    // doesn't permanently block the queue for subsequent callers.
    const write = this.writeQueue.then(() => this.client.write(points, this.database));
    this.writeQueue = write.catch(() => {});
    return write;
  }

  // Query the database using SQL and return results
  async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
    // Execute SQL query against the database
    const results: T[] = [];
    // Use queryPoints to get results as an async iterator
    const queryResult = this.client.query(sql, this.database);

    // Collect all rows from the result
    for await (const row of queryResult) {
      results.push(row as T);
    }

    return results;
  }

  // Close the client connection (call on shutdown)
  async close(): Promise<void> {
    await this.client.close();
  }
}

// Re-export Point class for convenience
export { Point };

// Factory function to create and initialize the InfluxDB client
export async function createInfluxClient(config: InfluxClientConfig): Promise<InfluxClient> {
  // Create the client instance
  const client = new InfluxClient(config);

  // Note: InfluxDB 3.x doesn't require explicit database creation
  // Databases are created automatically on first write
  console.log(`Connected to InfluxDB 3.x at ${config.url}, database: ${config.database}`);

  // Return the initialized client
  return client;
}
