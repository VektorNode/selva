import { spawn } from 'child_process';
import { join } from 'path';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from '@sveltejs/kit';

// Strip ANSI escape codes from terminal output
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[mGKHF]/g, '');
}

// POST - Run update script and stream output via Server-Sent Events
export const POST: RequestHandler = async () => {
  // Fall back to cwd — PM2 launches from the repo root so process.cwd() is the install dir
  const installDir = env.INSTALL_DIR || process.cwd();
  const updateScript = join(installDir, 'scripts', 'update.sh');

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
          env: { PATH: process.env.PATH, HOME: process.env.HOME }
        });

        // Stream stdout
        child.stdout.on('data', (data) => {
          const lines = data.toString().split('\n');
          for (const line of lines) {
            const clean = stripAnsi(line).trim();
            if (clean) {
              sendEvent('log', { data: clean });
            }
          }
        });

        // Stream stderr
        child.stderr.on('data', (data) => {
          const lines = data.toString().split('\n');
          for (const line of lines) {
            const clean = stripAnsi(line).trim();
            if (clean) {
              sendEvent('log', { data: `[ERROR] ${clean}` });
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
