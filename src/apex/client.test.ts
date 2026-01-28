// Tests for the Apex client module
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Import the client class under test
import { ApexClient } from './client.js';

// Sample XML response for mocking
const sampleXmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<datalog software="5.12_2B25" hardware="1.0">
  <hostname>TestApex</hostname>
  <serial>AC5:12345</serial>
  <timezone>-8.00</timezone>
  <record>
    <date>01/15/2026 12:00:00</date>
    <probe>
      <name>Temp</name>
      <type>Temp</type>
      <value>78.5</value>
    </probe>
  </record>
</datalog>`;

// XML with multiple probes
const multiProbeXml = `<?xml version="1.0" encoding="UTF-8"?>
<datalog software="5.12_2B25" hardware="1.0">
  <hostname>TestApex</hostname>
  <serial>AC5:12345</serial>
  <timezone>-8.00</timezone>
  <record>
    <date>01/15/2026 12:00:00</date>
    <probe>
      <name>Temp</name>
      <type>Temp</type>
      <value>78.5</value>
    </probe>
    <probe>
      <name>pH</name>
      <type>pH</type>
      <value>8.2</value>
    </probe>
  </record>
</datalog>`;

// XML with multiple records
const multiRecordXml = `<?xml version="1.0" encoding="UTF-8"?>
<datalog software="5.12_2B25" hardware="1.0">
  <hostname>TestApex</hostname>
  <serial>AC5:12345</serial>
  <timezone>-8.00</timezone>
  <record>
    <date>01/15/2026 12:00:00</date>
    <probe>
      <name>Temp</name>
      <type>Temp</type>
      <value>77.0</value>
    </probe>
  </record>
  <record>
    <date>01/15/2026 12:30:00</date>
    <probe>
      <name>Temp</name>
      <type>Temp</type>
      <value>78.5</value>
    </probe>
  </record>
