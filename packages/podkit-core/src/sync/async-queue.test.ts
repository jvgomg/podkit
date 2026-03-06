import { describe, it, expect } from 'bun:test';
import { AsyncQueue } from './async-queue';

describe('AsyncQueue', () => {
  describe('constructor', () => {
    it('creates queue with default max size of 3', async () => {
      const queue = new AsyncQueue<number>();
      // Can push 3 items without blocking
      await queue.push(1);
      await queue.push(2);
      await queue.push(3);
      expect(queue.length).toBe(3);
    });

    it('creates queue with custom max size', async () => {
      const queue = new AsyncQueue<number>(5);
      for (let i = 0; i < 5; i++) {
        await queue.push(i);
      }
      expect(queue.length).toBe(5);
    });

    it('throws if max size is less than 1', () => {
      expect(() => new AsyncQueue<number>(0)).toThrow('maxSize must be at least 1');
      expect(() => new AsyncQueue<number>(-1)).toThrow('maxSize must be at least 1');
    });
  });

  describe('push and pop', () => {
    it('pushes and pops items in FIFO order', async () => {
      const queue = new AsyncQueue<number>();
      await queue.push(1);
      await queue.push(2);
      await queue.push(3);

      expect(await queue.pop()).toBe(1);
      expect(await queue.pop()).toBe(2);
      expect(await queue.pop()).toBe(3);
    });

    it('pop blocks when queue is empty', async () => {
      const queue = new AsyncQueue<number>();
      let resolved = false;

      const popPromise = queue.pop().then((value) => {
        resolved = true;
        return value;
      });

      // Give time for pop to potentially resolve
      await new Promise((r) => setTimeout(r, 10));
      expect(resolved).toBe(false);

      // Push an item to unblock
      await queue.push(42);
      expect(await popPromise).toBe(42);
      expect(resolved).toBe(true);
    });

    it('push blocks when queue is full', async () => {
      const queue = new AsyncQueue<number>(2);
      await queue.push(1);
      await queue.push(2);

      let resolved = false;
      const pushPromise = queue.push(3).then(() => {
        resolved = true;
      });

      // Give time for push to potentially resolve
      await new Promise((r) => setTimeout(r, 10));
      expect(resolved).toBe(false);
      expect(queue.length).toBe(2);

      // Pop to make space
      expect(await queue.pop()).toBe(1);
      await pushPromise;
      expect(resolved).toBe(true);
    });

    it('handles multiple blocked pushes', async () => {
      const queue = new AsyncQueue<number>(1);
      await queue.push(1);

      const results: number[] = [];
      const push2 = queue.push(2).then(() => results.push(2));
      const push3 = queue.push(3).then(() => results.push(3));

      // Both should be blocked
      await new Promise((r) => setTimeout(r, 10));
      expect(results).toEqual([]);

      // Pop to unblock first push
      expect(await queue.pop()).toBe(1);
      await push2;
      expect(results).toEqual([2]);

      // Pop again to unblock second push
      expect(await queue.pop()).toBe(2);
      await push3;
      expect(results).toEqual([2, 3]);
    });

    it('handles multiple blocked pops', async () => {
      const queue = new AsyncQueue<number>();

      const pop1 = queue.pop();
      const pop2 = queue.pop();

      await queue.push(10);
      await queue.push(20);

      expect(await pop1).toBe(10);
      expect(await pop2).toBe(20);
    });
  });

  describe('close', () => {
    it('returns undefined from pop when closed and empty', async () => {
      const queue = new AsyncQueue<number>();
      queue.close();
      expect(await queue.pop()).toBe(undefined);
    });

    it('drains remaining items before returning undefined', async () => {
      const queue = new AsyncQueue<number>();
      await queue.push(1);
      await queue.push(2);
      queue.close();

      expect(await queue.pop()).toBe(1);
      expect(await queue.pop()).toBe(2);
      expect(await queue.pop()).toBe(undefined);
    });

    it('unblocks waiting pops with undefined', async () => {
      const queue = new AsyncQueue<number>();

      const popPromise = queue.pop();

      // Give time for pop to block
      await new Promise((r) => setTimeout(r, 10));

      queue.close();
      expect(await popPromise).toBe(undefined);
    });

    it('throws when pushing to closed queue', async () => {
      const queue = new AsyncQueue<number>();
      queue.close();

      await expect(queue.push(1)).rejects.toThrow('Cannot push to closed queue');
    });

    it('throws when push is blocked and queue closes', async () => {
      const queue = new AsyncQueue<number>(1);
      await queue.push(1);

      const pushPromise = queue.push(2);

      // Give time for push to block
      await new Promise((r) => setTimeout(r, 10));

      queue.close();
      await expect(pushPromise).rejects.toThrow('Cannot push to closed queue');
    });

    it('isClosed returns correct state', () => {
      const queue = new AsyncQueue<number>();
      expect(queue.isClosed()).toBe(false);
      queue.close();
      expect(queue.isClosed()).toBe(true);
    });
  });

  describe('async iterator', () => {
    it('iterates over all items until closed', async () => {
      const queue = new AsyncQueue<number>();

      // Producer
      const producer = async () => {
        await queue.push(1);
        await queue.push(2);
        await queue.push(3);
        queue.close();
      };

      // Consumer
      const results: number[] = [];
      const consumer = async () => {
        for await (const item of queue) {
          results.push(item);
        }
      };

      await Promise.all([producer(), consumer()]);
      expect(results).toEqual([1, 2, 3]);
    });

    it('handles empty queue that closes immediately', async () => {
      const queue = new AsyncQueue<number>();
      queue.close();

      const results: number[] = [];
      for await (const item of queue) {
        results.push(item);
      }
      expect(results).toEqual([]);
    });

    it('supports concurrent producer-consumer pattern', async () => {
      const queue = new AsyncQueue<number>(2);
      const produced: number[] = [];
      const consumed: number[] = [];

      // Producer - generates items faster than buffer allows
      const producer = async () => {
        for (let i = 0; i < 10; i++) {
          await queue.push(i);
          produced.push(i);
        }
        queue.close();
      };

      // Consumer - processes items with small delay
      const consumer = async () => {
        for await (const item of queue) {
          consumed.push(item);
        }
      };

      await Promise.all([producer(), consumer()]);

      expect(produced).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(consumed).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });
  });

  describe('length', () => {
    it('tracks queue length correctly', async () => {
      const queue = new AsyncQueue<number>();
      expect(queue.length).toBe(0);

      await queue.push(1);
      expect(queue.length).toBe(1);

      await queue.push(2);
      expect(queue.length).toBe(2);

      await queue.pop();
      expect(queue.length).toBe(1);

      await queue.pop();
      expect(queue.length).toBe(0);
    });
  });
});
