// Import InfluxDB types for point structure
import type Influx from 'influx';
// Import Apex types for input data structure
import type { ApexDatalog, ApexRecord } from '../apex/types.js';

// Interface for the collection of mapped InfluxDB points
export interface ApexPoints {
  probes: Influx.IPoint[];  // Points for all probe readings across all records
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

// Transform a single record's probes to InfluxDB points
function mapRecordToPoints(
  record: ApexRecord,
  hostname: string,
  timezoneOffset: number
): Influx.IPoint[] {
  // Parse the record timestamp
  const timestamp = parseApexDate(record.date, timezoneOffset);

  // Map each probe to an InfluxDB point
  return record.probes.map((probe) => ({
    measurement: 'apex_probe',          // Measurement name
    tags: {
      host: hostname,                   // Apex hostname
      name: probe.name,                 // User-assigned probe name
      probe_type: probe.type,           // Probe type (Temp, pH, ORP, etc.)
    },
    fields: {
      value: probe.value,               // Current probe reading
    },
    timestamp,                          // Record timestamp
  }));
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
