import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GrasshopperClient } from 'rhino-compute-core';
import { DEFAULT_CONFIG } from '$lib';

const performHealthCheck = async () => {
  const client = new GrasshopperClient(DEFAULT_CONFIG);
  const isOnline = await client.serverStats.isServerOnline();

  if (!isOnline) {
    return json(
      {
        isHealthy: false,
        isOnline: false,
        message: 'Server is offline',
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }

  // Perform health check
  const healthCheck = await client.serverStats.getServerStats();

  return json({
    isOnline: healthCheck.isOnline,
    version: healthCheck.version,
    activeChildren: healthCheck.activeChildren,
  });
};

export const POST: RequestHandler = async () => {
  try {
    return await performHealthCheck();
  } catch (error) {
    console.error('Health check API error:', error);

    let errorMessage = 'Failed to perform health check';
    if (error instanceof Error) {
      errorMessage = error.message;
    }

    return json(
      {
        isHealthy: false,
        isOnline: false,
        message: errorMessage,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
};

export const GET: RequestHandler = async () => {
  try {
    return await performHealthCheck();
  } catch (error) {
    console.error('Health check API error:', error);

    let errorMessage = 'Failed to perform health check';
    if (error instanceof Error) {
      errorMessage = error.message;
    }

    return json(
      {
        isHealthy: false,
        isOnline: false,
        message: errorMessage,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
};
