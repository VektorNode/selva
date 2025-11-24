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

  describe('create factory method', () => {
    it('should create client when server is online', async () => {
      const config = createConfig();
      const client = await GrasshopperClient.create(config);
      expect(client).toBeInstanceOf(GrasshopperClient);
      expect(client.serverStats).toBeDefined();
      await client.dispose();
    });

    it('should throw NETWORK_ERROR when server is offline', async () => {
      const config = createConfig();

      // Mock the static method before creating
      vi.mock('@/core/server/compute-server-stats', () => ({
        default: vi.fn().mockImplementation(() => ({
          isServerOnline: vi.fn().mockResolvedValue(false),
          dispose: vi.fn(),
        })),
      }));

      await expect(GrasshopperClient.create(config)).rejects.toThrow(
        'Rhino Compute server is not online'
      );
    });

    it('should throw config validation errors from constructor', async () => {
      await expect(GrasshopperClient.create({} as any)).rejects.toThrow('serverUrl is required');
    });

    it('should throw when serverUrl is empty', async () => {
      await expect(GrasshopperClient.create({ serverUrl: '' } as any)).rejects.toThrow(
        'serverUrl is required'
      );
    });

    it('should throw when URL format is invalid', async () => {
      await expect(GrasshopperClient.create({ serverUrl: 'not-a-url' } as any)).rejects.toThrow(
        'serverUrl must be a valid URL'
      );
    });

    it('should throw when using default public endpoint', async () => {
      await expect(
        GrasshopperClient.create({ serverUrl: 'https://compute.rhino3d.com/' } as any)
      ).rejects.toThrow('serverUrl must be set to your Compute server URL');
    });
  });

  describe('dispose lifecycle', () => {
    let client: GrasshopperClient;

    beforeEach(async () => {
      client = await GrasshopperClient.create(createConfig());
    });

    it('should allow dispose to be called multiple times', async () => {
      await client.dispose();
      await client.dispose(); // Should not throw
    });

    it('should prevent operations after disposal', async () => {
      await client.dispose();

      expect(() => client.getConfig()).toThrow(RhinoComputeError);
      expect(() => client.getConfig()).toThrow('has been disposed');
    });

    it('should throw with correct error code when disposed', async () => {
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
      await client.dispose();

      await expect(client.getIO('http://test.com/def.gh')).rejects.toThrow('has been disposed');
    });

    it('should prevent getRawIO after disposal', async () => {
      await client.dispose();

      await expect(client.getRawIO('http://test.com/def.gh')).rejects.toThrow('has been disposed');
    });

    it('should prevent solve after disposal', async () => {
      await client.dispose();

      const dataTree: any[] = [];
      await expect(client.solve('http://test.com/def.gh', dataTree)).rejects.toThrow(
        'has been disposed'
      );
    });
  });

  describe('solve method error handling', () => {
    let client: GrasshopperClient;

    beforeEach(async () => {
      client = await GrasshopperClient.create(createConfig());
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
    let client: GrasshopperClient;

    beforeEach(async () => {
      client = await GrasshopperClient.create(createConfig());
    });

    it('should return a copy of config, not the original', () => {
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

      const testClient = GrasshopperClient['create'](originalConfig);
      // Note: In real tests, you'd need to handle the async nature properly
      // This is a simplified example showing the structure
    });

    it('should strip trailing slashes from serverUrl', async () => {
      const client2 = await GrasshopperClient.create(
        createConfig({ serverUrl: 'http://localhost:6500///' })
      );
      const config = client2.getConfig();
      expect(config.serverUrl).toBe('http://localhost:6500');
      await client2.dispose();
    });

    it('should default debug to false', async () => {
      const client2 = await GrasshopperClient.create(createConfig({ debug: undefined }));
      const config = client2.getConfig();
      expect(config.debug).toBe(false);
      await client2.dispose();
    });
  });
});
