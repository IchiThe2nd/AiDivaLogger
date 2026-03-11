// Tests for exported utility functions in index.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Hoisted mocks ---
// vi.hoisted() ensures these values exist before vi.mock() factory functions run
// Best practice: always use vi.hoisted() when mock factories need to close over variables

const mockConfig = vi.hoisted(() => ({
  // Use chunk=lookback so each chunk query makes exactly one DB call — simplifies test assertions
  queryChunkDays: 14,
  queryLookbackDays: 14,
  forceFullSync: false,
  apex: { host: 'test-apex' },
  influx: { url: 'http://localhost:8181', database: 'test' },
  pollInterval: '*/5 * * * *',
  backfillDays: 7,
}));

// Mock config to avoid requiring real environment variables (APEX_HOST etc.)
vi.mock('./config.js', () => ({ config: mockConfig }));

// Mock node-cron to prevent real task scheduling during tests
vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));

// Mock mapper functions — isolates index.ts logic from data transformation details
vi.mock('./influx/mapper.js', () => ({
  mapDatalogToPoints: vi.fn().mockReturnValue({ probes: [] }),
  mapAllRecordsToPoints: vi.fn().mockReturnValue({ probes: [] }),
  mapStatusToOutletPoints: vi.fn().mockReturnValue({ outlets: [] }),
  mapStatusToInputPoints: vi.fn().mockReturnValue({ inputs: [] }),
  mapStatusToAlertPoints: vi.fn().mockReturnValue({ alerts: [] }),
  mapAllOutlogToPoints: vi.fn().mockReturnValue({ outlets: [] }),
}));

// Mock ApexClient to prevent real HTTP requests to the Apex controller
vi.mock('./apex/client.js', () => ({ ApexClient: vi.fn() }));

// Mock InfluxDB client factory to prevent real database connections
vi.mock('./influx/client.js', () => ({
  createInfluxClient: vi.fn(),
  InfluxClient: vi.fn(),
}));

// Import functions under test — must come after vi.mock() calls
import {
  parseApexDate,
  formatDuration,
  isFileLimitError,
  queryNewestInChunks,
  queryOldestInChunks,
  getOldestDbTime,
  writeBatched,
  backfillRecentGaps,
  checkDatabaseFreshness,
} from './index.js';

// Import mocked mapper functions so tests can control their return values
import {
  mapAllRecordsToPoints,
  mapAllOutlogToPoints,
} from './influx/mapper.js';

import type { InfluxClient } from './influx/client.js';
import type { ApexDatalog, ApexOutlog, DataCoverageResult } from './apex/types.js';

// --- Helpers ---

