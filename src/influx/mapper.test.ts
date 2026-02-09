// Tests for the InfluxDB mapper module
import { describe, it, expect } from 'vitest';
// Import functions under test
import { mapDatalogToPoints, mapAllRecordsToPoints, mapOutlogToPoints, mapAllOutlogToPoints } from './mapper.js';
// Import types for test data
import type { ApexDatalog, ApexOutlog } from '../apex/types.js';

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
