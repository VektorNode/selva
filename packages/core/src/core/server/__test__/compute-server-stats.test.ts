import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ComputeServerStats from '../compute-server-stats';

describe('ComputeServerStats', () => {
  let instance: ComputeServerStats | null;

  afterEach(async () => {
    if (instance) {
      await instance.dispose();
      instance = null;
    }
  });

  describe('constructor validation', () => {
    it('should accept valid URLs', () => {
      expect(() => {
        instance = new ComputeServerStats('http://localhost:5000');
      }).not.toThrow();

      expect(() => {
        instance = new ComputeServerStats('https://example.com/path');
      }).not.toThrow();
    });

    it('should throw error for invalid URLs', () => {
      expect(() => new ComputeServerStats('not a url')).toThrow(/Invalid serverUrl/);
      expect(() => new ComputeServerStats('http://')).toThrow(/Invalid serverUrl/);
    });

    it('should throw error for empty serverUrl', () => {
      expect(() => new ComputeServerStats('')).toThrow(/serverUrl is required/);
      expect(() => new ComputeServerStats('   ')).toThrow(/serverUrl is required/);
    });

    it('should store apiKey when provided', () => {
      instance = new ComputeServerStats('http://localhost:5000', 'test-key');
      expect((instance as any).apiKey).toBe('test-key');
    });

    it('should not store apiKey when not provided', () => {
      instance = new ComputeServerStats('http://localhost:5000');
      expect((instance as any).apiKey).toBeUndefined();
    });
  });

  describe('disposed instance', () => {
    it('should throw error when using disposed instance', async () => {
      instance = new ComputeServerStats('http://localhost:5000');
      await instance.dispose();

      await expect(instance.isServerOnline()).rejects.toThrow(
        'ComputeServerStats has been disposed and cannot be used',
      );
      await expect(instance.getActiveChildren()).rejects.toThrow(
        'ComputeServerStats has been disposed and cannot be used',
      );
      await expect(instance.getVersion()).rejects.toThrow(
        'ComputeServerStats has been disposed and cannot be used',
      );
      await expect(instance.getServerStats()).rejects.toThrow(
        'ComputeServerStats has been disposed and cannot be used',
      );
    });
  });

  describe('buildHeaders', () => {
    it('should include Content-Type header', () => {
      instance = new ComputeServerStats('http://localhost:5000');
      const headers = (instance as any).buildHeaders();

      expect(headers['Content-Type']).toBe('application/json');
    });

    it('should include RhinoComputeKey when apiKey is provided', () => {
      instance = new ComputeServerStats('http://localhost:5000', 'test-api-key');
      const headers = (instance as any).buildHeaders();

      expect(headers['RhinoComputeKey']).toBe('test-api-key');
    });

    it('should not include RhinoComputeKey when apiKey is not provided', () => {
      instance = new ComputeServerStats('http://localhost:5000');
      const headers = (instance as any).buildHeaders();

      expect(headers['RhinoComputeKey']).toBeUndefined();
    });
  });

  describe('isServerOnline', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should return true when server responds successfully', async () => {
      instance = new ComputeServerStats('http://localhost:5000');

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
        }),
      );

      const result = await instance.isServerOnline();
      expect(result).toBe(true);
    });

    it('should return false when response is not ok', async () => {
      instance = new ComputeServerStats('http://localhost:5000');

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
        }),
      );

      const result = await instance.isServerOnline();
      expect(result).toBe(false);
    });

    it('should return false on network error', async () => {
      instance = new ComputeServerStats('http://localhost:5000');

      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      const result = await instance.isServerOnline();
      expect(result).toBe(false);
    });

    it('should call healthcheck endpoint with correct headers', async () => {
      instance = new ComputeServerStats('http://localhost:5000', 'api-key-123');
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', mockFetch);

      await instance.isServerOnline();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/healthcheck',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ RhinoComputeKey: 'api-key-123' }),
        }),
      );
    });
  });

  describe('getActiveChildren', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should return active children count', async () => {
      instance = new ComputeServerStats('http://localhost:5000');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          text: vi.fn().mockResolvedValue('5'),
        }),
      );

      const result = await instance.getActiveChildren();
      expect(result).toBe(5);
    });

    it('should return null on failed response', async () => {
      instance = new ComputeServerStats('http://localhost:5000');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
        }),
      );

      const result = await instance.getActiveChildren();
      expect(result).toBeNull();
    });

    it('should return null on network error', async () => {
      instance = new ComputeServerStats('http://localhost:5000');
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      const result = await instance.getActiveChildren();
      expect(result).toBeNull();
    });

    it('should return null on invalid number response', async () => {
      instance = new ComputeServerStats('http://localhost:5000');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          text: vi.fn().mockResolvedValue('not-a-number'),
        }),
      );

      const result = await instance.getActiveChildren();
      expect(result).toBeNull();
    });
  });

  describe('getVersion', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should return version object when response is JSON', async () => {
      instance = new ComputeServerStats('http://localhost:5000');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({
            rhino: '7.0',
            compute: '2.0',
            git_sha: 'abc123',
          }),
        }),
      );

      const result = await instance.getVersion();
      expect(result).toEqual({
        rhino: '7.0',
        compute: '2.0',
        git_sha: 'abc123',
      });
    });

    it('should return null on failed response', async () => {
      instance = new ComputeServerStats('http://localhost:5000');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
        }),
      );

      const result = await instance.getVersion();
      expect(result).toBeNull();
    });

    it('should return null on network error', async () => {
      instance = new ComputeServerStats('http://localhost:5000');
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      const result = await instance.getVersion();
      expect(result).toBeNull();
    });

    it('should handle missing fields in JSON response', async () => {
      instance = new ComputeServerStats('http://localhost:5000');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({}),
        }),
      );

      const result = await instance.getVersion();
      expect(result).toEqual({
        rhino: '',
        compute: '',
        git_sha: null,
      });
    });

    it('should fallback to text parsing on JSON error', async () => {
      instance = new ComputeServerStats('http://localhost:5000');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
          text: vi.fn().mockResolvedValue('7.0'),
        }),
      );

      const result = await instance.getVersion();
      expect(result).toEqual({
        rhino: '7.0',
        compute: '',
        git_sha: null,
      });
    });
  });

  describe('getServerStats', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should return only isOnline when server is offline', async () => {
      instance = new ComputeServerStats('http://localhost:5000');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
        }),
      );

      const result = await instance.getServerStats();
      expect(result).toEqual({ isOnline: false });
    });

    it('should return all stats when server is online', async () => {
      instance = new ComputeServerStats('http://localhost:5000');
      const mockFetch = vi.fn();

      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            rhino: '7.0',
            compute: '2.0',
            git_sha: 'abc123',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: vi.fn().mockResolvedValue('3'),
        });

      vi.stubGlobal('fetch', mockFetch);

      const result = await instance.getServerStats();
      expect(result).toEqual({
        isOnline: true,
        version: {
          rhino: '7.0',
          compute: '2.0',
          git_sha: 'abc123',
        },
        activeChildren: 3,
      });
    });

    it('should omit version when unavailable', async () => {
      instance = new ComputeServerStats('http://localhost:5000');
      const mockFetch = vi.fn();

      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce({
          ok: true,
          text: vi.fn().mockResolvedValue('2'),
        });

      vi.stubGlobal('fetch', mockFetch);

      const result = await instance.getServerStats();
      expect(result).toEqual({
        isOnline: true,
        activeChildren: 2,
      });
      expect(result.version).toBeUndefined();
    });

    it('should omit activeChildren when unavailable', async () => {
      instance = new ComputeServerStats('http://localhost:5000');
      const mockFetch = vi.fn();

      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            rhino: '7.0',
            compute: '2.0',
          }),
        })
        .mockResolvedValueOnce({ ok: false });

      vi.stubGlobal('fetch', mockFetch);

      const result = await instance.getServerStats();
      expect(result).toEqual({
        isOnline: true,
        version: {
          rhino: '7.0',
          compute: '2.0',
          git_sha: null,
        },
      });
      expect(result.activeChildren).toBeUndefined();
    });
  });
});
