// TypeScript interfaces for the Reefmat roll filter API responses

// Response from the Reefmat /dashboard endpoint
// All fields reflect the live state of the filter at the time of the request
export interface ReefmatDashboard {
  mode: string;                      // Operating mode: "auto" | "manual"
  is_internet_connected: boolean;    // Whether the device has internet access
  is_ec_sensor_connected: boolean;   // Whether the EC (conductivity) sensor is connected
  unclean_sensor: boolean;           // True if the sensor reads as dirty/blocked
  auto_advance: boolean;             // Whether auto-advance on dirty sensor is enabled
  is_advancing: boolean;             // True if the roll motor is currently moving
  last_advance_cause: string;        // Reason for the last roll advance (e.g. "ec_sensor")
  roll_level: string;                // Remaining roll status: "ok" | "running_low" | "empty"
  days_till_end_of_roll: number;     // Estimated days of roll remaining
  internal_ec_average: number;       // Average EC reading from the internal sensor (mS/cm)
  external_ec_average: number;       // Average EC reading from the external sensor (mS/cm)
  setup_date: string;                // ISO 8601 date when this roll was installed
  cumulative_steps: number;          // Total motor steps used on this roll
  device_setup_date: number;         // Unix timestamp when the device was first set up
  lifetime_steps: number;            // Total motor steps since device manufacture
  today_usage: number;               // Millimeters of roll consumed today
  daily_average_usage: number;       // Average daily roll consumption in mm
  total_usage: number;               // Total roll consumed since setup (mm)
  remaining_length: number;          // Estimated remaining roll length in mm
  material: ReefmatMaterial;         // Information about the installed roll material
}

// Describes the filter roll material currently installed
export interface ReefmatMaterial {
  name: string;               // Human-readable name (e.g. "28 Meter")
  external_diameter: number;  // Outer diameter of roll in cm
  thickness: number;          // Thickness of the filter material in cm
  is_partial: boolean;        // True if this is a partial (previously used) roll
}
