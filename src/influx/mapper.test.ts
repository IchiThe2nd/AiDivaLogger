// Tests for the InfluxDB mapper module
import { describe, it, expect } from 'vitest';
// Import functions under test
import { mapDatalogToPoints, mapAllRecordsToPoints, mapOutlogToPoints, mapAllOutlogToPoints, mapStatusToOutletPoints } from './mapper.js';
// Import types for test data
import type { ApexDatalog, ApexOutlog, ApexStatus } from '../apex/types.js';

// Helper to create a minimal valid datalog for testing
function createTestDatalog(overrides: Partial<ApexDatalog> = {}): ApexDatalog {
  return {
    software: '5.12_2B25',
    hardware: '1.0',
    hostname: 'TestApex',
    serial: 'AC5:12345',
    timezone: -8,
    records: [],
    ...overrides,
  };
}

describe('mapDatalogToPoints', () => {
  describe('empty records handling', () => {
    it('returns empty probes array when records is empty', () => {
      // Create datalog with no records
      const datalog = createTestDatalog({ records: [] });

      // Map to points
      const result = mapDatalogToPoints(datalog);

      // Should return empty array
      expect(result.probes).toEqual([]);
    });
  });

  describe('single record mapping', () => {
    it('returns points for the single record', () => {
      // Create datalog with one record and one probe
      const datalog = createTestDatalog({
        records: [
          {
            date: '01/15/2026 12:30:00',
            probes: [
              { name: 'Temp', type: 'Temp', value: 78.5 },
            ],
          },
        ],
      });

      // Map to points
      const result = mapDatalogToPoints(datalog);

      // Should have one point
      expect(result.probes).toHaveLength(1);
      // Verify point structure using InfluxDB 3.x Point API
      const point = result.probes[0];
      expect(point.getMeasurement()).toBe('apex_probe');
      expect(point.getTag('host')).toBe('TestApex');
      expect(point.getTag('name')).toBe('Temp');
      expect(point.getTag('probe_type')).toBe('Temp');
      expect(point.getFloatField('value')).toBe(78.5);
    });
  });

  describe('multiple records', () => {
    it('returns points only for the latest record', () => {
      // Create datalog with multiple records
      const datalog = createTestDatalog({
        records: [
          {
            date: '01/15/2026 12:00:00',
            probes: [{ name: 'Temp', type: 'Temp', value: 77.0 }],
          },
          {
            date: '01/15/2026 12:30:00',
            probes: [{ name: 'Temp', type: 'Temp', value: 78.5 }],
          },
        ],
      });

      // Map to points
      const result = mapDatalogToPoints(datalog);

      // Should have only one point from the latest record
      expect(result.probes).toHaveLength(1);
      // Value should be from latest record (using InfluxDB 3.x API)
      expect(result.probes[0].getFloatField('value')).toBe(78.5);
    });
  });

  describe('multiple probes in a record', () => {
    it('creates a point for each probe', () => {
      // Create datalog with one record containing multiple probes
      const datalog = createTestDatalog({
        records: [
          {
            date: '01/15/2026 12:30:00',
            probes: [
              { name: 'Temp', type: 'Temp', value: 78.5 },
              { name: 'pH', type: 'pH', value: 8.2 },
              { name: 'ORP', type: 'ORP', value: 350 },
            ],
          },
        ],
      });

      // Map to points
      const result = mapDatalogToPoints(datalog);

      // Should have three points
      expect(result.probes).toHaveLength(3);
      // Verify each probe is mapped (using InfluxDB 3.x API)
      expect(result.probes.map(p => p.getTag('name'))).toEqual(['Temp', 'pH', 'ORP']);
    });
  });

  describe('timestamp parsing', () => {
    it('parses date string and applies timezone offset', () => {
      // Create datalog with known date and timezone
      const datalog = createTestDatalog({
        timezone: -8, // Pacific time (UTC-8)
        records: [
          {
            date: '01/15/2026 12:00:00',
            probes: [{ name: 'Temp', type: 'Temp', value: 78.5 }],
          },
        ],
      });

      // Map to points
      const result = mapDatalogToPoints(datalog);

      // Get the timestamp from the point (using InfluxDB 3.x API)
      const timestamp = result.probes[0].getTimestamp() as Date;
      // Verify it's a Date object
      expect(timestamp).toBeInstanceOf(Date);
      // The date 01/15/2026 12:00:00 in UTC-8 should be 01/15/2026 20:00:00 UTC
      expect(timestamp.toISOString()).toBe('2026-01-15T20:00:00.000Z');
    });

    it('handles positive timezone offset', () => {
      // Create datalog with positive timezone (ahead of UTC)
      const datalog = createTestDatalog({
        timezone: 5, // UTC+5
        records: [
          {
            date: '01/15/2026 12:00:00',
            probes: [{ name: 'Temp', type: 'Temp', value: 78.5 }],
          },
        ],
      });

      // Map to points
      const result = mapDatalogToPoints(datalog);

      // Get the timestamp (using InfluxDB 3.x API)
      const timestamp = result.probes[0].getTimestamp() as Date;
      // The date 01/15/2026 12:00:00 in UTC+5 should be 01/15/2026 07:00:00 UTC
      expect(timestamp.toISOString()).toBe('2026-01-15T07:00:00.000Z');
    });

    it('handles zero timezone offset', () => {
      // Create datalog with UTC timezone
      const datalog = createTestDatalog({
        timezone: 0, // UTC
        records: [
          {
            date: '01/15/2026 12:00:00',
            probes: [{ name: 'Temp', type: 'Temp', value: 78.5 }],
          },
        ],
      });

      // Map to points
      const result = mapDatalogToPoints(datalog);

      // Get the timestamp (using InfluxDB 3.x API)
      const timestamp = result.probes[0].getTimestamp() as Date;
      // Time should remain as-is in UTC
      expect(timestamp.toISOString()).toBe('2026-01-15T12:00:00.000Z');
    });
  });

  describe('hostname tagging', () => {
    it('includes hostname in point tags', () => {
      // Create datalog with specific hostname
      const datalog = createTestDatalog({
        hostname: 'MyReefTank',
        records: [
          {
            date: '01/15/2026 12:00:00',
            probes: [{ name: 'Temp', type: 'Temp', value: 78.5 }],
          },
        ],
      });

      // Map to points
      const result = mapDatalogToPoints(datalog);

      // Verify hostname is in tags (using InfluxDB 3.x API)
      expect(result.probes[0].getTag('host')).toBe('MyReefTank');
    });
  });
});

