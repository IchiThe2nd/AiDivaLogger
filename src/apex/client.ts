// Import the XML parser library
import { XMLParser } from 'fast-xml-parser';
// Import types for the datalog structure
import type { ApexDatalog, ApexDatalogXml, ApexProbeXml, ApexRecordXml } from './types.js';

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
  // XML parser instance configured for Apex datalog format
  private parser: XMLParser;

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

    // Initialize XML parser with attribute parsing enabled
    this.parser = new XMLParser({
      ignoreAttributes: false,        // Parse XML attributes (software, hardware)
      attributeNamePrefix: '@_',      // Prefix for attribute names
    });
  }

  // Fetch datalog from the Apex controller and parse to structured format
  async getDatalog(): Promise<ApexDatalog> {
    // Build the full URL to the datalog endpoint
    const url = `${this.baseUrl}/cgi-bin/datalog.xml`;

    // Initialize request headers
    const headers: Record<string, string> = {
      'Accept': 'application/xml',  // Request XML response
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
      throw new Error(`Failed to fetch Apex datalog: ${response.status} ${response.statusText}`);
    }

    // Get the raw XML text from response
    const xmlText = await response.text();
    // Parse XML to JavaScript object
    const xmlData = this.parser.parse(xmlText) as ApexDatalogXml;

    // Transform parsed XML to clean ApexDatalog structure
    return this.transformDatalog(xmlData);
  }

  // Transform raw XML structure to clean ApexDatalog format
  private transformDatalog(xmlData: ApexDatalogXml): ApexDatalog {
    // Extract the datalog root element
    const datalog = xmlData.datalog;

    // Normalize records to always be an array (XML may have single record)
    const recordsRaw = Array.isArray(datalog.record) ? datalog.record : [datalog.record];

    // Transform each record to clean format
    const records = recordsRaw.map((record: ApexRecordXml) => {
      // Normalize probes to always be an array
      const probesRaw = Array.isArray(record.probe) ? record.probe : [record.probe];

      // Transform each probe, parsing value to number
      const probes = probesRaw.map((probe: ApexProbeXml) => ({
        name: probe.name,                     // Probe name as-is
        type: probe.type,                     // Probe type as-is
        value: parseFloat(probe.value),       // Parse string value to float
      }));

      // Return transformed record
      return {
        date: record.date,    // Date string as-is
        probes,               // Array of transformed probes
      };
    });

    // Return complete transformed datalog
    return {
      software: datalog['@_software'],            // Software version from attribute
      hardware: datalog['@_hardware'],            // Hardware version from attribute
      hostname: datalog.hostname,                 // Hostname element
      serial: datalog.serial,                     // Serial number element
      timezone: parseFloat(datalog.timezone),     // Parse timezone to number
      records,                                    // Array of transformed records
    };
  }
}
