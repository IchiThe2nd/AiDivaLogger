// Tests for configuration module
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dotenv to prevent loading real .env file during tests
vi.mock('dotenv/config', () => ({}));

// Store original env to restore after tests
const originalEnv = process.env;

describe('config module', () => {
  // Reset modules and env before each test
  beforeEach(() => {
    // Reset module cache to re-evaluate config on each import
    vi.resetModules();
    // Create clean env object (don't inherit from original)
    process.env = {};
  });

  // Restore original env after each test
  afterEach(() => {
    process.env = originalEnv;
  });

  describe('requireEnv behavior', () => {
    it('throws error when APEX_HOST is missing', async () => {
      // Ensure APEX_HOST is not in environment
      delete process.env.APEX_HOST;

      // Import should throw because APEX_HOST is required
      await expect(import('./config.js')).rejects.toThrow(
        'Missing required environment variable: APEX_HOST'
      );
    });

    it('succeeds when APEX_HOST is provided', async () => {
      // Set required environment variable
      process.env.APEX_HOST = '192.168.1.100';

      // Import should succeed
      const { config } = await import('./config.js');

      // Verify the host was set correctly
      expect(config.apex.host).toBe('192.168.1.100');
    });
  });

  describe('optionalEnv behavior', () => {
    it('returns undefined for missing optional values', async () => {
      // Set only required env var
      process.env.APEX_HOST = '192.168.1.100';

      // Import config
      const { config } = await import('./config.js');

      // Optional values should be undefined
      expect(config.apex.username).toBeUndefined();
      expect(config.apex.password).toBeUndefined();
    });

    it('returns value when optional env is set', async () => {
      // Set required and optional env vars
      process.env.APEX_HOST = '192.168.1.100';
      process.env.APEX_USERNAME = 'admin';
      process.env.APEX_PASSWORD = 'secret';

      // Import config
      const { config } = await import('./config.js');

      // Optional values should be populated
      expect(config.apex.username).toBe('admin');
      expect(config.apex.password).toBe('secret');
    });

    it('returns undefined when optional env is empty string', async () => {
      // Set required env var and empty optional
      process.env.APEX_HOST = '192.168.1.100';
      process.env.APEX_USERNAME = '';

      // Import config
      const { config } = await import('./config.js');

      // Empty string should become undefined
      expect(config.apex.username).toBeUndefined();
    });
  });

  describe('influx defaults', () => {
    it('uses default values when env vars not set', async () => {
      // Set only required env var
      process.env.APEX_HOST = '192.168.1.100';

      // Import config
      const { config } = await import('./config.js');

      // Verify defaults are applied
      expect(config.influx.host).toBe('localhost');
      expect(config.influx.port).toBe(8086);
      expect(config.influx.database).toBe('aquarium');
    });

    it('uses custom values when env vars are set', async () => {
      // Set all env vars
      process.env.APEX_HOST = '192.168.1.100';
      process.env.INFLUX_HOST = 'influxdb.local';
      process.env.INFLUX_PORT = '9999';
      process.env.INFLUX_DATABASE = 'mydb';

      // Import config
      const { config } = await import('./config.js');

      // Verify custom values are used
      expect(config.influx.host).toBe('influxdb.local');
      expect(config.influx.port).toBe(9999);
      expect(config.influx.database).toBe('mydb');
    });

    it('parses INFLUX_PORT as integer', async () => {
      // Set env vars with port as string
      process.env.APEX_HOST = '192.168.1.100';
      process.env.INFLUX_PORT = '1234';

      // Import config
      const { config } = await import('./config.js');

      // Verify port is a number
      expect(typeof config.influx.port).toBe('number');
      expect(config.influx.port).toBe(1234);
    });
  });

  describe('pollInterval', () => {
    it('defaults to every 5 minutes', async () => {
      // Set only required env var
      process.env.APEX_HOST = '192.168.1.100';

      // Import config
      const { config } = await import('./config.js');

      // Verify default cron expression
      expect(config.pollInterval).toBe('*/5 * * * *');
    });

    it('uses custom poll interval when set', async () => {
      // Set env vars including custom interval
      process.env.APEX_HOST = '192.168.1.100';
      process.env.POLL_INTERVAL = '*/1 * * * *';

      // Import config
      const { config } = await import('./config.js');

      // Verify custom cron expression
      expect(config.pollInterval).toBe('*/1 * * * *');
    });
  });
});
