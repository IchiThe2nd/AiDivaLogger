// Interface for a single probe reading from the datalog
export interface ApexProbe {
  name: string;     // User-assigned name for the probe (e.g., "Tmp", "Dis_pH")
  type: string;     // Probe type: "Temp", "pH", "ORP", "Cond", "Amps", "pwr", "volts"
  value: number;    // Current reading value from the probe
}

// Interface for a single record (snapshot in time) from the datalog
export interface ApexRecord {
  date: string;         // Timestamp string (e.g., "01/27/2026 00:00:00")
  probes: ApexProbe[];  // Array of all probe readings at this timestamp
}

// Interface for the complete datalog response from the Apex
export interface ApexDatalog {
  software: string;     // Firmware version string (e.g., "5.12_2B25")
  hardware: string;     // Hardware revision string (e.g., "1.0")
  hostname: string;     // Network hostname of the Apex (e.g., "Diva")
  serial: string;       // Serial number of the Apex (e.g., "AC5:66625")
  timezone: number;     // Timezone offset in hours (e.g., -8.00)
  records: ApexRecord[];// Array of all data records
}

// Raw XML structure as parsed by fast-xml-parser
// Used internally for parsing before converting to ApexDatalog
export interface ApexDatalogXml {
  datalog: {
    '@_software': string;   // Software version attribute
    '@_hardware': string;   // Hardware version attribute
    hostname: string;       // Hostname element
    serial: string;         // Serial number element
    timezone: string;       // Timezone element
    record: ApexRecordXml | ApexRecordXml[];  // Single record or array of records
  };
}

// Raw XML record structure before transformation
export interface ApexRecordXml {
  date: string;                           // Date string element
  probe: ApexProbeXml | ApexProbeXml[];   // Single probe or array of probes
}

// Raw XML probe structure before transformation
export interface ApexProbeXml {
  name: string;   // Probe name element
  type: string;   // Probe type element
  value: string;  // Value as string (needs parsing to number)
}

// Interface for a single outlet state change from the outlog
export interface ApexOutletRecord {
  date: string;     // Timestamp string (e.g., "02/03/2026 10:41:07")
  name: string;     // Outlet name (e.g., "CalcRx", "TopOff", "ATO_Cycler")
  value: string;    // State string: "ON" or "OFF"
}

// Interface for the complete outlog response from the Apex
export interface ApexOutlog {
  software: string;             // Firmware version string (e.g., "5.12_CA25")
  hardware: string;             // Hardware revision string (e.g., "1.0")
  hostname: string;             // Network hostname of the Apex (e.g., "Diva")
  serial: string;               // Serial number of the Apex (e.g., "AC5:66625")
  timezone: number;             // Timezone offset in hours (e.g., -8.00)
  records: ApexOutletRecord[];  // Array of all outlet state change records
}

// Raw XML structure for outlog as parsed by fast-xml-parser
// Root element is <outlog> instead of <datalog>
export interface ApexOutlogXml {
  outlog: {
    '@_software': string;   // Software version attribute
    '@_hardware': string;   // Hardware version attribute
    hostname: string;       // Hostname element
    serial: string;         // Serial number element
    timezone: string;       // Timezone element (string, needs parseFloat)
    record: ApexOutletRecordXml | ApexOutletRecordXml[];  // Single or array of records
  };
}

// Raw XML outlet record structure before transformation
export interface ApexOutletRecordXml {
  date: string;     // Date string element
  name: string;     // Outlet name element
  value: string;    // State string element ("ON" or "OFF")
}

// Result of analyzing data coverage on the Apex
export interface DataCoverageResult {
  totalRecords: number;              // Total number of records found
  usefulRecords: number;             // Records with at least one valid probe reading
  oldestUsefulRecordDate: string;    // Date of the oldest record with useful data
  newestUsefulRecordDate: string;    // Date of the most recent record with useful data
  totalDays: number;                 // Total span in days from first to last record
  daysWithData: number;              // Number of unique days that have useful data
  coveragePercent: number;           // Percentage of days with useful data
}
