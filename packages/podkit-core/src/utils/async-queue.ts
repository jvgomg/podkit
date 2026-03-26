/**
 * Bounded async queue for pipeline synchronization.
 *
 * Provides backpressure by blocking push() when the queue is full,
 * and blocking pop() when the queue is empty. Supports async iteration.
 */
export class AsyncQueue<T> {
  private queue: T[] = [];
  private closed = false;
  private pushWaiters: Array<() => void> = [];
  private popWaiters: Array<(value: T | undefined) => void> = [];

  constructor(private maxSize: number = 3) {
    if (maxSize < 1) {
      throw new Error('AsyncQueue maxSize must be at least 1');
    }
  }

  /**
   * Push an item to the queue. Blocks if the queue is full.
   * Throws if the queue has been closed.
   */
  async push(item: T): Promise<void> {
    if (this.closed) {
      throw new Error('Cannot push to closed queue');
    }

    // Wait for space if queue is full
    while (this.queue.length >= this.maxSize) {
      await new Promise<void>((resolve) => {
        this.pushWaiters.push(resolve);
      });

      // Check if closed while waiting
      if (this.closed) {
        throw new Error('Cannot push to closed queue');
      }
    }

    this.queue.push(item);

    // Wake up a waiting consumer
    const waiter = this.popWaiters.shift();
    if (waiter) {
      waiter(this.queue.shift());
    }
  }

  /**
   * Pop an item from the queue. Blocks if the queue is empty.
   * Returns undefined if the queue is closed and empty.
   */
  async pop(): Promise<T | undefined> {
    // Return immediately if items available
    if (this.queue.length > 0) {
      const item = this.queue.shift()!;

      // Wake up a waiting producer
      const waiter = this.pushWaiters.shift();
      if (waiter) {
        waiter();
      }

      return item;
    }

    // Queue is empty - if closed, return undefined
    if (this.closed) {
      return undefined;
    }

    // Wait for an item
    return new Promise<T | undefined>((resolve) => {
      this.popWaiters.push(resolve);
    });
  }

  /**
   * Close the queue. No more items can be pushed.
   * Consumers will receive undefined after draining remaining items.
   */
  close(): void {
    this.closed = true;

    // Wake up all waiting consumers with undefined
    for (const waiter of this.popWaiters) {
      waiter(undefined);
    }
    this.popWaiters = [];

    // Wake up all waiting producers (they'll get an error on next push attempt)
    for (const waiter of this.pushWaiters) {
      waiter();
    }
    this.pushWaiters = [];
  }

  /**
   * Check if the queue has been closed.
   */
  isClosed(): boolean {
    return this.closed;
  }

  /**
   * Get the current number of items in the queue.
   */
  get length(): number {
    return this.queue.length;
  }

  /**
   * Async iterator support for consuming the queue.
   * Iterates until the queue is closed and empty.
   */
  async *[Symbol.asyncIterator](): AsyncIterableIterator<T> {
    while (true) {
      const item = await this.pop();
      if (item === undefined) {
        return;
      }
      yield item;
    }
  }
}
