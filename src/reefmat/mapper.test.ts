// Tests for the Reefmat mapper module
import { describe, it, expect } from 'vitest';
// Import functions under test
import { mapDashboardToPoints, rollLevelToInt } from './mapper.js';
// Import the dashboard type for building test fixtures
import type { ReefmatDashboard } from './types.js';

// Minimal valid dashboard fixture — used as the base for all tests
function createDashboard(overrides: Partial<ReefmatDashboard> = {}): ReefmatDashboard {
  return {
    mode: 'auto',
    is_internet_connected: true,
    is_ec_sensor_connected: true,
    unclean_sensor: false,
    auto_advance: true,
    is_advancing: false,
    last_advance_cause: 'ec_sensor',
    roll_level: 'ok',
    days_till_end_of_roll: 14,
    internal_ec_average: 5,
    external_ec_average: 0,
    setup_date: '2025-01-19T20:20:07Z',
    cumulative_steps: 100,
    device_setup_date: 1735294423,
    lifetime_steps: 500,
    today_usage: 10.0,
    daily_average_usage: 12.0,
    total_usage: 500.0,
    remaining_length: 2000.0,
    material: {
      name: '28 Meter',
      external_diameter: 10.1,
      thickness: 0.0237,
      is_partial: false,
    },
    ...overrides,
  };
}

// Fixed timestamp used across all tests for deterministic assertions
const TEST_TIMESTAMP = new Date('2026-01-15T12:00:00Z');

// ---- rollLevelToInt ----

describe('rollLevelToInt', () => {
  // Z — Zero / empty: unknown string returns sentinel -1
  it('returns -1 for an unknown roll level', () => {
    expect(rollLevelToInt('')).toBe(-1);
    expect(rollLevelToInt('unknown')).toBe(-1);
  });

  // O — One: each known level maps to the correct integer
  it('maps "ok" to 2', () => {
    expect(rollLevelToInt('ok')).toBe(2);
  });

  it('maps "running_low" to 1', () => {
    expect(rollLevelToInt('running_low')).toBe(1);
  });

  it('maps "empty" to 0', () => {
    expect(rollLevelToInt('empty')).toBe(0);
  });

  // M — Many: all known levels produce distinct values (no collisions)
  it('produces distinct values for all known levels', () => {
    const values = ['ok', 'running_low', 'empty'].map(rollLevelToInt);
    // Convert to a Set — duplicates would reduce the size
    expect(new Set(values).size).toBe(3);
  });

  // B — Boundary: case-sensitivity — "OK" is not the same as "ok"
  it('is case-sensitive (uppercase is unknown)', () => {
    expect(rollLevelToInt('OK')).toBe(-1);
  });
});

// ---- mapDashboardToPoints ----

