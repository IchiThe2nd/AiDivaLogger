// Import InfluxDB 3.x Point class for building data points
import { Point } from '@influxdata/influxdb3-client';
// Import Apex types for input data structure
import type { ApexDatalog, ApexRecord, ApexOutlog, ApexOutletRecord, ApexStatus, ApexStatusOutput, ApexStatusInput } from '../apex/types.js';

// Interface for the collection of mapped InfluxDB probe points
export interface ApexPoints {
  probes: Point[];  // Points for all probe readings across all records
}

// Interface for the collection of mapped InfluxDB outlet points
export interface ApexOutletPoints {
  outlets: Point[];  // Points for all outlet state changes
}

// Interface for the collection of mapped InfluxDB input points
export interface ApexInputPoints {
  inputs: Point[];  // Points for all input readings (FMM floats, probes, etc.)
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
  return record.probes
    .filter((probe) => !isNaN(probe.value))    // Skip probes with NaN (disconnected/unconfigured sensors)
    .map((probe) =>
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

// Transform a single outlet record to an InfluxDB 3.x Point
// Maps ON/OFF string to integer 1/0 for Grafana graphing
function mapOutletRecordToPoint(
  record: ApexOutletRecord,
  hostname: string,
  timezoneOffset: number
): Point {
  // Parse the record timestamp
  const timestamp = parseApexDate(record.date, timezoneOffset);
  // Convert ON/OFF string to integer (1=ON, 0=OFF)
  const state = record.value === 'ON' ? 1 : 0;

  // Build and return the InfluxDB Point
  return Point.measurement('apex_outlet')       // Measurement name for outlet data
    .setTag('host', hostname)                   // Apex hostname tag
    .setTag('name', record.name)                // Outlet name tag
    .setIntegerField('state', state)            // State as integer (1=ON, 0=OFF)
    .setTimestamp(timestamp);                   // Record timestamp
}

// Transform Apex outlog into InfluxDB points
// Returns point for only the most recent record (current state)
export function mapOutlogToPoints(outlog: ApexOutlog): ApexOutletPoints {
  // Get the most recent record (last in array)
  const latestRecord = outlog.records[outlog.records.length - 1];

  // If no records, return empty array
  if (!latestRecord) {
    return { outlets: [] };
  }

  // Map the latest record to an InfluxDB point
  const point = mapOutletRecordToPoint(
    latestRecord,
    outlog.hostname,
    outlog.timezone
  );

  // Return the mapped point
  return { outlets: [point] };
}

// Transform all records in outlog to InfluxDB points
// Use this for backfilling historical outlet data
export function mapAllOutlogToPoints(outlog: ApexOutlog): ApexOutletPoints {
  // Map each outlet record to an InfluxDB point
  const outlets = outlog.records.map((record) =>
    mapOutletRecordToPoint(record, outlog.hostname, outlog.timezone)
  );

  // Return all mapped points
  return { outlets };
}

// Map a single ApexStatusOutput to an InfluxDB Point
// Timestamp is provided externally (status.json has no per-record timestamps)
function mapStatusOutputToPoint(
  output: ApexStatusOutput,
  hostname: string,
  timestamp: Date
): Point {
  // Extract state string from the first element of the status array
  // Possible values: "ON" (manual on), "OFF" (off), "AON" (auto on), "AOF" (auto off), "TBL" (table-controlled)
  const stateStr = output.status[0];
  // ON and AON both mean the output is physically running — map to 1
  // Everything else (OFF, AOF, TBL) maps to 0
  const state = (stateStr === 'ON' || stateStr === 'AON') ? 1 : 0;

  // Build InfluxDB Point — reuses apex_outlet measurement for Grafana compatibility
  return Point.measurement('apex_outlet')
    .setTag('host', hostname)          // Apex hostname for multi-controller filtering
    .setTag('name', output.name)       // Output name (e.g., "Sump", "TopOff")
    .setTag('type', output.type)       // Output type tag (e.g., "outlet", "24v", "virtual") — allows Grafana filtering
    .setIntegerField('state', state)   // Binary state: 1=on, 0=off
    .setTimestamp(timestamp);          // Fetch time passed in from poll()
}

// Transform an ApexStatus snapshot into InfluxDB outlet points
// Captures ALL outputs in one shot — use the `type` tag in Grafana to filter by output type
// Timestamp must be provided by the caller (new Date() at time of getStatus() fetch)
export function mapStatusToOutletPoints(status: ApexStatus, timestamp: Date): ApexOutletPoints {
  // Map every output to a point — all types included, none filtered out
  const outlets = status.outputs.map((output: ApexStatusOutput) =>
    mapStatusOutputToPoint(output, status.hostname, timestamp)
  );
  // Return using the existing ApexOutletPoints interface
  return { outlets };
}

// Transform an ApexStatus snapshot into InfluxDB input points
// Captures ALL inputs (FMM float switches, voltage probes, etc.)
// Timestamp must be provided by the caller (new Date() at time of getStatus() fetch)
export function mapStatusToInputPoints(status: ApexStatus, timestamp: Date): ApexInputPoints {
  // Map every input to a point — value is already numeric (e.g. 0/1 for FMM floats)
  const inputs = status.inputs.map((input: ApexStatusInput) =>
    Point.measurement('apex_input')
      .setTag('host', status.hostname)   // Apex hostname for multi-controller filtering
      .setTag('name', input.name)        // Input name (e.g. "FMM_6")
      .setTag('type', input.type)        // Input type (e.g. "fmm", "volt", "alk")
      .setFloatField('value', input.value) // Numeric value — 0/1 for floats, voltage, etc.
      .setTimestamp(timestamp)           // Fetch time passed in from poll()
  );
  return { inputs };
}
