import { spawn } from 'child_process';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from '@sveltejs/kit';

// POST - Run update script and stream output via Server-Sent Events
export const POST: RequestHandler = async () => {
  const installDir = env.INSTALL_DIR || process.cwd();
  const updateScript = 'update.sh';

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      function sendEvent(type: string, data: Record<string, unknown>) {
        const message = `data: ${JSON.stringify({ type, ...data })}\n\n`;
        controller.enqueue(encoder.encode(message));
      }

      try {
        // Spawn the update script
        const child = spawn('bash', [updateScript], {
          cwd: installDir,
          env: process.env
        });

        // Stream stdout
        child.stdout.on('data', (data) => {
          const lines = data.toString().split('\n');
          for (const line of lines) {
            if (line.trim()) {
              sendEvent('log', { data: line });
            }
          }
        });

        // Stream stderr
        child.stderr.on('data', (data) => {
          const lines = data.toString().split('\n');
          for (const line of lines) {
            if (line.trim()) {
              sendEvent('log', { data: `[ERROR] ${line}` });
            }
          }
        });

        // Handle process exit
        child.on('close', (code) => {
          sendEvent('exit', { code: code ?? -1 });
          controller.close();
        });

        // Handle errors
        child.on('error', (err) => {
          sendEvent('log', { data: `[FATAL] ${err.message}` });
          sendEvent('exit', { code: -1 });
          controller.close();
        });
      } catch (err) {
        sendEvent('log', { data: `[FATAL] Failed to spawn process: ${err}` });
        sendEvent('exit', { code: -1 });
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    }
  });
};