describe('mapDashboardToPoints', () => {
  // Z — Zero: empty / minimal dashboard still produces exactly 2 points
  describe('zero / minimal state', () => {
    it('always returns exactly 2 points', () => {
      const result = mapDashboardToPoints(createDashboard(), 'reefmat', TEST_TIMESTAMP);
      expect(result.points).toHaveLength(2);
    });
  });

  // I — Interface: correct measurement names
  describe('measurement names', () => {
    it('first point uses reefmat_status measurement', () => {
      const result = mapDashboardToPoints(createDashboard(), 'reefmat', TEST_TIMESTAMP);
      expect(result.points[0].getMeasurement()).toBe('reefmat_status');
    });

    it('second point uses reefmat_usage measurement', () => {
      const result = mapDashboardToPoints(createDashboard(), 'reefmat', TEST_TIMESTAMP);
      expect(result.points[1].getMeasurement()).toBe('reefmat_usage');
    });
  });

  // O — One: verify each individual field on the status point
  describe('reefmat_status fields', () => {
    it('sets host tag', () => {
      const result = mapDashboardToPoints(createDashboard(), 'myreefmat', TEST_TIMESTAMP);
      expect(result.points[0].getTag('host')).toBe('myreefmat');
    });

    it('sets mode tag', () => {
      const result = mapDashboardToPoints(createDashboard({ mode: 'manual' }), 'r', TEST_TIMESTAMP);
      expect(result.points[0].getTag('mode')).toBe('manual');
    });

    it('sets roll_level integer field', () => {
      const result = mapDashboardToPoints(createDashboard({ roll_level: 'running_low' }), 'r', TEST_TIMESTAMP);
      expect(result.points[0].getIntegerField('roll_level')).toBe(1);
    });

    it('sets days_till_end_of_roll field', () => {
      const result = mapDashboardToPoints(createDashboard({ days_till_end_of_roll: 3 }), 'r', TEST_TIMESTAMP);
      expect(result.points[0].getIntegerField('days_till_end_of_roll')).toBe(3);
    });

    it('sets internal_ec field', () => {
      const result = mapDashboardToPoints(createDashboard({ internal_ec_average: 11 }), 'r', TEST_TIMESTAMP);
      expect(result.points[0].getFloatField('internal_ec')).toBe(11);
    });

    it('sets external_ec field', () => {
      const result = mapDashboardToPoints(createDashboard({ external_ec_average: 4 }), 'r', TEST_TIMESTAMP);
      expect(result.points[0].getFloatField('external_ec')).toBe(4);
    });

    it('maps is_advancing true to 1', () => {
      const result = mapDashboardToPoints(createDashboard({ is_advancing: true }), 'r', TEST_TIMESTAMP);
      expect(result.points[0].getIntegerField('is_advancing')).toBe(1);
    });

    it('maps is_advancing false to 0', () => {
      const result = mapDashboardToPoints(createDashboard({ is_advancing: false }), 'r', TEST_TIMESTAMP);
      expect(result.points[0].getIntegerField('is_advancing')).toBe(0);
    });

    it('maps ec_sensor_connected true to 1', () => {
      const result = mapDashboardToPoints(createDashboard({ is_ec_sensor_connected: true }), 'r', TEST_TIMESTAMP);
      expect(result.points[0].getIntegerField('ec_sensor_connected')).toBe(1);
    });

    it('maps unclean_sensor true to 1', () => {
      const result = mapDashboardToPoints(createDashboard({ unclean_sensor: true }), 'r', TEST_TIMESTAMP);
      expect(result.points[0].getIntegerField('unclean_sensor')).toBe(1);
    });
  });

  // O — One: verify each individual field on the usage point
  describe('reefmat_usage fields', () => {
    it('sets host tag', () => {
      const result = mapDashboardToPoints(createDashboard(), 'myreefmat', TEST_TIMESTAMP);
      expect(result.points[1].getTag('host')).toBe('myreefmat');
    });

    it('sets material tag from material name', () => {
      const result = mapDashboardToPoints(createDashboard(), 'r', TEST_TIMESTAMP);
      expect(result.points[1].getTag('material')).toBe('28 Meter');
    });

    it('sets today_usage_mm field', () => {
      const result = mapDashboardToPoints(createDashboard({ today_usage: 319.5 }), 'r', TEST_TIMESTAMP);
      expect(result.points[1].getFloatField('today_usage_mm')).toBe(319.5);
    });

    it('sets daily_average_mm field', () => {
      const result = mapDashboardToPoints(createDashboard({ daily_average_usage: 317.2 }), 'r', TEST_TIMESTAMP);
      expect(result.points[1].getFloatField('daily_average_mm')).toBe(317.2);
    });

    it('sets total_usage_mm field', () => {
      const result = mapDashboardToPoints(createDashboard({ total_usage: 1686.4 }), 'r', TEST_TIMESTAMP);
      expect(result.points[1].getFloatField('total_usage_mm')).toBe(1686.4);
    });

    it('sets remaining_length_mm field', () => {
      const result = mapDashboardToPoints(createDashboard({ remaining_length: 1113.5 }), 'r', TEST_TIMESTAMP);
      expect(result.points[1].getFloatField('remaining_length_mm')).toBe(1113.5);
    });

    it('sets cumulative_steps field', () => {
      const result = mapDashboardToPoints(createDashboard({ cumulative_steps: 5597 }), 'r', TEST_TIMESTAMP);
      expect(result.points[1].getIntegerField('cumulative_steps')).toBe(5597);
    });
  });

  // M — Many: mapping multiple dashboards produces independent point sets
  describe('many dashboards', () => {
    it('produces independent point sets for different dashboard snapshots', () => {
      // Arrange: two dashboards with different days_till_end_of_roll
      const dashboards = [
        createDashboard({ days_till_end_of_roll: 10 }),
        createDashboard({ days_till_end_of_roll: 9 }),
        createDashboard({ days_till_end_of_roll: 8 }),
      ];

      // Act: map all three
      const results = dashboards.map((d) => mapDashboardToPoints(d, 'r', TEST_TIMESTAMP));

      // Assert: each result has 2 points and the field values differ
      results.forEach((r) => expect(r.points).toHaveLength(2));
      expect(results[0].points[0].getIntegerField('days_till_end_of_roll')).toBe(10);
      expect(results[1].points[0].getIntegerField('days_till_end_of_roll')).toBe(9);
      expect(results[2].points[0].getIntegerField('days_till_end_of_roll')).toBe(8);
    });
  });

  // B — Boundary: zero usage values (brand-new roll)
  describe('boundary — zero usage values', () => {
    it('maps zero usage fields without error', () => {
      const dashboard = createDashboard({
        today_usage: 0,
        total_usage: 0,
        cumulative_steps: 0,
        days_till_end_of_roll: 0,
      });
      const result = mapDashboardToPoints(dashboard, 'r', TEST_TIMESTAMP);
      expect(result.points[1].getFloatField('today_usage_mm')).toBe(0);
      expect(result.points[1].getFloatField('total_usage_mm')).toBe(0);
      expect(result.points[0].getIntegerField('days_till_end_of_roll')).toBe(0);
    });
  });

  // E — Exceptional: unknown roll_level stored as -1
  describe('exceptional — unknown roll_level', () => {
    it('stores -1 for an unrecognised roll_level string', () => {
      const result = mapDashboardToPoints(createDashboard({ roll_level: 'mystery' }), 'r', TEST_TIMESTAMP);
      expect(result.points[0].getIntegerField('roll_level')).toBe(-1);
    });
  });
});
