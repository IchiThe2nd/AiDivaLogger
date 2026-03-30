// Tests for the Reefmat client module
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Import the client class under test
import { ReefmatClient } from './client.js';
// Import the dashboard type for constructing test fixtures
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

// Mock global fetch so no real HTTP calls are made during tests
const mockFetch = vi.fn();

// Install/restore the fetch mock around each test
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

// Helper: make fetch resolve with a JSON body and a given HTTP status
function mockFetchResponse(body: unknown, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
  });
}

// ---- Interface: public API shape ----

describe('ReefmatClient', () => {
  describe('getDashboard — zero / empty state', () => {
    // Z — Zero: confirm the client can be constructed without throwing
    it('constructs without error', () => {
      expect(() => new ReefmatClient({ host: '192.168.1.27' })).not.toThrow();
    });
  });

  // I — Interface: verify the correct URL is called
  describe('getDashboard — request', () => {
    it('calls /dashboard on the configured host', async () => {
      // Arrange
      mockFetchResponse(createDashboard());
      const client = new ReefmatClient({ host: '192.168.1.27' });

      // Act
      await client.getDashboard();

      // Assert: fetch was called with the expected URL
      expect(mockFetch).toHaveBeenCalledWith('http://192.168.1.27/dashboard');
    });
  });

  // O — One: verify a single successful response is parsed correctly
  describe('getDashboard — single successful response', () => {
    it('returns parsed dashboard data', async () => {
      // Arrange: configure fetch to return a known dashboard state
      const fixture = createDashboard({ roll_level: 'running_low', days_till_end_of_roll: 3 });
      mockFetchResponse(fixture);
      const client = new ReefmatClient({ host: '192.168.1.27' });

      // Act
      const result = await client.getDashboard();

      // Assert: returned data matches the fixture
      expect(result.roll_level).toBe('running_low');
      expect(result.days_till_end_of_roll).toBe(3);
    });

    it('returns EC sensor readings', async () => {
      // Arrange
      const fixture = createDashboard({ internal_ec_average: 11, external_ec_average: 2 });
      mockFetchResponse(fixture);
      const client = new ReefmatClient({ host: '192.168.1.27' });

      // Act
      const result = await client.getDashboard();

      // Assert
      expect(result.internal_ec_average).toBe(11);
      expect(result.external_ec_average).toBe(2);
    });

    it('returns material information', async () => {
      // Arrange
      mockFetchResponse(createDashboard());
      const client = new ReefmatClient({ host: '192.168.1.27' });

      // Act
      const result = await client.getDashboard();

      // Assert
      expect(result.material.name).toBe('28 Meter');
      expect(result.material.thickness).toBe(0.0237);
    });
  });

  // E — Exercise exceptional behavior: HTTP errors and bad responses
  describe('getDashboard — error handling', () => {
    it('throws when the HTTP response is not ok', async () => {
      // Arrange: simulate a 500 server error
      mockFetchResponse({}, 500);
      const client = new ReefmatClient({ host: '192.168.1.27' });

      // Act & Assert
      await expect(client.getDashboard()).rejects.toThrow('Reefmat request failed: 500');
    });

    it('throws when the response body is null', async () => {
      // Arrange: simulate a null response body
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => null,
      });
      const client = new ReefmatClient({ host: '192.168.1.27' });

      // Act & Assert
      await expect(client.getDashboard()).rejects.toThrow('empty or invalid');
    });

    it('throws when fetch itself rejects (network error)', async () => {
      // Arrange: simulate a network-level failure
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const client = new ReefmatClient({ host: '192.168.1.27' });

      // Act & Assert
      await expect(client.getDashboard()).rejects.toThrow('ECONNREFUSED');
    });
  });

  // M — Many: multiple sequential calls each return their own independent response
  describe('getDashboard — multiple calls', () => {
    it('returns independent results for each call', async () => {
      // Arrange: queue two different responses
      mockFetchResponse(createDashboard({ days_till_end_of_roll: 10 }));
      mockFetchResponse(createDashboard({ days_till_end_of_roll: 9 }));
      const client = new ReefmatClient({ host: '192.168.1.27' });

      // Act: call getDashboard twice
      const first = await client.getDashboard();
      const second = await client.getDashboard();

      // Assert: each call returns its own response, fetch was called twice
      expect(first.days_till_end_of_roll).toBe(10);
      expect(second.days_till_end_of_roll).toBe(9);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  // B — Boundary: non-default host (e.g. hostname instead of IP)
  describe('getDashboard — host boundary', () => {
    it('uses the configured hostname in the request URL', async () => {
      // Arrange
      mockFetchResponse(createDashboard());
      const client = new ReefmatClient({ host: 'reefmat.local' });

      // Act
      await client.getDashboard();

      // Assert: URL uses the custom hostname
      expect(mockFetch).toHaveBeenCalledWith('http://reefmat.local/dashboard');
    });
  });
});
