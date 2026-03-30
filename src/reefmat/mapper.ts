// Import InfluxDB 3.x Point class for building data points
import { Point } from '@influxdata/influxdb3-client';
// Import the Reefmat dashboard type
import type { ReefmatDashboard } from './types.js';

// Interface for the collection of mapped Reefmat InfluxDB points
export interface ReefmatPoints {
  points: Point[];  // All points derived from a single dashboard snapshot
}

// Map a roll_level string to a numeric value for Grafana graphing
// "ok" → 2, "running_low" → 1, "empty" → 0, unknown → -1
export function rollLevelToInt(rollLevel: string): number {
  switch (rollLevel) {
    case 'ok':          return 2;  // Plenty of roll remaining
    case 'running_low': return 1;  // Low but not empty
    case 'empty':       return 0;  // Roll exhausted
    default:            return -1; // Unknown state
  }
}

// Transform a Reefmat dashboard response into InfluxDB 3.x Points
// Produces two measurements:
//   reefmat_status  — roll level, motor state, EC readings, days remaining
//   reefmat_usage   — roll consumption stats (today, average, total, remaining)
// All points share the same timestamp (the moment the dashboard was fetched)
export function mapDashboardToPoints(
  dashboard: ReefmatDashboard,
  host: string,
  timestamp: Date = new Date()
): ReefmatPoints {
  // --- reefmat_status: live operational state ---
  const statusPoint = Point.measurement('reefmat_status')
    .setTag('host', host)                                          // Device identifier tag
    .setTag('mode', dashboard.mode)                                // Operating mode tag (auto/manual)
    .setIntegerField('roll_level', rollLevelToInt(dashboard.roll_level))  // Numeric roll level
    .setIntegerField('days_till_end_of_roll', dashboard.days_till_end_of_roll)  // Days left
    .setFloatField('internal_ec', dashboard.internal_ec_average)  // Internal EC sensor reading
    .setFloatField('external_ec', dashboard.external_ec_average)  // External EC sensor reading
    .setIntegerField('is_advancing', dashboard.is_advancing ? 1 : 0)     // Motor running (1/0)
    .setIntegerField('ec_sensor_connected', dashboard.is_ec_sensor_connected ? 1 : 0)  // Sensor present
    .setIntegerField('unclean_sensor', dashboard.unclean_sensor ? 1 : 0)  // Sensor dirty flag
    .setTimestamp(timestamp);  // Snapshot timestamp

  // --- reefmat_usage: roll consumption metrics ---
  const usagePoint = Point.measurement('reefmat_usage')
    .setTag('host', host)                                                  // Device identifier tag
    .setTag('material', dashboard.material.name)                           // Roll material name tag
    .setFloatField('today_usage_mm', dashboard.today_usage)                // mm consumed today
    .setFloatField('daily_average_mm', dashboard.daily_average_usage)      // Average daily consumption
    .setFloatField('total_usage_mm', dashboard.total_usage)                // Total mm consumed this roll
    .setFloatField('remaining_length_mm', dashboard.remaining_length)      // Estimated mm remaining
    .setIntegerField('cumulative_steps', dashboard.cumulative_steps)       // Motor steps this roll
    .setTimestamp(timestamp);  // Snapshot timestamp

  // Return both points together
  return { points: [statusPoint, usagePoint] };
}
