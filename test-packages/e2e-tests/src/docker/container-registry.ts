/**
 * Registry for tracking active Docker containers started by tests.
 *
 * This is a process-global singleton that enables cleanup on interruption.
 */

import { spawn } from 'node:child_process';

interface RegisteredContainer {
  id: string;
  name: string;
  startedAt: Date;
  source: string; // e.g., 'subsonic', 'future-source'
}

/**
 * Run a docker command and return stdout
 */
function runDockerCommand(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Docker command failed (exit ${code}): ${stderr || stdout}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

class ContainerRegistry {
  private static instance: ContainerRegistry | null = null;
  private containers: Map<string, RegisteredContainer> = new Map();

  static getInstance(): ContainerRegistry {
    if (!ContainerRegistry.instance) {
      ContainerRegistry.instance = new ContainerRegistry();
    }
    return ContainerRegistry.instance;
  }

  register(id: string, source: string, name?: string): void {
    this.containers.set(id, {
      id,
      name: name ?? id.substring(0, 12),
      startedAt: new Date(),
      source,
    });
  }

  unregister(id: string): void {
    this.containers.delete(id);
  }

  getAll(): RegisteredContainer[] {
    return Array.from(this.containers.values());
  }

  isEmpty(): boolean {
    return this.containers.size === 0;
  }

  async stopAll(): Promise<void> {
    const containers = this.getAll();
    if (containers.length === 0) return;

    console.log(`[docker-cleanup] Stopping ${containers.length} container(s)...`);

    await Promise.allSettled(
      containers.map(async (container) => {
        try {
          await runDockerCommand(['stop', container.id]);
          this.unregister(container.id);
          console.log(`[docker-cleanup] Stopped: ${container.name} (${container.source})`);
        } catch (err) {
          // Try force kill if stop fails
          try {
            await runDockerCommand(['kill', container.id]);
            this.unregister(container.id);
            console.log(`[docker-cleanup] Killed: ${container.name} (${container.source})`);
          } catch {
            console.error(`[docker-cleanup] Failed to stop/kill ${container.name}:`, err);
          }
        }
      })
    );
  }
}

export const containerRegistry = ContainerRegistry.getInstance();
