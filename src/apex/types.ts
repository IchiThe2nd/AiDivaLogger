// Interface for probe/sensor data from the Apex
export interface ApexProbe {
  did: string;      // Device ID - unique identifier for the probe
  type: string;     // Probe type: "Temp", "pH", "ORP", "Cond", etc.
  name: string;     // User-assigned name for the probe
  value: number;    // Current reading value from the probe
}

// Interface for output devices (outlets, dimmers, etc.)
export interface ApexOutput {
  did: string;        // Device ID - unique identifier for the output
  type: string;       // Output type: "outlet", "variable", "virtual", "alert"
  name: string;       // User-assigned name for the output
  status: string[];   // Array of status flags (e.g., ["AON"], ["AOF"])
  intensity?: number; // Optional intensity percentage for dimmable outputs
}

// Interface for feed cycle information
export interface ApexFeed {
  name: string;     // Name of the active feed cycle (A, B, C, D)
  active: number;   // Whether feed mode is active (0 or 1)
}

// Interface for power failure tracking
export interface ApexPower {
  failed: number;    // Unix timestamp when power failed
  restored: number;  // Unix timestamp when power was restored
}

// Interface for Apex system information
export interface ApexSystem {
  hostname: string;   // Network hostname of the Apex
  software: string;   // Firmware version string
  hardware: string;   // Hardware revision string
  serial?: string;    // Optional serial number
  type?: string;      // Optional controller type identifier
}

// Main interface for the complete Apex status response
export interface ApexStatus {
  system: ApexSystem;       // System information
  inputs: ApexProbe[];      // Array of all probe readings
  outputs: ApexOutput[];    // Array of all output states
  feed?: ApexFeed;          // Optional feed cycle status
  power?: ApexPower;        // Optional power failure info
}
