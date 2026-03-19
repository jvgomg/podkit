import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Command } from 'commander';
import {
  generateZshCompletions,
  generateBashCompletions,
  detectShell,
  isAlreadyInstalled,
  buildConfigBlock,
} from './completions.js';

function createTestProgram(): Command {
  const program = new Command();
  program
    .name('podkit')
    .description('Modern sync for classic iPods')
    .option('-v, --verbose', 'increase verbosity')
    .option('-d, --device <name>', 'device name or path');

  program
    .command('sync')
    .description('sync collections to iPod')
    .option('-n, --dry-run', 'preview changes')
    .option('-t, --type <type>', 'content type')
    .option('--quality <preset>', 'quality preset');

  const device = program.command('device').description('manage devices');
  device.command('list').description('list devices');
  device.command('add').description('add a device').option('--path <path>', 'mount point');

  return program;
}

describe('completions', () => {
  describe('zsh generation', () => {
    it('generates valid zsh completion script', () => {
      const program = createTestProgram();
      const output = generateZshCompletions(program);

      expect(output).toContain('#compdef podkit');
      expect(output).toContain('_podkit()');
      expect(output).toContain('compdef _podkit podkit');
    });

    it('includes top-level subcommands', () => {
      const program = createTestProgram();
      const output = generateZshCompletions(program);

      expect(output).toContain("'sync:sync collections to iPod'");
      expect(output).toContain("'device:manage devices'");
    });

    it('includes nested subcommand functions', () => {
      const program = createTestProgram();
      const output = generateZshCompletions(program);

      expect(output).toContain('_podkit_device()');
      expect(output).toContain('_podkit_device_list()');
      expect(output).toContain('_podkit_device_add()');
    });

    it('includes option flags for leaf commands', () => {
      const program = createTestProgram();
      const output = generateZshCompletions(program);

      expect(output).toContain('--dry-run');
      expect(output).toContain('--quality');
    });

    it('includes global options at root level', () => {
      const program = createTestProgram();
      const output = generateZshCompletions(program);

      expect(output).toContain('--verbose');
      expect(output).toContain('--device');
    });

    it('handles options with arguments', () => {
      const program = createTestProgram();
      const output = generateZshCompletions(program);

      expect(output).toMatch(/--device'\[.*\]: : '/);
      expect(output).not.toMatch(/--verbose'\[.*\]: : '/);
    });

    it('escapes colons in descriptions', () => {
      const program = new Command();
      program.name('test');
      program.command('foo').description('does thing: very well');
      const output = generateZshCompletions(program);

      expect(output).toContain('does thing\\: very well');
    });
  });

  describe('bash generation', () => {
    it('generates valid bash completion script', () => {
      const program = createTestProgram();
      const output = generateBashCompletions(program);

      expect(output).toContain('complete -F _podkit podkit');
      expect(output).toContain('_podkit()');
    });

    it('includes subcommands in root completions', () => {
      const program = createTestProgram();
      const output = generateBashCompletions(program);

      expect(output).toMatch(/"podkit"\)\s*\n\s*completions="[^"]*sync[^"]*device/);
    });

    it('includes options in command completions', () => {
      const program = createTestProgram();
      const output = generateBashCompletions(program);

      expect(output).toContain('--dry-run');
      expect(output).toContain('--quality');
      expect(output).toContain('--verbose');
    });

    it('includes nested subcommands', () => {
      const program = createTestProgram();
      const output = generateBashCompletions(program);

      expect(output).toContain('"podkit device"');
      expect(output).toContain('"podkit device list"');
      expect(output).toContain('"podkit device add"');
    });
  });

  describe('detectShell', () => {
    const originalShell = process.env.SHELL;

    afterEach(() => {
      if (originalShell !== undefined) {
        process.env.SHELL = originalShell;
      } else {
        delete process.env.SHELL;
      }
    });

    it('detects zsh', () => {
      process.env.SHELL = '/bin/zsh';
      const result = detectShell();

      expect(result).not.toBeNull();
      expect(result!.name).toBe('zsh');
      expect(result!.configFile).toEndWith('.zshrc');
      expect(result!.sourceLine).toBe('source <(podkit completions zsh)');
    });

    it('detects bash', () => {
      process.env.SHELL = '/bin/bash';
      const result = detectShell();

      expect(result).not.toBeNull();
      expect(result!.name).toBe('bash');
      expect(result!.sourceLine).toBe('source <(podkit completions bash)');
    });

    it('returns bash config file appropriate to platform', () => {
      process.env.SHELL = '/bin/bash';
      const result = detectShell();

      expect(result).not.toBeNull();
      if (process.platform === 'darwin') {
        expect(result!.configFile).toEndWith('.bash_profile');
      } else {
        expect(result!.configFile).toEndWith('.bashrc');
      }
    });

    it('returns null for unsupported shells', () => {
      process.env.SHELL = '/bin/fish';
      expect(detectShell()).toBeNull();
    });

    it('returns null when SHELL is not set', () => {
      delete process.env.SHELL;
      expect(detectShell()).toBeNull();
    });

    it('handles paths like /usr/local/bin/zsh', () => {
      process.env.SHELL = '/usr/local/bin/zsh';
      const result = detectShell();

      expect(result).not.toBeNull();
      expect(result!.name).toBe('zsh');
    });
  });

  describe('isAlreadyInstalled', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'podkit-completions-test-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('returns true when source line is present', () => {
      const configFile = path.join(tempDir, '.zshrc');
      fs.writeFileSync(configFile, '# stuff\nsource <(podkit completions zsh)\n# more stuff\n');

      expect(isAlreadyInstalled(configFile)).toBe(true);
    });

    it('returns false when source line is absent', () => {
      const configFile = path.join(tempDir, '.zshrc');
      fs.writeFileSync(configFile, '# stuff\nexport PATH=/usr/bin\n');

      expect(isAlreadyInstalled(configFile)).toBe(false);
    });

    it('returns false when config file does not exist', () => {
      const configFile = path.join(tempDir, '.nonexistent');

      expect(isAlreadyInstalled(configFile)).toBe(false);
    });
  });

  describe('buildConfigBlock', () => {
    const zshShell: import('./completions.js').ShellInfo = {
      name: 'zsh',
      configFile: '/home/user/.zshrc',
      sourceLine: 'source <(podkit completions zsh)',
    };

    const bashShell: import('./completions.js').ShellInfo = {
      name: 'bash',
      configFile: '/home/user/.bashrc',
      sourceLine: 'source <(podkit completions bash)',
    };

    it('generates standard source line without alias', () => {
      const block = buildConfigBlock(zshShell);

      expect(block).toContain('source <(podkit completions zsh)');
      expect(block).not.toContain('podkit()');
      expect(block).not.toContain('compdef');
    });

    it('creates dev function under default name "pk" with completions', () => {
      const block = buildConfigBlock(zshShell, 'bun run podkit');
      const cwd = process.cwd();

      // Sources completions (registers _podkit for "podkit" — prod)
      expect(block).toContain(`source <(bun run --silent --cwd ${cwd} podkit completions zsh)`);
      // Creates dev function under "pk" (not "podkit" — avoids shadowing prod binary)
      expect(block).toContain(`pk() { bun run --silent --cwd ${cwd} podkit "$@"; }`);
      // Wires completions to the dev function name
      expect(block).toContain('compdef _podkit pk');
      // Does NOT create a "podkit" function
      expect(block).not.toContain('podkit()');
    });

    it('uses custom name for dev function', () => {
      const block = buildConfigBlock(zshShell, 'bun run podkit', 'pd');

      expect(block).toContain('pd() {');
      expect(block).toContain('compdef _podkit pd');
      expect(block).not.toContain('pk()');
    });

    it('generates bash complete for dev function', () => {
      const block = buildConfigBlock(bashShell, 'bun run podkit');
      const cwd = process.cwd();

      expect(block).toContain(`source <(bun run --silent --cwd ${cwd} podkit completions bash)`);
      expect(block).toContain(`pk() { bun run --silent --cwd ${cwd} podkit "$@"; }`);
      expect(block).toContain('complete -F _podkit pk');
      expect(block).not.toContain('compdef');
    });

    it('adds --silent and --cwd to bun run aliases', () => {
      const block = buildConfigBlock(zshShell, 'bun run podkit');
      expect(block).toContain('bun run --silent --cwd');
    });

    it('does not add --silent or --cwd to non-bun aliases', () => {
      const block = buildConfigBlock(zshShell, './bin/podkit-dev');
      expect(block).not.toContain('--silent');
      expect(block).not.toContain('--cwd');
    });

    it('does not double-add --silent', () => {
      const block = buildConfigBlock(zshShell, 'bun run --silent podkit');
      expect(block).not.toContain('--silent --silent');
    });

    it('does not double-add --cwd', () => {
      const block = buildConfigBlock(zshShell, 'bun run --cwd /some/path podkit');
      expect(block).toContain('--cwd /some/path');
      expect(block).not.toMatch(/--cwd.*--cwd/);
    });

    it('works with non-bun alias commands', () => {
      const block = buildConfigBlock(zshShell, './bin/podkit-dev');

      expect(block).toContain('source <(./bin/podkit-dev completions zsh)');
      expect(block).toContain('pk() { ./bin/podkit-dev "$@"; }');
    });

    it('includes the config marker comment', () => {
      const block = buildConfigBlock(zshShell);
      expect(block).toContain('# podkit shell completions');

      const aliasBlock = buildConfigBlock(zshShell, 'bun run podkit');
      expect(aliasBlock).toContain('# podkit shell completions');
    });
  });
});