describe('mapAllRecordsToPoints', () => {
  describe('empty records handling', () => {
    it('returns empty probes array when records is empty', () => {
      // Create datalog with no records
      const datalog = createTestDatalog({ records: [] });

      // Map all records to points
      const result = mapAllRecordsToPoints(datalog);

      // Should return empty array
      expect(result.probes).toEqual([]);
    });
  });

  describe('multiple records', () => {
    it('returns points for all records', () => {
      // Create datalog with multiple records
      const datalog = createTestDatalog({
        records: [
          {
            date: '01/15/2026 12:00:00',
            probes: [{ name: 'Temp', type: 'Temp', value: 77.0 }],
          },
          {
            date: '01/15/2026 12:30:00',
            probes: [{ name: 'Temp', type: 'Temp', value: 78.5 }],
          },
          {
            date: '01/15/2026 13:00:00',
            probes: [{ name: 'Temp', type: 'Temp', value: 79.0 }],
          },
        ],
      });

      // Map all records to points
      const result = mapAllRecordsToPoints(datalog);

      // Should have three points (one per record)
      expect(result.probes).toHaveLength(3);
      // Verify all values are present (using InfluxDB 3.x API)
      expect(result.probes.map(p => p.getFloatField('value'))).toEqual([77.0, 78.5, 79.0]);
    });
  });

  describe('multiple probes per record', () => {
    it('flattens all probes from all records', () => {
      // Create datalog with multiple records, each with multiple probes
      const datalog = createTestDatalog({
        records: [
          {
            date: '01/15/2026 12:00:00',
            probes: [
              { name: 'Temp', type: 'Temp', value: 77.0 },
              { name: 'pH', type: 'pH', value: 8.1 },
            ],
          },
          {
            date: '01/15/2026 12:30:00',
            probes: [
              { name: 'Temp', type: 'Temp', value: 78.5 },
              { name: 'pH', type: 'pH', value: 8.2 },
            ],
          },
        ],
      });

      // Map all records to points
      const result = mapAllRecordsToPoints(datalog);

      // Should have four points (2 probes × 2 records)
      expect(result.probes).toHaveLength(4);
    });
  });
});

// Helper to create a minimal valid outlog for testing
function createTestOutlog(overrides: Partial<ApexOutlog> = {}): ApexOutlog {
  return {
    software: '5.12_CA25',
    hardware: '1.0',
    hostname: 'TestApex',
    serial: 'AC5:12345',
    timezone: -8,
    records: [],
    ...overrides,
  };
}

