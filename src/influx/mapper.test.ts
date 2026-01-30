// Tests for the InfluxDB mapper module
import { describe, it, expect } from 'vitest';
// Import functions under test
import { mapDatalogToPoints, mapAllRecordsToPoints } from './mapper.js';
// Import types for test data
import type { ApexDatalog } from '../apex/types.js';

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
      // Verify point structure
      expect(result.probes[0]).toMatchObject({
        measurement: 'apex_probe',
        tags: {
          host: 'TestApex',
          name: 'Temp',
          probe_type: 'Temp',
        },
        fields: {
          value: 78.5,
        },
      });
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
      // Value should be from latest record
      expect(result.probes[0]!.fields!.value).toBe(78.5);
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
      // Verify each probe is mapped
      expect(result.probes.map(p => p.tags!.name)).toEqual(['Temp', 'pH', 'ORP']);
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

      // Get the timestamp from the point
      const timestamp = result.probes[0].timestamp as Date;
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

      // Get the timestamp
      const timestamp = result.probes[0].timestamp as Date;
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

      // Get the timestamp
      const timestamp = result.probes[0].timestamp as Date;
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

      // Verify hostname is in tags
      expect(result.probes[0]!.tags!.host).toBe('MyReefTank');
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
      // Verify all values are present
      expect(result.probes.map(p => p.fields!.value)).toEqual([77.0, 78.5, 79.0]);
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
