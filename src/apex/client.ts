// Import the XML parser library
import { XMLParser } from 'fast-xml-parser';
// Import types for the datalog structure
import type { ApexDatalog, ApexDatalogXml, ApexProbeXml, ApexRecordXml, DataCoverageResult } from './types.js';
// Import ApexRecord for type annotations
import type { ApexRecord } from './types.js';

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

  // Format a Date object to Apex sdate format (YYMMDDHHMM)
  private formatApexDate(date: Date): string {
    // Get 2-digit year (last 2 digits of full year)
    const year = String(date.getFullYear()).slice(-2);
    // Get month with leading zero (1-12 -> 01-12)
    const month = String(date.getMonth() + 1).padStart(2, '0');
    // Get day with leading zero
    const day = String(date.getDate()).padStart(2, '0');
    // Get hours with leading zero
    const hours = String(date.getHours()).padStart(2, '0');
    // Get minutes with leading zero
    const minutes = String(date.getMinutes()).padStart(2, '0');
    // Concatenate all parts into YYMMDDHHMM format
    return `${year}${month}${day}${hours}${minutes}`;
  }

  // Fetch historical datalog from Apex starting at a specific date
  async getHistoricalDatalog(startDate: Date, days: number): Promise<ApexDatalog> {
    // Format the start date for the API query parameter
    const sdate = this.formatApexDate(startDate);
    // Build the full URL with query parameters for historical data
    const url = `${this.baseUrl}/cgi-bin/datalog.xml?sdate=${sdate}&days=${days}`;

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
      throw new Error(`Failed to fetch Apex historical datalog: ${response.status} ${response.statusText}`);
    }

    // Get the raw XML text from response
    const xmlText = await response.text();
    // Parse XML to JavaScript object
    const xmlData = this.parser.parse(xmlText) as ApexDatalogXml;

    // Transform parsed XML to clean ApexDatalog structure
    return this.transformDatalog(xmlData);
  }

  // Fetch datalog from the Apex controller and parse to structured format
  // Set minimal=true to request only today's data (for polling efficiency)
  async getDatalog(minimal: boolean = false): Promise<ApexDatalog> {
    // Build the full URL to the datalog endpoint
    // With minimal=true, add days=0 to reduce response size (network optimization)
    const url = minimal
      ? `${this.baseUrl}/cgi-bin/datalog.xml?days=0`
      : `${this.baseUrl}/cgi-bin/datalog.xml`;

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

  // Check if a record has useful data (at least one probe with a valid, finite value)
  // Useful data means the probe value is not NaN and is a finite number
  private hasUsefulData(record: ApexRecord): boolean {
    // Check if any probe has a valid numeric value
    return record.probes.some((probe) => {
      // Value must be a finite number (not NaN, not Infinity)
      return Number.isFinite(probe.value);
    });
  }

  // Extract date portion (MM/DD/YYYY) from full date string
  private extractDatePart(dateStr: string): string {
    // Use substring for fixed format "MM/DD/YYYY HH:MM:SS" (avoids array allocation)
    return dateStr.substring(0, 10);
  }

  // Get data coverage information from Apex
  // Fetches historical data in 1-day chunks with progress reporting
  // Checks last 60 days of data
  // Optional onChunk callback is called with each day's datalog for DB writes
  async getDataCoverage(onChunk?: (datalog: ApexDatalog) => Promise<void>): Promise<DataCoverageResult> {
    // Scan last 60 days of data
    const totalDaysToCheck = 60;
    // Calculate start date as 60 days ago
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - totalDaysToCheck);

    // Track only metadata instead of accumulating full records (memory optimization)
    // Stores oldest useful record date seen so far (null if none found yet)
    let oldestUsefulDate: string | null = null;
    // Stores newest useful record date seen so far (null if none found yet)
    let newestUsefulDate: string | null = null;
    // Count of useful records (instead of storing them all)
    let usefulRecordCount = 0;
    // Track total records fetched
    let totalRecordsFetched = 0;
    // Track unique dates with data
    const uniqueDatesWithData = new Set<string>();

    // Fetch in 3-day chunks to balance HTTP requests vs InfluxDB dedup load
    // 60 days / 3 = 20 requests (vs 60 with 1-day chunks)
    const chunkSizeDays = 3;
    const totalChunks = Math.ceil(totalDaysToCheck / chunkSizeDays);
    console.log(`Scanning ${totalDaysToCheck} days of Apex data in ${totalChunks} chunks...`);

    // Fetch data in 3-day chunks (67% fewer HTTP requests than 1-day chunks)
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      // Calculate the start date for this chunk
      const chunkStartOffset = chunkIndex * chunkSizeDays;
      const chunkDate = new Date(startDate);
      chunkDate.setDate(chunkDate.getDate() + chunkStartOffset);

      // Calculate actual days in this chunk (last chunk may be smaller)
      const remainingDays = totalDaysToCheck - chunkStartOffset;
      const daysInChunk = Math.min(chunkSizeDays, remainingDays);

      try {
        // Fetch multiple days of data in one request
        const datalog = await this.getHistoricalDatalog(chunkDate, daysInChunk);

        // Count records in this chunk
        const chunkRecords = datalog.records.length;
        totalRecordsFetched += chunkRecords;

        // Filter for useful records
        const usefulInChunk = datalog.records.filter((record) => this.hasUsefulData(record));

        // Update metadata counters instead of storing full records (memory optimization)
        if (usefulInChunk.length > 0) {
          // Increment count instead of concatenating arrays
          usefulRecordCount += usefulInChunk.length;
          // Track oldest date (first useful record we encounter)
          // Since we iterate chronologically, first chunk with data has the oldest
          if (oldestUsefulDate === null) {
            oldestUsefulDate = usefulInChunk[0].date;
          }
          // Track newest date (last record in current chunk)
          // Since we iterate chronologically, this keeps getting updated to the latest
          newestUsefulDate = usefulInChunk[usefulInChunk.length - 1].date;
          // Track unique dates for coverage calculation
          usefulInChunk.forEach((record) => {
            uniqueDatesWithData.add(this.extractDatePart(record.date));
          });
          // Call onChunk callback to write data to DB if provided
          if (onChunk) {
            await onChunk(datalog);
          }
        }

        // Log progress per chunk (shows date range instead of single day)
        const chunkEndDate = new Date(chunkDate);
        chunkEndDate.setDate(chunkEndDate.getDate() + daysInChunk - 1);
        const progress = Math.round(((chunkIndex + 1) / totalChunks) * 100);
        console.log(`[${progress}%] ${chunkDate.toLocaleDateString()}-${chunkEndDate.toLocaleDateString()}: ${chunkRecords} records (${usefulInChunk.length} useful)`);

      } catch (error) {
        // Log error but continue with next chunk
        const dateStr = chunkDate.toLocaleDateString();
        console.log(`[Error] ${dateStr}: Failed to fetch`);
      }
    }

    console.log(`Scan complete: ${totalRecordsFetched} total records, ${usefulRecordCount} useful`);

    // If no useful records found, return empty result
    if (usefulRecordCount === 0) {
      return {
        totalRecords: totalRecordsFetched,
        usefulRecords: 0,
        oldestUsefulRecordDate: '',
        newestUsefulRecordDate: '',
        totalDays: totalDaysToCheck,
        daysWithData: 0,
        coveragePercent: 0,
      };
    }

    // Count days with useful data
    const daysWithData = uniqueDatesWithData.size;
    // Calculate coverage percentage
    const coveragePercent = totalDaysToCheck > 0 ? (daysWithData / totalDaysToCheck) * 100 : 0;

    // Return the coverage analysis result using tracked metadata
    return {
      totalRecords: totalRecordsFetched,
      usefulRecords: usefulRecordCount,                       // Use counter instead of array.length
      oldestUsefulRecordDate: oldestUsefulDate || '',         // Use tracked date (with fallback)
      newestUsefulRecordDate: newestUsefulDate || '',         // Use tracked date (with fallback)
      totalDays: totalDaysToCheck,
      daysWithData,
      coveragePercent: Math.round(coveragePercent * 100) / 100,
    };
  }

  // Transform raw XML structure to clean ApexDatalog format
  private transformDatalog(xmlData: ApexDatalogXml): ApexDatalog {
    // Extract the datalog root element
    const datalog = xmlData.datalog;

    // Handle case where no records exist in the XML
    if (!datalog.record) {
      // Return datalog with empty records array
      return {
        software: datalog['@_software'],
        hardware: datalog['@_hardware'],
        hostname: datalog.hostname,
        serial: datalog.serial,
        timezone: parseFloat(datalog.timezone),
        records: [],
      };
    }

    // Normalize records to always be an array (XML may have single record)
    const recordsRaw = Array.isArray(datalog.record) ? datalog.record : [datalog.record];

    // Filter out any undefined or null records
    const validRecords = recordsRaw.filter((record): record is ApexRecordXml => record != null);

    // Transform each record to clean format
    const records = validRecords.map((record: ApexRecordXml) => {
      // Handle case where record has no probes
      if (!record.probe) {
        return {
          date: record.date,
          probes: [],
        };
      }

      // Normalize probes to always be an array
      const probesRaw = Array.isArray(record.probe) ? record.probe : [record.probe];

      // Filter out any undefined probes
      const validProbes = probesRaw.filter((probe): probe is ApexProbeXml => probe != null);

      // Transform each probe, parsing value to number
      const probes = validProbes.map((probe: ApexProbeXml) => ({
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
