// Import the Reefmat dashboard response type
import type { ReefmatDashboard } from './types.js';

// Configuration interface for the Reefmat client
export interface ReefmatClientConfig {
  host: string;  // IP address or hostname of the Reefmat device
}

// Client class for communicating with the Reefmat roll filter controller
export class ReefmatClient {
  // Base URL for all API requests
  private baseUrl: string;

  // Constructor initializes the client with the device host
  constructor(config: ReefmatClientConfig) {
    // Build base URL from host (device uses plain HTTP)
    this.baseUrl = `http://${config.host}`;
  }

  // Fetch the current dashboard state from the Reefmat
  // Returns parsed dashboard data including roll level, EC readings, and usage stats
  async getDashboard(): Promise<ReefmatDashboard> {
    // Build the dashboard endpoint URL
    const url = `${this.baseUrl}/dashboard`;

    // Fetch the dashboard JSON from the device with a 5-second timeout.
    // The ESP32 web server can be slow to respond; without a timeout Node.js
    // fetch hangs indefinitely and the error message gives no useful detail.
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });

    // Throw a descriptive error if the request failed
    if (!response.ok) {
      throw new Error(`Reefmat request failed: ${response.status} ${response.statusText}`);
    }

    // Parse and return the JSON response as a typed dashboard object
    const data = await response.json() as ReefmatDashboard;

    // Validate that we received a non-empty response
    if (!data || typeof data !== 'object') {
      throw new Error('Reefmat returned an empty or invalid response');
    }

    // Return the parsed dashboard data
    return data;
  }
}