describe('mapOutlogToPoints', () => {
  describe('empty records handling', () => {
    it('returns empty outlets array when records is empty', () => {
      // Create outlog with no records
      const outlog = createTestOutlog({ records: [] });

      // Map to points
      const result = mapOutlogToPoints(outlog);

      // Should return empty array
      expect(result.outlets).toEqual([]);
    });
  });

  describe('single record mapping', () => {
    it('returns point for the latest record only', () => {
      // Create outlog with multiple records
      const outlog = createTestOutlog({
        records: [
          { date: '02/03/2026 10:41:07', name: 'CalcRx', value: 'ON' },
          { date: '02/03/2026 10:42:00', name: 'TopOff', value: 'OFF' },
        ],
      });

      // Map to points (latest record only)
      const result = mapOutlogToPoints(outlog);

      // Should have only one point from the latest record
      expect(result.outlets).toHaveLength(1);
      expect(result.outlets[0].getTag('name')).toBe('TopOff');
    });
  });

  describe('ON/OFF state mapping', () => {
    it('maps ON to integer 1', () => {
      // Create outlog with ON state
      const outlog = createTestOutlog({
        records: [
          { date: '02/03/2026 10:41:07', name: 'CalcRx', value: 'ON' },
        ],
      });

      // Map to points
      const result = mapOutlogToPoints(outlog);

      // Verify ON maps to 1
      expect(result.outlets[0].getIntegerField('state')).toBe(1);
    });

    it('maps OFF to integer 0', () => {
      // Create outlog with OFF state
      const outlog = createTestOutlog({
        records: [
          { date: '02/03/2026 10:42:00', name: 'TopOff', value: 'OFF' },
        ],
      });

      // Map to points
      const result = mapOutlogToPoints(outlog);

      // Verify OFF maps to 0
      expect(result.outlets[0].getIntegerField('state')).toBe(0);
    });
  });

  describe('point structure', () => {
    it('uses apex_outlet measurement name', () => {
      // Create outlog with one record
      const outlog = createTestOutlog({
        records: [
          { date: '02/03/2026 10:41:07', name: 'CalcRx', value: 'ON' },
        ],
      });

      // Map to points
      const result = mapOutlogToPoints(outlog);

      // Verify measurement name
      expect(result.outlets[0].getMeasurement()).toBe('apex_outlet');
    });

    it('includes hostname and outlet name as tags', () => {
      // Create outlog with specific hostname
      const outlog = createTestOutlog({
        hostname: 'Diva',
        records: [
          { date: '02/03/2026 10:41:07', name: 'ATO_Cycler', value: 'ON' },
        ],
      });

      // Map to points
      const result = mapOutlogToPoints(outlog);

      // Verify tags
      expect(result.outlets[0].getTag('host')).toBe('Diva');
      expect(result.outlets[0].getTag('name')).toBe('ATO_Cycler');
    });
  });

  describe('timestamp parsing', () => {
    it('parses date string and applies timezone offset', () => {
      // Create outlog with known date and timezone
      const outlog = createTestOutlog({
        timezone: -8,
        records: [
          { date: '02/03/2026 12:00:00', name: 'CalcRx', value: 'ON' },
        ],
      });

      // Map to points
      const result = mapOutlogToPoints(outlog);

      // Get the timestamp from the point
      const timestamp = result.outlets[0].getTimestamp() as Date;
      // The date 02/03/2026 12:00:00 in UTC-8 should be 02/03/2026 20:00:00 UTC
      expect(timestamp.toISOString()).toBe('2026-02-03T20:00:00.000Z');
    });
  });
});

describe('mapAllOutlogToPoints', () => {
  describe('empty records handling', () => {
    it('returns empty outlets array when records is empty', () => {
      // Create outlog with no records
      const outlog = createTestOutlog({ records: [] });

      // Map all records to points
      const result = mapAllOutlogToPoints(outlog);

      // Should return empty array
      expect(result.outlets).toEqual([]);
    });
  });

  describe('multiple records', () => {
    it('returns points for all records', () => {
      // Create outlog with multiple records
      const outlog = createTestOutlog({
        records: [
          { date: '02/03/2026 10:41:07', name: 'CalcRx', value: 'ON' },
          { date: '02/03/2026 10:42:00', name: 'TopOff', value: 'OFF' },
          { date: '02/03/2026 10:43:05', name: 'ATO_Cycler', value: 'ON' },
        ],
      });

      // Map all records to points
      const result = mapAllOutlogToPoints(outlog);

      // Should have three points (one per record)
      expect(result.outlets).toHaveLength(3);
      // Verify all outlet names are present
      expect(result.outlets.map(p => p.getTag('name'))).toEqual(['CalcRx', 'TopOff', 'ATO_Cycler']);
      // Verify state values
      expect(result.outlets.map(p => p.getIntegerField('state'))).toEqual([1, 0, 1]);
    });
  });
});

