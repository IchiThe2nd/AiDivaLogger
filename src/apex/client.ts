// Import the ApexStatus type for type safety
import type { ApexStatus } from './types.js';

// Configuration interface for the Apex client
export interface ApexClientConfig {
  host: string;         // IP address or hostname of the Apex
  username?: string;    // Optional username for basic auth
  password?: string;    // Optional password for basic auth
}

// Client class for communicating with Neptune Apex controller
export class ApexClient {
  // Base URL for all API requests
  private baseUrl: string;
  // Cached authorization header for basic auth
  private authHeader?: string;

  // Constructor initializes the client with configuration
  constructor(config: ApexClientConfig) {
    // Build the base URL from the host
    this.baseUrl = `http://${config.host}`;

    // If credentials provided, create Basic auth header
    if (config.username && config.password) {
      // Encode credentials as base64 for Basic auth
      const credentials = Buffer.from(`${config.username}:${config.password}`).toString('base64');
      // Format as Basic auth header value
      this.authHeader = `Basic ${credentials}`;
    }
  }

  // Fetch current status from the Apex controller
  async getStatus(): Promise<ApexStatus> {
    // Build the full URL to the status endpoint
    const url = `${this.baseUrl}/cgi-bin/status.json`;

    // Initialize request headers
    const headers: Record<string, string> = {
      'Accept': 'application/json',  // Request JSON response
    };

    // Add auth header if credentials were provided
    if (this.authHeader) {
      headers['Authorization'] = this.authHeader;
    }

    // Make the HTTP GET request
    const response = await fetch(url, { headers });

    // Check for HTTP errors
    if (!response.ok) {
      // Throw descriptive error with status code
      throw new Error(`Failed to fetch Apex status: ${response.status} ${response.statusText}`);
    }

    // Parse and return the JSON response
    const data = await response.json() as ApexStatus;
    return data;
  }
}