</datalog>`;

describe('ApexClient', () => {
  // Store original fetch to restore later
  const originalFetch = global.fetch;

  // Reset mocks before each test
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // Restore original fetch after each test
  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('constructor', () => {
    it('builds correct base URL from host', () => {
      // Create client with simple host
      const client = new ApexClient({ host: '192.168.1.100' });

      // Mock fetch to capture the URL
      let capturedUrl = '';
      global.fetch = vi.fn().mockImplementation((url: string) => {
        capturedUrl = url;
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(sampleXmlResponse),
        });
      });

      // Trigger a request to capture the URL
      client.getDatalog();

      // Verify URL format
      expect(capturedUrl).toBe('http://192.168.1.100/cgi-bin/datalog.xml');
    });

    it('creates auth header when credentials provided', async () => {
      // Create client with credentials
      const client = new ApexClient({
        host: '192.168.1.100',
        username: 'admin',
        password: 'secret',
      });

      // Mock fetch to capture headers
      let capturedHeaders: Record<string, string> = {};
      global.fetch = vi.fn().mockImplementation((_url: string, options: RequestInit) => {
        capturedHeaders = options.headers as Record<string, string>;
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(sampleXmlResponse),
        });
      });

      // Trigger request
      await client.getDatalog();

      // Verify auth header is present and correctly formatted
      expect(capturedHeaders['Authorization']).toBeDefined();
      // Decode and verify credentials
      const encoded = capturedHeaders['Authorization'].replace('Basic ', '');
      const decoded = Buffer.from(encoded, 'base64').toString();
      expect(decoded).toBe('admin:secret');
    });

    it('omits auth header when no credentials provided', async () => {
      // Create client without credentials
      const client = new ApexClient({ host: '192.168.1.100' });

      // Mock fetch to capture headers
      let capturedHeaders: Record<string, string> = {};
      global.fetch = vi.fn().mockImplementation((_url: string, options: RequestInit) => {
        capturedHeaders = options.headers as Record<string, string>;
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(sampleXmlResponse),
        });
      });

      // Trigger request
      await client.getDatalog();

      // Verify auth header is not present
      expect(capturedHeaders['Authorization']).toBeUndefined();
    });
  });

  describe('getDatalog', () => {
    it('parses single record with single probe correctly', async () => {
      // Create client
      const client = new ApexClient({ host: '192.168.1.100' });

      // Mock successful fetch response
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(sampleXmlResponse),
      });

      // Fetch datalog
      const datalog = await client.getDatalog();

      // Verify parsed structure
      expect(datalog.software).toBe('5.12_2B25');
      expect(datalog.hardware).toBe('1.0');
      expect(datalog.hostname).toBe('TestApex');
      expect(datalog.serial).toBe('AC5:12345');
      expect(datalog.timezone).toBe(-8);
      expect(datalog.records).toHaveLength(1);
      expect(datalog.records[0].date).toBe('01/15/2026 12:00:00');
      expect(datalog.records[0].probes).toHaveLength(1);
      expect(datalog.records[0].probes[0]).toEqual({
        name: 'Temp',
        type: 'Temp',
        value: 78.5,
      });
    });

    it('parses multiple probes in a single record', async () => {
      // Create client
      const client = new ApexClient({ host: '192.168.1.100' });

      // Mock response with multiple probes
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(multiProbeXml),
      });

      // Fetch datalog
      const datalog = await client.getDatalog();

      // Verify multiple probes are parsed
      expect(datalog.records[0].probes).toHaveLength(2);
      expect(datalog.records[0].probes[0].name).toBe('Temp');
      expect(datalog.records[0].probes[1].name).toBe('pH');
    });

    it('parses multiple records correctly', async () => {
      // Create client
      const client = new ApexClient({ host: '192.168.1.100' });

      // Mock response with multiple records
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(multiRecordXml),
      });

      // Fetch datalog
      const datalog = await client.getDatalog();

      // Verify multiple records are parsed
      expect(datalog.records).toHaveLength(2);
      expect(datalog.records[0].probes[0].value).toBe(77.0);
      expect(datalog.records[1].probes[0].value).toBe(78.5);
    });

    it('throws error on HTTP failure', async () => {
      // Create client
      const client = new ApexClient({ host: '192.168.1.100' });

      // Mock failed fetch response
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      // Expect error to be thrown
      await expect(client.getDatalog()).rejects.toThrow(
        'Failed to fetch Apex datalog: 401 Unauthorized'
      );
    });

    it('throws error on network failure', async () => {
      // Create client
      const client = new ApexClient({ host: '192.168.1.100' });

      // Mock network error
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      // Expect error to be thrown
      await expect(client.getDatalog()).rejects.toThrow('Network error');
    });

    it('sets Accept header to application/xml', async () => {
      // Create client
      const client = new ApexClient({ host: '192.168.1.100' });

      // Mock fetch to capture headers
      let capturedHeaders: Record<string, string> = {};
      global.fetch = vi.fn().mockImplementation((_url: string, options: RequestInit) => {
        capturedHeaders = options.headers as Record<string, string>;
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(sampleXmlResponse),
        });
      });

      // Trigger request
      await client.getDatalog();

      // Verify Accept header
      expect(capturedHeaders['Accept']).toBe('application/xml');
    });
  });

  describe('value parsing', () => {
    it('parses probe values as floats', async () => {
      // Create client
      const client = new ApexClient({ host: '192.168.1.100' });

      // Mock response
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(sampleXmlResponse),
      });

      // Fetch datalog
      const datalog = await client.getDatalog();

      // Verify value is a number, not a string
      expect(typeof datalog.records[0].probes[0].value).toBe('number');
      expect(datalog.records[0].probes[0].value).toBe(78.5);
    });

    it('parses timezone as float', async () => {
      // Create client
      const client = new ApexClient({ host: '192.168.1.100' });

      // Mock response
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(sampleXmlResponse),
      });

      // Fetch datalog
      const datalog = await client.getDatalog();

      // Verify timezone is a number
      expect(typeof datalog.timezone).toBe('number');
      expect(datalog.timezone).toBe(-8);
    });
  });
});