// Helper to create a minimal valid ApexStatus for testing
function createTestStatus(overrides: Partial<ApexStatus> = {}): ApexStatus {
  return {
    hostname: 'TestApex',
    software: '5.12_CA25',
    hardware: '1.0',
    serial: 'AC5:12345',
    type: 'AC5',
    inputs: [],
    outputs: [],
    ...overrides,
  };
}

describe('mapStatusToOutletPoints', () => {
  describe('empty outputs handling', () => {
    it('returns empty outlets array when outputs is empty', () => {
      // Create status with no outputs
      const status = createTestStatus({ outputs: [] });
      // Map to points
      const result = mapStatusToOutletPoints(status, new Date());
      // No outputs means no points written to InfluxDB
      expect(result.outlets).toEqual([]);
    });
  });

  describe('point count', () => {
    it('returns one point per output', () => {
      // Create status with three outputs of different types
      const status = createTestStatus({
        outputs: [
          { status: ['ON', '', 'OK', ''], name: 'Sump', gid: '', type: 'outlet', ID: 8, did: '2_1' },
          { status: ['AOF', '', 'OK', ''], name: 'TopOff', gid: '', type: '24v', ID: 22, did: '6_1' },
          { status: ['TBL', '', 'OK', ''], name: 'T5_InnerActi', gid: '', type: 'variable', ID: 2, did: 'base_Var3' },
        ],
      });
      // Map to points
      const result = mapStatusToOutletPoints(status, new Date());
      // Every output must produce exactly one point regardless of type
      expect(result.outlets).toHaveLength(3);
    });
  });

  describe('measurement name', () => {
    it('uses apex_outlet measurement name', () => {
      // Create status with one output
      const status = createTestStatus({
        outputs: [
          { status: ['ON', '', 'OK', ''], name: 'Sump', gid: '', type: 'outlet', ID: 8, did: '2_1' },
        ],
      });
      // Map to points
      const result = mapStatusToOutletPoints(status, new Date());
      // Must share measurement name with outlog so existing Grafana dashboards keep working
      expect(result.outlets[0].getMeasurement()).toBe('apex_outlet');
    });
  });

  describe('tags', () => {
    it('includes hostname as host tag', () => {
      // Create status with a known hostname
      const status = createTestStatus({
        hostname: 'Diva',
        outputs: [
          { status: ['ON', '', 'OK', ''], name: 'Sump', gid: '', type: 'outlet', ID: 8, did: '2_1' },
        ],
      });
      // Map to points
      const result = mapStatusToOutletPoints(status, new Date());
      // Host tag must match the Apex hostname
      expect(result.outlets[0].getTag('host')).toBe('Diva');
    });

    it('includes output name as name tag', () => {
      // Create status with a named output
      const status = createTestStatus({
        outputs: [
          { status: ['ON', '', 'OK', ''], name: 'Sump', gid: '', type: 'outlet', ID: 8, did: '2_1' },
        ],
      });
      // Map to points
      const result = mapStatusToOutletPoints(status, new Date());
      // Name tag must match the output name for Grafana filtering
      expect(result.outlets[0].getTag('name')).toBe('Sump');
    });

    it('includes output type as type tag', () => {
      // Create status with a typed output
      const status = createTestStatus({
        outputs: [
          { status: ['ON', '', 'OK', ''], name: 'Sump', gid: '', type: 'outlet', ID: 8, did: '2_1' },
        ],
      });
      // Map to points
      const result = mapStatusToOutletPoints(status, new Date());
      // Type tag enables Grafana filtering by output type (e.g. type = 'outlet')
      expect(result.outlets[0].getTag('type')).toBe('outlet');
    });

    it('preserves composite type strings without modification', () => {
      // Vortech pumps have a pipe-separated composite type string
      const status = createTestStatus({
        outputs: [
          { status: ['AON', '', 'Cnst', 'OK'], name: 'Vortech_5_1', gid: '0', type: 'MXMPump|Ecotech|Vortech', ID: 21, did: '5_1' },
        ],
      });
      // Map to points
      const result = mapStatusToOutletPoints(status, new Date());
      // Composite type must be stored as-is — no splitting or transformation
      expect(result.outlets[0].getTag('type')).toBe('MXMPump|Ecotech|Vortech');
    });
  });

  describe('state mapping', () => {
    it('maps ON to integer 1', () => {
      // Manually-on outlet
      const status = createTestStatus({
        outputs: [{ status: ['ON', '', 'OK', ''], name: 'Sump', gid: '', type: 'outlet', ID: 8, did: '2_1' }],
      });
      // Map to points
      const result = mapStatusToOutletPoints(status, new Date());
      // ON must map to 1 (outlet is physically running)
      expect(result.outlets[0].getIntegerField('state')).toBe(1);
    });

    it('maps AON to integer 1', () => {
      // Auto-mode on outlet
      const status = createTestStatus({
        outputs: [{ status: ['AON', '', 'OK', ''], name: 'TopOff', gid: '', type: '24v', ID: 22, did: '6_1' }],
      });
      // Map to points
      const result = mapStatusToOutletPoints(status, new Date());
      // AON must also map to 1 (outlet is running in auto mode)
      expect(result.outlets[0].getIntegerField('state')).toBe(1);
    });

    it('maps OFF to integer 0', () => {
      // Manually-off outlet
      const status = createTestStatus({
        outputs: [{ status: ['OFF', '', 'OK', ''], name: 'CalCo2', gid: '', type: 'outlet', ID: 12, did: '2_5' }],
      });
      // Map to points
      const result = mapStatusToOutletPoints(status, new Date());
      // OFF must map to 0
      expect(result.outlets[0].getIntegerField('state')).toBe(0);
    });

    it('maps AOF to integer 0', () => {
      // Auto-mode off outlet
      const status = createTestStatus({
        outputs: [{ status: ['AOF', '', 'OK', ''], name: 'T5lights', gid: '', type: 'outlet', ID: 9, did: '2_2' }],
      });
      // Map to points
      const result = mapStatusToOutletPoints(status, new Date());
      // AOF must map to 0 (outlet is off in auto mode)
      expect(result.outlets[0].getIntegerField('state')).toBe(0);
    });

    it('maps TBL to integer 0', () => {
      // Table-controlled output — physical state cannot be determined from TBL alone
      const status = createTestStatus({
        outputs: [{ status: ['TBL', '', 'OK', ''], name: 'T5_InnerActi', gid: '', type: 'variable', ID: 2, did: 'base_Var3' }],
      });
      // Map to points
      const result = mapStatusToOutletPoints(status, new Date());
      // TBL maps to 0 (conservative — no confirmed on-state)
      expect(result.outlets[0].getIntegerField('state')).toBe(0);
    });
  });

  describe('timestamp', () => {
    it('uses the provided timestamp on the first point', () => {
      // Fixed timestamp for deterministic testing
      const fixedTime = new Date('2026-02-23T10:00:00.000Z');
      const status = createTestStatus({
        outputs: [
          { status: ['ON', '', 'OK', ''], name: 'Sump', gid: '', type: 'outlet', ID: 8, did: '2_1' },
          { status: ['OFF', '', 'OK', ''], name: 'Heater', gid: '', type: 'outlet', ID: 11, did: '2_4' },
        ],
      });
      // Map to points
      const result = mapStatusToOutletPoints(status, fixedTime);
      // First point must carry the poll timestamp
      expect((result.outlets[0].getTimestamp() as Date).toISOString()).toBe('2026-02-23T10:00:00.000Z');
    });

    it('uses the same timestamp for every output in the snapshot', () => {
      // Fixed timestamp for deterministic testing
      const fixedTime = new Date('2026-02-23T10:00:00.000Z');
      const status = createTestStatus({
        outputs: [
          { status: ['ON', '', 'OK', ''], name: 'Sump', gid: '', type: 'outlet', ID: 8, did: '2_1' },
          { status: ['OFF', '', 'OK', ''], name: 'Heater', gid: '', type: 'outlet', ID: 11, did: '2_4' },
        ],
      });
      // Map to points
      const result = mapStatusToOutletPoints(status, fixedTime);
      // Second point must share the same poll epoch as the first
      expect((result.outlets[1].getTimestamp() as Date).toISOString()).toBe('2026-02-23T10:00:00.000Z');
    });
  });
});
