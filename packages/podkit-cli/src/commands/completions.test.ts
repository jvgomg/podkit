import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Command, Option } from 'commander';
import {
  generateZshCompletions,
  generateBashCompletions,
  detectShell,
  isAlreadyInstalled,
  buildConfigBlock,
  completeCommand,
  loadCompletionConfig,
  completionsCommand,
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
    .option('-c, --collection <name>', 'collection name')
    .addOption(new Option('-t, --type <type>', 'content type').choices(['music', 'video']))
    .addOption(
      new Option('--quality <preset>', 'quality preset').choices(['max', 'high', 'medium', 'low'])
    );

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

      // --device uses dynamic completion, not generic ': : '
      expect(output).toContain('_podkit_devices');
      // --verbose is a boolean flag, no argument suffix
      expect(output).not.toMatch(/--verbose'\[.*\]: : '/);
    });

    it('escapes colons in descriptions', () => {
      const program = new Command();
      program.name('test');
      program.command('foo').description('does thing: very well');
      const output = generateZshCompletions(program);

      expect(output).toContain('does thing\\: very well');
    });

    it('includes choices for options with argChoices', () => {
      const program = createTestProgram();
      const output = generateZshCompletions(program);

      expect(output).toContain(':(music video)');
      expect(output).toContain(':(max high medium low)');
    });

    it('includes dynamic completion helpers', () => {
      const program = createTestProgram();
      const output = generateZshCompletions(program);

      expect(output).toContain('_podkit_devices()');
      expect(output).toContain('_podkit_collections()');
      expect(output).toContain('__complete devices');
      expect(output).toContain('__complete collections');
    });

    it('uses dynamic completion for --device option', () => {
      const program = createTestProgram();
      const output = generateZshCompletions(program);

      expect(output).toContain(': :_podkit_devices');
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

    it('completes argument values for options with choices', () => {
      const program = createTestProgram();
      const output = generateBashCompletions(program);

      expect(output).toContain('case "$prev" in');
      expect(output).toContain('max high medium low');
      expect(output).toContain('music video');
    });

    it('includes dynamic completion for device and collection', () => {
      const program = createTestProgram();
      const output = generateBashCompletions(program);

      expect(output).toContain('__complete devices');
      expect(output).toContain('__complete collections');
    });
  });

  describe('function prefix from --cmd', () => {
    it('uses _podkit prefix by default (zsh)', () => {
      const program = createTestProgram();
      const output = generateZshCompletions(program);
      expect(output).toContain('_podkit()');
      expect(output).toContain('compdef _podkit podkit');
    });

    it('derives _podkit_dev prefix from --cmd podkit-dev (zsh)', () => {
      const program = createTestProgram();
      const output = generateZshCompletions(program, 'podkit-dev');
      expect(output).toContain('_podkit_dev()');
      expect(output).toContain('compdef _podkit_dev podkit-dev');
      expect(output).not.toContain('_podkit()');
      expect(output).not.toContain('compdef _podkit_dev podkit\n');
    });

    it('uses _podkit prefix for multi-word bun run cmd (zsh)', () => {
      const program = createTestProgram();
      const output = generateZshCompletions(program, 'bun run podkit');
      expect(output).toContain('_podkit()');
      expect(output).toContain('compdef _podkit podkit');
    });

    it('derives _podkit_dev prefix from --cmd podkit-dev (bash)', () => {
      const program = createTestProgram();
      const output = generateBashCompletions(program, 'podkit-dev');
      expect(output).toContain('_podkit_dev()');
      expect(output).toContain('complete -F _podkit_dev podkit-dev');
      expect(output).not.toContain('_podkit()');
    });

    it('renames dynamic helpers to match prefix (zsh)', () => {
      const program = createTestProgram();
      const output = generateZshCompletions(program, 'podkit-dev');
      expect(output).toContain('_podkit_dev_devices()');
      expect(output).toContain('_podkit_dev_collections()');
      expect(output).not.toContain('_podkit_devices()');
    });
  });

  describe('__complete command', () => {
    it('has expected subcommands', () => {
      expect(completeCommand.name()).toBe('__complete');
      expect(completeCommand.commands.map((c) => c.name())).toContain('devices');
      expect(completeCommand.commands.map((c) => c.name())).toContain('collections');
      expect(completeCommand.commands.map((c) => c.name())).toContain('music-collections');
      expect(completeCommand.commands.map((c) => c.name())).toContain('video-collections');
    });
  });

  describe('loadCompletionConfig', () => {
    it('returns undefined when config does not exist', () => {
      const originalEnv = process.env.PODKIT_CONFIG;
      process.env.PODKIT_CONFIG = '/nonexistent/path/config.toml';
      try {
        const result = loadCompletionConfig();
        expect(result).toBeUndefined();
      } finally {
        if (originalEnv !== undefined) {
          process.env.PODKIT_CONFIG = originalEnv;
        } else {
          delete process.env.PODKIT_CONFIG;
        }
      }
    });

    it('parses device and collection names from config', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'podkit-complete-test-'));
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(
        configPath,
        `
[music.main]
path = "/music"

[video.shows]
path = "/video"

[devices.terapod]
volumeUuid = "ABC-123"
`
      );
      const originalEnv = process.env.PODKIT_CONFIG;
      process.env.PODKIT_CONFIG = configPath;
      try {
        const result = loadCompletionConfig();
        expect(result).toBeDefined();
        expect(Object.keys(result!.music)).toEqual(['main']);
        expect(Object.keys(result!.video)).toEqual(['shows']);
        expect(Object.keys(result!.devices)).toEqual(['terapod']);
      } finally {
        if (originalEnv !== undefined) {
          process.env.PODKIT_CONFIG = originalEnv;
        } else {
          delete process.env.PODKIT_CONFIG;
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
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

    it('returns false for alias check when only production completions exist', () => {
      const configFile = path.join(tempDir, '.zshrc');
      fs.writeFileSync(configFile, '# stuff\nsource <(podkit completions zsh)\n# more stuff\n');

      expect(isAlreadyInstalled(configFile, 'podkit-dev')).toBe(false);
    });

    it('returns true for alias check when dev function exists', () => {
      const configFile = path.join(tempDir, '.zshrc');
      fs.writeFileSync(
        configFile,
        'source <(podkit completions zsh)\npodkit-dev() { bun run podkit "$@"; }\n'
      );

      expect(isAlreadyInstalled(configFile, 'podkit-dev')).toBe(true);
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
      const quietAlias = `bun run --silent --cwd ${cwd} podkit`;

      // Sources completions with --cmd so dynamic helpers use the dev command
      expect(block).toContain(`source <(${quietAlias} completions zsh --cmd "${quietAlias}")`);
      // Creates dev function under "pk" (not "podkit" — avoids shadowing prod binary)
      expect(block).toContain(`pk() { ${quietAlias} "$@"; }`);
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
      const quietAlias = `bun run --silent --cwd ${cwd} podkit`;

      expect(block).toContain(`source <(${quietAlias} completions bash --cmd "${quietAlias}")`);
      expect(block).toContain(`pk() { ${quietAlias} "$@"; }`);
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

    it('does not double-add --cwd to the alias command', () => {
      const block = buildConfigBlock(zshShell, 'bun run --cwd /some/path podkit');
      // The alias itself should only have --cwd once
      const funcLine = block.split('\n').find((l) => l.includes('pk()'));
      expect(funcLine).toBeDefined();
      expect(funcLine!.match(/--cwd/g)?.length).toBe(1);
    });

    it('works with non-bun alias commands', () => {
      const block = buildConfigBlock(zshShell, './bin/podkit-dev');

      expect(block).toContain(
        'source <(./bin/podkit-dev completions zsh --cmd "./bin/podkit-dev")'
      );
      expect(block).toContain('pk() { ./bin/podkit-dev "$@"; }');
      expect(block).toContain('compdef _podkit_dev pk');
    });

    it('includes the config marker comment', () => {
      const block = buildConfigBlock(zshShell);
      expect(block).toContain('# podkit shell completions');

      const aliasBlock = buildConfigBlock(zshShell, 'bun run podkit');
      expect(aliasBlock).toContain('# podkit shell completions');
    });
  });
});

describe('completions install action exit codes', () => {
  const originalShell = process.env.SHELL;
  let savedExitCode: number | undefined;

  beforeEach(() => {
    savedExitCode = process.exitCode as number | undefined;
    process.exitCode = 0;
  });

  afterEach(() => {
    process.exitCode = savedExitCode;
    if (originalShell !== undefined) {
      process.env.SHELL = originalShell;
    } else {
      delete process.env.SHELL;
    }
  });

  it('sets process.exitCode = 1 for unsupported shell', async () => {
    process.env.SHELL = '/bin/fish';

    await completionsCommand.parseAsync(['install'], { from: 'user' });

    expect(process.exitCode).toBe(1);
  });
});
