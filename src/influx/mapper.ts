// Import InfluxDB types for point structure
import type Influx from 'influx';
// Import Apex types for input data structure
import type { ApexStatus } from '../apex/types.js';

// Interface for the collection of mapped InfluxDB points
export interface ApexPoints {
  probes: Influx.IPoint[];      // Points for probe readings
  outputs: Influx.IPoint[];     // Points for output states
  power?: Influx.IPoint;        // Optional point for power status
}

// Transform Apex status data into InfluxDB points
export function mapApexStatusToPoints(status: ApexStatus): ApexPoints {
  // Extract hostname for tagging all points
  const hostname = status.system.hostname;

  // Map each probe input to an InfluxDB point
  const probes: Influx.IPoint[] = status.inputs.map((probe) => ({
    measurement: 'apex_probe',          // Measurement name
    tags: {
      host: hostname,                   // Apex hostname
      name: probe.name,                 // User-assigned probe name
      probe_type: probe.type,           // Probe type (Temp, pH, etc.)
      device_id: probe.did,             // Unique device identifier
    },
    fields: {
      value: probe.value,               // Current probe reading
    },
  }));

  // Map each output to an InfluxDB point
  const outputs: Influx.IPoint[] = status.outputs.map((output) => ({
    measurement: 'apex_output',         // Measurement name
    tags: {
      host: hostname,                   // Apex hostname
      name: output.name,                // User-assigned output name
      output_type: output.type,         // Output type (outlet, variable, etc.)
      device_id: output.did,            // Unique device identifier
    },
    fields: {
      state: output.status.join(','),   // Join status array into string
      intensity: output.intensity ?? 0,  // Default to 0 if no intensity
    },
  }));

  // Initialize power point as undefined
  let power: Influx.IPoint | undefined;
  // Only create power point if power data exists
  if (status.power) {
    power = {
      measurement: 'apex_power',        // Measurement name
      tags: {
        host: hostname,                 // Apex hostname
      },
      fields: {
        failed: status.power.failed,    // Power failure timestamp
        restored: status.power.restored, // Power restored timestamp
      },
    };
  }

  // Return all mapped points
  return { probes, outputs, power };
}
