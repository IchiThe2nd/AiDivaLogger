// Tests for the InfluxDB client module
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Track mock calls and configure behavior
let mockGetDatabaseNames: ReturnType<typeof vi.fn>;
let mockCreateDatabase: ReturnType<typeof vi.fn>;
let mockConstructorConfig: unknown;

// Mock the influx module before importing the client
vi.mock('influx', () => {
  // Create mock class that tracks instantiation
  class MockInfluxDB {
    // Store the config passed to constructor
    constructor(config: unknown) {
      mockConstructorConfig = config;
    }
    // Mock methods
    getDatabaseNames = () => mockGetDatabaseNames();
    createDatabase = (name: string) => mockCreateDatabase(name);
  }

  return {
    default: {
      InfluxDB: MockInfluxDB,
      FieldType: {
        FLOAT: 'float',
      },
    },
  };
});

// Import the function under test after mocking
import { createInfluxClient } from './client.js';

describe('createInfluxClient', () => {
  // Reset mocks before each test
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock functions with default behavior
    mockGetDatabaseNames = vi.fn().mockResolvedValue([]);
    mockCreateDatabase = vi.fn().mockResolvedValue(undefined);
    mockConstructorConfig = null;
  });

  describe('database creation', () => {
    it('creates database when it does not exist', async () => {
      // Configure mock to return empty database list
      mockGetDatabaseNames = vi.fn().mockResolvedValue(['other_db']);

      // Spy on console.log
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Create client with new database
      await createInfluxClient({
        host: 'localhost',
        port: 8086,
        database: 'aquarium',
      });

      // Verify database was created
      expect(mockCreateDatabase).toHaveBeenCalledWith('aquarium');
      expect(consoleSpy).toHaveBeenCalledWith('Creating database: aquarium');

      // Cleanup
      consoleSpy.mockRestore();
    });

    it('does not create database when it already exists', async () => {
      // Configure mock to return database in list
      mockGetDatabaseNames = vi.fn().mockResolvedValue(['aquarium', 'other_db']);

      // Create client with existing database
      await createInfluxClient({
        host: 'localhost',
        port: 8086,
        database: 'aquarium',
      });

      // Verify database was not created
      expect(mockCreateDatabase).not.toHaveBeenCalled();
    });
  });

  describe('client configuration', () => {
    it('passes correct configuration to InfluxDB constructor', async () => {
      // Create client with full configuration
      await createInfluxClient({
        host: 'influxdb.local',
        port: 9999,
        database: 'mydb',
        username: 'admin',
        password: 'secret',
      });

      // Verify constructor was called with correct config
      expect(mockConstructorConfig).toMatchObject({
        host: 'influxdb.local',
        port: 9999,
        database: 'mydb',
        username: 'admin',
        password: 'secret',
      });
    });

    it('includes schema in configuration', async () => {
      // Create client
      await createInfluxClient({
        host: 'localhost',
        port: 8086,
        database: 'aquarium',
      });

      // Verify schema was included
      expect(mockConstructorConfig).toMatchObject({
        schema: expect.arrayContaining([
          expect.objectContaining({
            measurement: 'apex_probe',
            tags: ['host', 'name', 'probe_type'],
          }),
        ]),
      });
    });
  });

  describe('return value', () => {
    it('returns the InfluxDB client instance', async () => {
      // Create client
      const result = await createInfluxClient({
        host: 'localhost',
        port: 8086,
        database: 'aquarium',
      });

      // Verify returned instance has expected methods
      expect(result).toHaveProperty('getDatabaseNames');
      expect(result).toHaveProperty('createDatabase');
    });
  });

  describe('error handling', () => {
    it('propagates getDatabaseNames errors', async () => {
      // Configure mock to throw error
      mockGetDatabaseNames = vi.fn().mockRejectedValue(new Error('Connection refused'));

      // Expect error to be thrown
      await expect(
        createInfluxClient({
          host: 'localhost',
          port: 8086,
          database: 'aquarium',
        })
      ).rejects.toThrow('Connection refused');
    });

    it('propagates createDatabase errors', async () => {
      // Configure mock to throw error on create
      mockGetDatabaseNames = vi.fn().mockResolvedValue([]);
      mockCreateDatabase = vi.fn().mockRejectedValue(new Error('Permission denied'));

      // Expect error to be thrown
      await expect(
        createInfluxClient({
          host: 'localhost',
          port: 8086,
          database: 'aquarium',
        })
      ).rejects.toThrow('Permission denied');
    });
  });
});
