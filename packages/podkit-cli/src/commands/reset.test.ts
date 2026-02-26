import { describe, expect, it } from 'bun:test';
import { resetCommand } from './reset.js';

describe('reset command', () => {
  describe('command structure', () => {
    it('has correct name', () => {
      expect(resetCommand.name()).toBe('reset');
    });

    it('has description', () => {
      expect(resetCommand.description()).toBeTruthy();
      expect(resetCommand.description()).toContain('remove');
    });

    it('has --confirm option', () => {
      const confirmOption = resetCommand.options.find(
        (opt) => opt.long === '--confirm'
      );
      expect(confirmOption).toBeDefined();
    });

    it('has --dry-run option', () => {
      const dryRunOption = resetCommand.options.find(
        (opt) => opt.long === '--dry-run'
      );
      expect(dryRunOption).toBeDefined();
    });
  });
});
