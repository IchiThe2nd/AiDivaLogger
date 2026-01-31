// Import InfluxDB 3.x Point class for building data points
import { Point } from '@influxdata/influxdb3-client';
// Import Apex types for input data structure
import type { ApexDatalog, ApexRecord } from '../apex/types.js';

// Interface for the collection of mapped InfluxDB points
export interface ApexPoints {
  probes: Point[];  // Points for all probe readings across all records
}

// Parse Apex date string to JavaScript Date object
// Format: "MM/DD/YYYY HH:MM:SS"
function parseApexDate(dateStr: string, timezoneOffset: number): Date {
  // Split date and time parts
  const [datePart, timePart] = dateStr.split(' ');
  // Split date into components
  const [month, day, year] = datePart.split('/').map(Number);
  // Split time into components
  const [hours, minutes, seconds] = timePart.split(':').map(Number);
  // Create date in UTC, adjusting for Apex timezone
  const date = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
  // Adjust for timezone offset (convert hours to milliseconds)
  date.setTime(date.getTime() - timezoneOffset * 60 * 60 * 1000);
  // Return the adjusted date
  return date;
}

// Transform a single record's probes to InfluxDB 3.x Points
function mapRecordToPoints(
  record: ApexRecord,
  hostname: string,
  timezoneOffset: number
): Point[] {
  // Parse the record timestamp
  const timestamp = parseApexDate(record.date, timezoneOffset);

  // Map each probe to an InfluxDB Point using builder pattern
  // InfluxDB 3.x uses static factory method instead of constructor
  return record.probes.map((probe) =>
    Point.measurement('apex_probe')            // Measurement name via factory method
      .setTag('host', hostname)                // Apex hostname tag
      .setTag('name', probe.name)              // User-assigned probe name tag
      .setTag('probe_type', probe.type)        // Probe type tag (Temp, pH, ORP, etc.)
      .setFloatField('value', probe.value)     // Current probe reading as float
      .setTimestamp(timestamp)                 // Record timestamp
  );
}

// Transform Apex datalog into InfluxDB points
// Returns points for only the most recent record (current values)
export function mapDatalogToPoints(datalog: ApexDatalog): ApexPoints {
  // Get the most recent record (last in array)
  const latestRecord = datalog.records[datalog.records.length - 1];

  // If no records, return empty array
  if (!latestRecord) {
    return { probes: [] };
  }

  // Map the latest record to InfluxDB points
  const probes = mapRecordToPoints(
    latestRecord,
    datalog.hostname,
    datalog.timezone
  );

  // Return the mapped points
  return { probes };
}

// Transform all records in datalog to InfluxDB points
// Use this for backfilling historical data
export function mapAllRecordsToPoints(datalog: ApexDatalog): ApexPoints {
  // Flatten all records into a single array of points
  const probes = datalog.records.flatMap((record) =>
    mapRecordToPoints(record, datalog.hostname, datalog.timezone)
  );

  // Return all mapped points
  return { probes };
}
