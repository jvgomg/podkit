/**
 * Registry for tracking active containers started by tests.
 *
 * This is a process-global singleton that enables cleanup on interruption.
 */

import { runContainerCommand } from './runtime.js';

interface RegisteredContainer {
  id: string;
  name: string;
  startedAt: Date;
  source: string; // e.g., 'subsonic', 'future-source'
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
          await runContainerCommand(['stop', container.id]);
          this.unregister(container.id);
          console.log(`[docker-cleanup] Stopped: ${container.name} (${container.source})`);
        } catch (err) {
          // Try force kill if stop fails
          try {
            await runContainerCommand(['kill', container.id]);
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
