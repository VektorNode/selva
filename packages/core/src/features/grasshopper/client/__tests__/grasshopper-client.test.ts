import { describe, expect, it, vi, beforeEach } from 'vitest';
import { RhinoComputeError } from '@/core/errors/base';
import { ErrorCodes } from '@/core/errors';
import GrasshopperClient from '../grasshopper-client';
import type { GrasshopperComputeConfig } from '../../types';

describe('GrasshopperClient', () => {
  // Test config factory
  const createConfig = (
    overrides?: Partial<GrasshopperComputeConfig>
  ): GrasshopperComputeConfig => ({
    serverUrl: 'http://localhost:6500',
    apiKey: 'test-api-key',
    debug: false,
    ...overrides,
  });

  describe('constructor validation', () => {
    it('should reject missing serverUrl', () => {
      expect(() => new GrasshopperClient({} as any)).toThrow('serverUrl is required');
    });

    it('should reject empty serverUrl', () => {
      expect(() => new GrasshopperClient({ serverUrl: '' } as any)).toThrow(
        'serverUrl is required'
      );
    });

    it('should reject invalid URL format', () => {
      expect(() => new GrasshopperClient({ serverUrl: 'not-a-url' } as any)).toThrow(
        'serverUrl must be a valid URL'
      );
    });

    it('should reject default public endpoint', () => {
      expect(
        () => new GrasshopperClient({ serverUrl: 'https://compute.rhino3d.com/' } as any)
      ).toThrow('serverUrl must be set to your Compute server URL');
    });

    it('should strip trailing slashes from serverUrl', () => {
      const client = new GrasshopperClient(createConfig({ serverUrl: 'http://localhost:6500///' }));
      const config = client.getConfig();
      expect(config.serverUrl).toBe('http://localhost:6500');
    });

    it('should accept valid configuration', () => {
      const client = new GrasshopperClient(createConfig());
      expect(client).toBeInstanceOf(GrasshopperClient);
      expect(client.serverStats).toBeDefined();
    });

    it('should default debug to false', () => {
      const client = new GrasshopperClient(createConfig({ debug: undefined }));
      const config = client.getConfig();
      expect(config.debug).toBe(false);
    });
  });

  describe('dispose lifecycle', () => {
    it('should allow dispose to be called multiple times', async () => {
      const client = new GrasshopperClient(createConfig());
      await client.dispose();
      await client.dispose(); // Should not throw
    });

    it('should prevent operations after disposal', async () => {
      const client = new GrasshopperClient(createConfig());
      await client.dispose();

      expect(() => client.getConfig()).toThrow(RhinoComputeError);
      expect(() => client.getConfig()).toThrow('has been disposed');
    });

    it('should throw with correct error code when disposed', async () => {
      const client = new GrasshopperClient(createConfig());
      await client.dispose();

      try {
        client.getConfig();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RhinoComputeError);
        expect((error as RhinoComputeError).code).toBe(ErrorCodes.INVALID_STATE);
      }
    });

    it('should prevent getIO after disposal', async () => {
      const client = new GrasshopperClient(createConfig());
      await client.dispose();

      await expect(client.getIO('http://test.com/def.gh')).rejects.toThrow('has been disposed');
    });

    it('should prevent getRawIO after disposal', async () => {
      const client = new GrasshopperClient(createConfig());
      await client.dispose();

      await expect(client.getRawIO('http://test.com/def.gh')).rejects.toThrow('has been disposed');
    });

    it('should prevent solve after disposal', async () => {
      const client = new GrasshopperClient(createConfig());
      await client.dispose();

      const dataTree: any[] = [];
      await expect(client.solve('http://test.com/def.gh', dataTree)).rejects.toThrow(
        'has been disposed'
      );
    });
  });

  describe('solve method error handling', () => {
    let client: GrasshopperClient;

    beforeEach(() => {
      client = new GrasshopperClient(createConfig());
    });

    it('should reject empty definition URL', async () => {
      const dataTree: any[] = [];
      await expect(client.solve('', dataTree)).rejects.toThrow('Definition URL is required');
    });

    it('should reject whitespace-only definition URL', async () => {
      const dataTree: any[] = [];
      await expect(client.solve('   ', dataTree)).rejects.toThrow('Definition URL is required');
    });

    it('should wrap non-RhinoComputeError errors in RhinoComputeError', async () => {
      // Mock serverStats to return true but throw during solve
      vi.spyOn(client.serverStats, 'isServerOnline').mockResolvedValue(true);

      // Mock the solve function to throw a generic error
      const solveModule = await import('../../compute/solve');
      vi.spyOn(solveModule, 'solveGrasshopperDefinition').mockRejectedValue(
        new Error('Network failure')
      );

      const dataTree: any[] = [];

      try {
        await client.solve('http://test.com/def.gh', dataTree);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RhinoComputeError);
        expect((error as RhinoComputeError).message).toBe('Network failure');
      }
    });

    it('should preserve RhinoComputeError when already thrown', async () => {
      vi.spyOn(client.serverStats, 'isServerOnline').mockResolvedValue(true);

      const originalError = new RhinoComputeError('Original error', ErrorCodes.NETWORK_ERROR);

      const solveModule = await import('../../compute/solve');
      vi.spyOn(solveModule, 'solveGrasshopperDefinition').mockRejectedValue(originalError);

      const dataTree: any[] = [];

      try {
        await client.solve('http://test.com/def.gh', dataTree);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBe(originalError); // Same instance
        expect((error as RhinoComputeError).code).toBe(ErrorCodes.NETWORK_ERROR);
      }
    });

    it('should check server status before solving', async () => {
      const isOnlineSpy = vi.spyOn(client.serverStats, 'isServerOnline').mockResolvedValue(false);

      const dataTree: any[] = [];

      await expect(client.solve('http://test.com/def.gh', dataTree)).rejects.toThrow(
        'Rhino Compute server is not online'
      );

      expect(isOnlineSpy).toHaveBeenCalledOnce();
    });

    it('should include context in wrapped errors', async () => {
      vi.spyOn(client.serverStats, 'isServerOnline').mockResolvedValue(true);

      const solveModule = await import('../../compute/solve');
      vi.spyOn(solveModule, 'solveGrasshopperDefinition').mockRejectedValue(
        new Error('Compute failed')
      );

      const dataTree: any[] = [{ data: 'test' } as any];
      const definitionUrl = 'http://test.com/def.gh';

      try {
        await client.solve(definitionUrl, dataTree);
        expect.fail('Should have thrown');
      } catch (error) {
        const rhinoError = error as RhinoComputeError;
        expect(rhinoError.context).toBeDefined();
        expect(rhinoError.context?.definitionUrl).toBe(definitionUrl);
        expect(rhinoError.context?.inputs).toEqual(dataTree);
      }
    });
  });

  describe('config management', () => {
    it('should return a copy of config, not the original', () => {
      const client = new GrasshopperClient(createConfig());
      const config1 = client.getConfig();
      const config2 = client.getConfig();

      expect(config1).not.toBe(config2); // Different objects
      expect(config1).toEqual(config2); // But same values
    });

    it('should preserve all config properties', () => {
      const originalConfig = createConfig({
        serverUrl: 'http://localhost:8080',
        apiKey: 'my-key',
        authToken: 'my-token',
        debug: true,
        suppressClientSideWarning: true,
      });

      const client = new GrasshopperClient(originalConfig);
      const config = client.getConfig();

      expect(config.serverUrl).toBe('http://localhost:8080');
      expect(config.apiKey).toBe('my-key');
      expect(config.authToken).toBe('my-token');
      expect(config.debug).toBe(true);
      expect(config.suppressClientSideWarning).toBe(true);
    });
  });
});