// Creates a mock InfluxClient whose query() returns each provided result in sequence
// Best practice: factory functions avoid repeating mock setup in every test
function createMockInflux(queryResults: Array<{ time: string }[]> = []): InfluxClient {
  // Build query mock that returns queued results one by one, then empty array
  const queryMock = vi.fn();
  for (const result of queryResults) {
    queryMock.mockResolvedValueOnce(result);
  }
  // Default fallback when all queued results are exhausted
  queryMock.mockResolvedValue([]);
  return {
    query: queryMock,
    writePoints: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as InfluxClient;
}

// Creates a minimal valid ApexDatalog for use in tests
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

// Creates a minimal valid ApexOutlog for use in tests
function createTestOutlog(overrides: Partial<ApexOutlog> = {}): ApexOutlog {
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

// A single probe record used across multiple tests
const testRecord = {
  date: '01/15/2026 12:00:00',
  probes: [{ name: 'Temp', type: 'Temp', value: 78.5 }],
};

// Minimal DataCoverageResult returned by mock getDataCoverage
const testCoverage: DataCoverageResult = {
  totalRecords: 100,
  usefulRecords: 95,
  oldestUsefulRecordDate: '01/01/2026 00:00:00',
  newestUsefulRecordDate: '01/15/2026 12:00:00',
  totalDays: 15,
  daysWithData: 12,
  coveragePercent: 80,
};

// Creates a mock ApexClient object with vi.fn() stubs for all methods
function createMockApexClient() {
  return {
    getDatalog: vi.fn().mockResolvedValue(createTestDatalog({ records: [testRecord] })),
    getHistoricalDatalog: vi.fn().mockResolvedValue(createTestDatalog()),
    getHistoricalOutlog: vi.fn().mockResolvedValue(createTestOutlog()),
    getStatus: vi.fn(),
    // getDataCoverage calls its callback for each chunk, then returns coverage metadata
    getDataCoverage: vi.fn().mockImplementation(async (_callback: (d: ApexDatalog) => Promise<void>) => {
      return testCoverage;
    }),
  };
}

// Reset mockConfig to defaults before each test to prevent cross-test pollution
// Best practice: always reset shared mutable state in beforeEach
beforeEach(() => {
  mockConfig.queryChunkDays = 14;
  mockConfig.queryLookbackDays = 14;
  mockConfig.forceFullSync = false;
});

// --- Tests ---

describe('parseApexDate', () => {
  it('parses the year correctly', () => {
    // Apex uses MM/DD/YYYY format — year is the third component of the date part
    const result = parseApexDate('01/15/2026 12:30:45');
    expect(result.getFullYear()).toBe(2026);
  });

  it('parses the month correctly (converts 1-indexed to 0-indexed)', () => {
    // January is "01" in Apex format but month 0 in JavaScript Date
    const result = parseApexDate('01/15/2026 12:30:45');
    expect(result.getMonth()).toBe(0);
  });

  it('parses the day correctly', () => {
    // Day is the second component of the date part
    const result = parseApexDate('01/15/2026 12:30:45');
    expect(result.getDate()).toBe(15);
  });

  it('parses the hours correctly', () => {
    // Hours is the first component of the time part
    const result = parseApexDate('01/15/2026 12:30:45');
    expect(result.getHours()).toBe(12);
  });

  it('parses the minutes correctly', () => {
    // Minutes is the second component of the time part
    const result = parseApexDate('01/15/2026 12:30:45');
    expect(result.getMinutes()).toBe(30);
  });

  it('parses the seconds correctly', () => {
    // Seconds is the third component of the time part
    const result = parseApexDate('01/15/2026 12:30:45');
    expect(result.getSeconds()).toBe(45);
  });
});

describe('formatDuration', () => {
  it('returns "0s" for zero milliseconds', () => {
    // Edge case: zero duration should still return a valid string
    expect(formatDuration(0)).toBe('0s');
  });

  it('returns seconds only for durations less than one minute', () => {
    // 30 seconds = 30,000ms — only seconds component should appear
    expect(formatDuration(30_000)).toBe('30s');
  });

  it('returns minutes only for an exact minute with no remaining seconds', () => {
    // 2 minutes = 120,000ms — seconds component is 0 so it is omitted
    expect(formatDuration(120_000)).toBe('2m');
  });

  it('returns hours only for an exact hour with no remaining components', () => {
    // 3 hours = 10,800,000ms — minutes and seconds are both 0
    expect(formatDuration(10_800_000)).toBe('3h');
  });

  it('returns days only for an exact day with no remaining components', () => {
    // 2 days = 172,800,000ms — hours, minutes, seconds are all 0
    expect(formatDuration(172_800_000)).toBe('2d');
  });

  it('combines multiple non-zero components with spaces', () => {
    // 1d 2h 3m 4s = 93,784,000ms
    const ms = (1 * 86_400 + 2 * 3_600 + 3 * 60 + 4) * 1_000;
    expect(formatDuration(ms)).toBe('1d 2h 3m 4s');
  });

  it('omits zero components between non-zero ones', () => {
    // 1d 0h 0m 5s — hours and minutes are zero and should not appear
    const ms = (1 * 86_400 + 5) * 1_000;
    expect(formatDuration(ms)).toBe('1d 5s');
  });
});

describe('isFileLimitError', () => {
  it('returns true for "exceeding the file limit" message', () => {
    // First pattern: direct file limit message from InfluxDB 3 Core
    const error = new Error('Query failed: exceeding the file limit for this node');
    expect(isFileLimitError(error)).toBe(true);
  });

  it('returns true when message contains both "would scan" and "Parquet files"', () => {
    // Second pattern: scan-based file limit warning
    const error = new Error('This query would scan 20000 Parquet files');
    expect(isFileLimitError(error)).toBe(true);
  });

  it('returns false for an unrelated error message', () => {
    // Generic errors should not be mistaken for file limit errors
    const error = new Error('Network timeout');
    expect(isFileLimitError(error)).toBe(false);
  });

  it('returns false for a non-Error object (string)', () => {
    // Only Error instances are matched — strings should return false
    expect(isFileLimitError('exceeding the file limit')).toBe(false);
  });

  it('returns false for null', () => {
    // Null is not an Error instance
    expect(isFileLimitError(null)).toBe(false);
  });
});

describe('queryNewestInChunks', () => {
  it('returns the result from the first chunk when data is found', async () => {
    // First query call returns a record — should return immediately without checking older chunks
    const mockInflux = createMockInflux([[{ time: '2026-01-15T12:00:00Z' }]]);
    const result = await queryNewestInChunks(mockInflux, 'apex_probe');
    expect(result).toEqual({ time: '2026-01-15T12:00:00Z' });
  });

  it('moves to the next chunk when the first chunk returns no data', async () => {
    // With chunkDays=7 and lookbackDays=14, there are two chunks
    // First chunk empty, second chunk has data
    mockConfig.queryChunkDays = 7;
    const mockInflux = createMockInflux([[], [{ time: '2026-01-01T00:00:00Z' }]]);
    const result = await queryNewestInChunks(mockInflux, 'apex_probe');
    expect(result).toEqual({ time: '2026-01-01T00:00:00Z' });
  });

  it('returns null when no data is found in any chunk', async () => {
    // All chunks return empty — function should return null after exhausting lookback
    const mockInflux = createMockInflux([[]]);
    const result = await queryNewestInChunks(mockInflux, 'apex_probe');
    expect(result).toBeNull();
  });

  it('skips a chunk that throws a file limit error and continues to the next', async () => {
    // File limit errors are non-fatal — the chunk is skipped and the next is tried
    mockConfig.queryChunkDays = 7;
    const fileLimitError = new Error('exceeding the file limit');
    const queryMock = vi.fn()
      .mockRejectedValueOnce(fileLimitError)
      .mockResolvedValueOnce([{ time: '2026-01-01T00:00:00Z' }]);
    const mockInflux = { query: queryMock, writePoints: vi.fn(), close: vi.fn() } as unknown as InfluxClient;
    const result = await queryNewestInChunks(mockInflux, 'apex_probe');
    expect(result).toEqual({ time: '2026-01-01T00:00:00Z' });
  });

  it('re-throws errors that are not file limit errors', async () => {
    // Non-file-limit errors are unexpected and should propagate to the caller
    const networkError = new Error('Network timeout');
    const queryMock = vi.fn().mockRejectedValueOnce(networkError);
    const mockInflux = { query: queryMock, writePoints: vi.fn(), close: vi.fn() } as unknown as InfluxClient;
    await expect(queryNewestInChunks(mockInflux, 'apex_probe')).rejects.toThrow('Network timeout');
  });
});

describe('queryOldestInChunks', () => {
  it('returns the result from the oldest chunk when data is found', async () => {
    // Iterates from oldest to newest — first result found in the oldest chunk is returned
    const mockInflux = createMockInflux([[{ time: '2026-01-01T00:00:00Z' }]]);
    const result = await queryOldestInChunks(mockInflux, 'apex_probe');
    expect(result).toEqual({ time: '2026-01-01T00:00:00Z' });
  });

  it('moves to a newer chunk when the oldest chunk returns no data', async () => {
    // With chunkDays=7 and lookbackDays=14, two chunks are scanned oldest-first
    mockConfig.queryChunkDays = 7;
    const mockInflux = createMockInflux([[], [{ time: '2026-01-08T00:00:00Z' }]]);
    const result = await queryOldestInChunks(mockInflux, 'apex_probe');
    expect(result).toEqual({ time: '2026-01-08T00:00:00Z' });
  });

  it('returns null when no data is found in any chunk', async () => {
    // All chunks empty — should return null after exhausting entire lookback window
    const mockInflux = createMockInflux([[]]);
    const result = await queryOldestInChunks(mockInflux, 'apex_probe');
    expect(result).toBeNull();
  });

  it('skips a chunk that throws a file limit error and continues', async () => {
    // File limit errors should be skipped gracefully — next chunk is tried
    mockConfig.queryChunkDays = 7;
    const fileLimitError = new Error('would scan 99999 Parquet files');
    const queryMock = vi.fn()
      .mockRejectedValueOnce(fileLimitError)
      .mockResolvedValueOnce([{ time: '2026-01-08T00:00:00Z' }]);
    const mockInflux = { query: queryMock, writePoints: vi.fn(), close: vi.fn() } as unknown as InfluxClient;
    const result = await queryOldestInChunks(mockInflux, 'apex_probe');
    expect(result).toEqual({ time: '2026-01-08T00:00:00Z' });
  });
});

describe('getOldestDbTime', () => {
  it('returns a Date object when data is found in the database', async () => {
    // When queryOldestInChunks finds a record, the time string is parsed to a Date
    const mockInflux = createMockInflux([[{ time: '2026-01-01T00:00:00.000Z' }]]);
    const result = await getOldestDbTime(mockInflux);
    expect(result).toBeInstanceOf(Date);
    expect(result?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('returns null when the database has no data', async () => {
    // Empty database — all chunk queries return empty arrays
    const mockInflux = createMockInflux([[]]);
    const result = await getOldestDbTime(mockInflux);
    expect(result).toBeNull();
  });

  it('returns null and logs an error when the query throws', async () => {
    // Unexpected errors should be caught and logged, not rethrown
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const queryMock = vi.fn().mockRejectedValue(new Error('DB unavailable'));
    const mockInflux = { query: queryMock, writePoints: vi.fn(), close: vi.fn() } as unknown as InfluxClient;
    const result = await getOldestDbTime(mockInflux);
    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith('Failed to get oldest DB time:', expect.any(Error));
    consoleSpy.mockRestore();
  });
});

describe('writeBatched', () => {
  // Use fake timers to avoid 100ms delays between batches slowing down the test suite
  // Best practice: fake timers keep unit tests fast and deterministic
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns the total number of points written', async () => {
    // Total written should equal the number of points passed in
    const mockInflux = createMockInflux();
    const points = Array(3).fill({}) as any[];
    const promise = writeBatched(mockInflux, points, 10);
    await vi.runAllTimersAsync();
    expect(await promise).toBe(3);
  });

  it('writes all points in a single batch when count is less than batchSize', async () => {
    // 3 points with batchSize=10 → one writePoints call
    const mockInflux = createMockInflux();
    const points = Array(3).fill({}) as any[];
    const promise = writeBatched(mockInflux, points, 10);
    await vi.runAllTimersAsync();
    await promise;
    expect(mockInflux.writePoints).toHaveBeenCalledTimes(1);
  });

  it('splits into multiple batches when count exceeds batchSize', async () => {
    // 6 points with batchSize=2 → 3 writePoints calls
    const mockInflux = createMockInflux();
    const points = Array(6).fill({}) as any[];
    const promise = writeBatched(mockInflux, points, 2);
    await vi.runAllTimersAsync();
    await promise;
    expect(mockInflux.writePoints).toHaveBeenCalledTimes(3);
  });

  it('returns 0 and makes no write calls for an empty points array', async () => {
    // Empty input should produce no writes and return 0
    const mockInflux = createMockInflux();
    const promise = writeBatched(mockInflux, [], 10);
    await vi.runAllTimersAsync();
    expect(await promise).toBe(0);
    expect(mockInflux.writePoints).not.toHaveBeenCalled();
  });
});

describe('backfillRecentGaps', () => {
  it('fetches one day of historical datalog from the Apex', async () => {
    // backfillRecentGaps should always request exactly 1 day of history
    const mockApex = createMockApexClient();
    const mockInflux = createMockInflux();
    await backfillRecentGaps(mockInflux, mockApex as any);
    expect(mockApex.getHistoricalDatalog).toHaveBeenCalledWith(expect.any(Date), 1);
  });

  it('fetches one day of historical outlog from the Apex', async () => {
    // Outlet data must also be backfilled for the same 24-hour window
    const mockApex = createMockApexClient();
    const mockInflux = createMockInflux();
    await backfillRecentGaps(mockInflux, mockApex as any);
    expect(mockApex.getHistoricalOutlog).toHaveBeenCalledWith(expect.any(Date), 1);
  });

  it('writes probe points to InfluxDB when the datalog has records', async () => {
    // When mapAllRecordsToPoints returns points, writeBatched should call writePoints
    const mockApex = createMockApexClient();
    mockApex.getHistoricalDatalog.mockResolvedValue(createTestDatalog({ records: [testRecord] }));
    vi.mocked(mapAllRecordsToPoints).mockReturnValueOnce({ probes: [{} as any] });
    const mockInflux = createMockInflux();
    await backfillRecentGaps(mockInflux, mockApex as any);
    expect(mockInflux.writePoints).toHaveBeenCalled();
  });

  it('catches errors without rethrowing so startup is not blocked', async () => {
    // Backfill failures must be non-fatal — polling should continue even if backfill fails
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mockApex = createMockApexClient();
    mockApex.getHistoricalDatalog.mockRejectedValue(new Error('Apex offline'));
    const mockInflux = createMockInflux();
    await expect(backfillRecentGaps(mockInflux, mockApex as any)).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith('Backfill failed:', expect.any(Error));
    consoleSpy.mockRestore();
  });
});

describe('checkDatabaseFreshness', () => {
  it('returns early and logs when the Apex datalog has no records', async () => {
    // Empty datalog means nothing to sync — function should exit gracefully
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mockApex = createMockApexClient();
    mockApex.getDatalog.mockResolvedValue(createTestDatalog({ records: [] }));
    const mockInflux = createMockInflux();
    await checkDatabaseFreshness(mockInflux, mockApex as any);
    expect(consoleSpy).toHaveBeenCalledWith('No records found in Apex datalog.');
    consoleSpy.mockRestore();
  });

  it('logs "No existing data" message when the database is empty on first run', async () => {
    // All DB queries return empty — should log the first-run status message
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mockApex = createMockApexClient();
    // All influx.query calls return empty (no data in DB)
    const mockInflux = createMockInflux([[], [], []]);
    await checkDatabaseFreshness(mockInflux, mockApex as any);
    const allLogs = consoleSpy.mock.calls.map((c) => c[0]);
    expect(allLogs.some((msg) => typeof msg === 'string' && msg.includes('No existing data'))).toBe(true);
    consoleSpy.mockRestore();
  });

  it('handles a file limit error gracefully without rethrowing', async () => {
    // File limit errors during freshness check should be caught and logged with guidance
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mockApex = createMockApexClient();
    mockApex.getDatalog.mockRejectedValue(new Error('exceeding the file limit'));
    const mockInflux = createMockInflux();
    await expect(checkDatabaseFreshness(mockInflux, mockApex as any)).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith('=== InfluxDB File Limit Error ===');
    consoleSpy.mockRestore();
  });

  it('filters out records already present in the database', async () => {
    // Records with timestamps older than newestDbTimeBefore should be skipped
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const mockApex = createMockApexClient();
    // Pre-check returns a DB timestamp of 2026-01-15 12:00:00
    const preCheckTime = '2026-01-15T12:00:00.000Z';
    // Coverage callback receives a record older than the DB time — it should be filtered
    const oldRecord = { date: '01/15/2026 11:00:00', probes: [{ name: 'Temp', type: 'Temp', value: 78.0 }] };
    mockApex.getDataCoverage.mockImplementation(async (callback: (d: ApexDatalog) => Promise<void>) => {
      await callback(createTestDatalog({ records: [oldRecord] }));
      return testCoverage;
    });
    // First query (pre-check) returns existing DB time; subsequent queries return empty
    const mockInflux = createMockInflux([[{ time: preCheckTime }], [], []]);
    await checkDatabaseFreshness(mockInflux, mockApex as any);
    // writePoints should NOT have been called because the record was filtered out
    expect(mockInflux.writePoints).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('writes all records when forceFullSync is enabled', async () => {
    // forceFullSync bypasses the timestamp filter — all records are written regardless
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mockConfig.forceFullSync = true;
    const mockApex = createMockApexClient();
    const newRecord = { date: '01/15/2026 11:00:00', probes: [{ name: 'Temp', type: 'Temp', value: 78.0 }] };
    mockApex.getDataCoverage.mockImplementation(async (callback: (d: ApexDatalog) => Promise<void>) => {
      await callback(createTestDatalog({ records: [newRecord] }));
      return testCoverage;
    });
    // mapAllRecordsToPoints returns one fake point so writePoints gets called
    vi.mocked(mapAllRecordsToPoints).mockReturnValueOnce({ probes: [{} as any] });
    const mockInflux = createMockInflux([[], [], []]);
    await checkDatabaseFreshness(mockInflux, mockApex as any);
    expect(mockInflux.writePoints).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
