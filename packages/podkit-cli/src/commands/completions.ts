/**
 * Completions command - generate and install shell completion scripts
 *
 * Generates completion scripts by walking the Commander.js command tree,
 * so completions stay in sync with the actual CLI structure automatically.
 *
 * @example
 * ```bash
 * podkit completions zsh              # Print zsh completion script
 * podkit completions bash             # Print bash completion script
 * podkit completions install          # Show install instructions for current shell
 * podkit completions install --append # Append to shell config automatically
 * ```
 */
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { Command } from 'commander';
import { parse as parseTOML } from 'smol-toml';
import { DEFAULT_CONFIG_PATH } from '../config/index.js';

/** Marker comment used to identify the completions line in shell config files */
const CONFIG_MARKER = '# podkit shell completions';

/**
 * Derive the shell function prefix from the invoke command.
 * Uses the last word as the binary name so multi-word commands like
 * "bun run podkit" still produce _podkit, while "podkit-dev" produces _podkit_dev.
 *
 * Examples:
 *   'podkit'         → '_podkit'
 *   'podkit-dev'     → '_podkit_dev'
 *   'bun run podkit' → '_podkit'
 */
function funcPrefixFromCmd(invokeCmd: string): string {
  const lastWord = invokeCmd.trim().split(/\s+/).at(-1) ?? 'podkit';
  return '_' + path.basename(lastWord).replace(/-/g, '_');
}

/** Extract the binary name from an invoke command (last word, basename only). */
function binaryFromCmd(invokeCmd: string): string {
  const lastWord = invokeCmd.trim().split(/\s+/).at(-1) ?? 'podkit';
  return path.basename(lastWord);
}

/**
 * Post-process a generated completion script to apply a non-default invoke command.
 * Renames all _podkit* identifiers to the derived prefix and fixes the shell binding line.
 */
function applyInvokeCmd(script: string, invokeCmd: string, bindingPrefix: string): string {
  const prefix = funcPrefixFromCmd(invokeCmd);
  const binary = binaryFromCmd(invokeCmd);
  return script
    .replace(/_podkit/g, prefix)
    .replace(`${bindingPrefix} ${prefix} podkit`, `${bindingPrefix} ${prefix} ${binary}`);
}

export interface ShellInfo {
  name: 'zsh' | 'bash';
  configFile: string;
  sourceLine: string;
}

/**
 * Build the config block to append to a shell config file.
 *
 * When aliasCmd is provided (e.g. "bun run podkit"), generates a shell function
 * that wraps the alias and wires up completions to it:
 *
 *   source <(bun run podkit completions zsh)
 *   podkit() { bun run podkit "$@"; }
 *   compdef _podkit podkit       # zsh only
 *
 * Without aliasCmd, just generates the standard source line:
 *
 *   source <(podkit completions zsh)
 */
export function buildConfigBlock(shell: ShellInfo, aliasCmd?: string, aliasName?: string): string {
  if (!aliasCmd) {
    return configLine(shell.sourceLine);
  }

  const name = aliasName || 'pk';
  const quietAlias = normalizeBunRun(aliasCmd);

  // Source completions via the alias command (works without podkit on PATH).
  // The sourced script registers _podkit for "podkit", so prod completions
  // work when the binary is on PATH. We additionally create a dev function
  // under a separate name (default "pk") so dev and prod don't conflict.
  const sourceLine = `source <(${quietAlias} completions ${shell.name} --cmd "${quietAlias}")`;
  const funcLine = `${name}() { ${quietAlias} "$@"; }`;

  const aliasPrefix = funcPrefixFromCmd(quietAlias);
  const compLine =
    shell.name === 'zsh' ? `compdef ${aliasPrefix} ${name}` : `complete -F ${aliasPrefix} ${name}`;

  const lines = ['', CONFIG_MARKER, sourceLine, funcLine, compLine, ''];

  return lines.join('\n');
}

/**
 * Normalize a "bun run" alias for use in shell config:
 * - Adds --silent to suppress the command echo that bun prints to stdout
 *   (without this, the echoed line corrupts the completion script when sourced)
 * - Adds --cwd to anchor to the current directory, so the alias works
 *   regardless of where the user opens their shell
 */
function normalizeBunRun(cmd: string): string {
  if (!cmd.startsWith('bun run')) return cmd;

  let result = cmd;

  if (!result.includes('--silent')) {
    result = result.replace(/^bun run/, 'bun run --silent');
  }

  if (!result.includes('--cwd')) {
    result = result.replace(/^bun run --silent/, `bun run --silent --cwd ${process.cwd()}`);
  }

  return result;
}

/**
 * Detect the user's current shell and return config info.
 * Uses $SHELL (login shell), which is the right choice for config file setup.
 */
export function detectShell(): ShellInfo | null {
  const shell = process.env.SHELL || '';
  const shellName = path.basename(shell);
  const home = os.homedir();

  switch (shellName) {
    case 'zsh':
      return {
        name: 'zsh',
        configFile: path.join(home, '.zshrc'),
        sourceLine: 'source <(podkit completions zsh)',
      };
    case 'bash': {
      // macOS uses .bash_profile for login shells, Linux uses .bashrc
      const configFile =
        process.platform === 'darwin'
          ? path.join(home, '.bash_profile')
          : path.join(home, '.bashrc');
      return {
        name: 'bash',
        configFile,
        sourceLine: 'source <(podkit completions bash)',
      };
    }
    default:
      return null;
  }
}

/**
 * Check if completions are already installed in a config file.
 */
export function isAlreadyInstalled(configFile: string, aliasName?: string): boolean {
  try {
    const content = fs.readFileSync(configFile, 'utf-8');
    if (aliasName) {
      // Check for the dev function specifically (e.g. "podkit-dev() {")
      return content.includes(`${aliasName}() {`);
    }
    // Check for the standard source line (but not a dev alias source line)
    return content.includes('podkit completions');
  } catch {
    return false;
  }
}

/**
 * Format the line to append to the shell config file.
 */
function configLine(sourceLine: string): string {
  return `\n${CONFIG_MARKER}\n${sourceLine}\n`;
}

export const completionsCommand = new Command('completions').description(
  'Generate shell completion scripts'
);

completionsCommand
  .command('zsh')
  .description('Print zsh completion script')
  .option('--cmd <command>', 'CLI command for dynamic completions (default: podkit)')
  .action((opts: { cmd?: string }) => {
    const rootCommand = getRootCommand();
    console.log(generateZshCompletions(rootCommand, opts.cmd || detectInvokeCommand()));
  });

completionsCommand
  .command('bash')
  .description('Print bash completion script')
  .option('--cmd <command>', 'CLI command for dynamic completions (default: podkit)')
  .action((opts: { cmd?: string }) => {
    const rootCommand = getRootCommand();
    console.log(generateBashCompletions(rootCommand, opts.cmd || detectInvokeCommand()));
  });

completionsCommand
  .command('install')
  .description('Show or apply shell completion setup for your current shell')
  .option('--append', 'Append the source line to your shell config file')
  .option(
    '--alias <command>',
    'Create a dev shell function wrapping this command (e.g. "bun run podkit")'
  )
  .option('--name <name>', 'Name for the dev function (default: pk)', 'pk')
  .action((opts: { append?: boolean; alias?: string; name: string }) => {
    const shell = detectShell();

    if (!shell) {
      const shellEnv = process.env.SHELL || '(not set)';
      console.error(`Unsupported shell: ${shellEnv}`);
      console.error('Supported shells: zsh, bash');
      console.error('');
      console.error('You can still generate completions manually:');
      console.error('  podkit completions zsh');
      console.error('  podkit completions bash');
      process.exit(1);
    }

    const aliasName = opts.alias ? opts.name : undefined;
    const block = buildConfigBlock(shell, opts.alias, aliasName);
    const displayLines = block
      .trim()
      .split('\n')
      .filter((l) => !l.startsWith('#'));

    if (opts.append) {
      if (isAlreadyInstalled(shell.configFile, aliasName)) {
        console.log(`Completions are already installed in ${shell.configFile}`);
        return;
      }

      try {
        fs.appendFileSync(shell.configFile, block);
        console.log(`Added to ${shell.configFile}:`);
        for (const line of displayLines) {
          console.log(`  ${line}`);
        }
        console.log('');
        console.log(`Restart your shell or run: source ${shell.configFile}`);
      } catch (err: any) {
        console.error(`Failed to write to ${shell.configFile}: ${err.message}`);
        process.exit(1);
      }
    } else {
      if (isAlreadyInstalled(shell.configFile, aliasName)) {
        console.log(`Completions are already installed in ${shell.configFile}`);
        console.log('');
        console.log(`If completions aren't working, restart your shell or run:`);
        console.log(`  source ${shell.configFile}`);
        return;
      }

      console.log(`Detected shell: ${shell.name}`);
      console.log(`Config file: ${shell.configFile}`);
      console.log('');
      console.log('Add these lines to your shell config:');
      for (const line of displayLines) {
        console.log(`  ${line}`);
      }
      console.log('');
      let appendCmd = 'podkit completions install --append';
      if (opts.alias) {
        appendCmd += ` --alias "${opts.alias}"`;
        if (opts.name !== 'pk') {
          appendCmd += ` --name "${opts.name}"`;
        }
      }
      console.log('Or run this to do it automatically:');
      console.log(`  ${appendCmd}`);
    }
  });

function getRootCommand(): Command {
  const rootCommand = completionsCommand.parent;
  if (!rootCommand) {
    console.error('Error: completions command must be attached to a parent program');
    process.exit(1);
  }
  return rootCommand;
}

/**
 * Detect the command used to invoke the CLI, for use in generated completion scripts.
 *
 * Uses the basename of the binary (e.g. 'podkit-dev' for /Users/x/.local/bin/podkit-dev),
 * or detects 'bun run' invocations and reconstructs the full command.
 */
export function detectInvokeCommand(): string {
  const args = process.argv;

  // Bun run: argv = ['bun', 'run', '--silent', '--cwd', '/path', 'podkit', 'completions', 'zsh']
  const bunIndex = args.findIndex((a) => a.endsWith('/bun') || a === 'bun');
  if (bunIndex >= 0 && args[bunIndex + 1] === 'run') {
    const completionsIndex = args.indexOf('completions');
    if (completionsIndex > bunIndex) {
      return args.slice(bunIndex, completionsIndex).join(' ');
    }
  }

  // Compiled binary: Bun reports argv[0] as 'bun', not the actual binary name.
  // Fall back to 'podkit' — callers can override via --cmd for non-standard names.
  return 'podkit';
}

// --- Completion script generation ---

interface CommandInfo {
  name: string;
  description: string;
  options: OptionInfo[];
  subcommands: CommandInfo[];
  aliases: string[];
}

interface OptionInfo {
  flags: string;
  description: string;
  long?: string;
  short?: string;
  takesArg: boolean;
  choices?: string[];
  dynamicCompletion?: 'devices' | 'collections';
}

function extractCommandTree(cmd: Command): CommandInfo {
  const options: OptionInfo[] = cmd.options.map((opt: any) => {
    const info: OptionInfo = {
      flags: opt.flags,
      description: opt.description || '',
      long: opt.long,
      short: opt.short,
      takesArg: opt.required || opt.optional || false,
    };
    if (opt.argChoices) {
      info.choices = opt.argChoices;
    }
    if (info.long === '--device') {
      info.dynamicCompletion = 'devices';
    } else if (info.long === '--collection') {
      info.dynamicCompletion = 'collections';
    }
    return info;
  });

  const subcommands: CommandInfo[] = cmd.commands
    .filter((sub: Command) => sub.name() !== 'completions' && sub.name() !== '__complete')
    .map((sub: Command) => extractCommandTree(sub));

  return {
    name: cmd.name(),
    description: cmd.description(),
    options,
    subcommands,
    aliases: cmd.aliases(),
  };
}

function zshEscape(s: string): string {
  return s.replace(/'/g, "'\\''").replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/:/g, '\\:');
}

function zshOptionSpec(opt: OptionInfo): string[] {
  const specs: string[] = [];
  const desc = zshEscape(opt.description);

  let argSuffix = '';
  if (opt.takesArg) {
    if (opt.choices) {
      argSuffix = `: :(${opt.choices.join(' ')})`;
    } else if (opt.dynamicCompletion === 'devices') {
      argSuffix = ': :_podkit_devices';
    } else if (opt.dynamicCompletion === 'collections') {
      argSuffix = ': :_podkit_collections';
    } else {
      argSuffix = ': : ';
    }
  }

  if (opt.short && opt.long) {
    specs.push(`'(${opt.short} ${opt.long})'${opt.short}'[${desc}]${argSuffix}'`);
    specs.push(`'(${opt.short} ${opt.long})'${opt.long}'[${desc}]${argSuffix}'`);
  } else if (opt.long) {
    specs.push(`'${opt.long}[${desc}]${argSuffix}'`);
  } else if (opt.short) {
    specs.push(`'${opt.short}[${desc}]${argSuffix}'`);
  }

  return specs;
}

function zshFuncName(path: string[]): string {
  return '_podkit' + (path.length > 0 ? '_' + path.join('_') : '');
}

function generateZshFunctions(cmd: CommandInfo, path: string[] = []): string[] {
  const lines: string[] = [];
  const funcName = zshFuncName(path);

  if (cmd.subcommands.length > 0) {
    lines.push(`${funcName}() {`);
    lines.push(`  local -a subcmds`);
    lines.push(`  subcmds=(`);
    for (const sub of cmd.subcommands) {
      const names = [sub.name, ...sub.aliases];
      for (const name of names) {
        lines.push(`    '${name}:${zshEscape(sub.description)}'`);
      }
    }
    lines.push(`  )`);
    lines.push(``);

    const optSpecs = cmd.options.flatMap(zshOptionSpec);

    lines.push(`  _arguments -C \\`);
    for (const spec of optSpecs) {
      lines.push(`    ${spec} \\`);
    }
    lines.push(`    '1:command:->cmd' \\`);
    lines.push(`    '*::arg:->args'`);
    lines.push(``);
    lines.push(`  case $state in`);
    lines.push(`    cmd)`);
    lines.push(`      _describe -t commands 'command' subcmds`);
    lines.push(`      ;;`);
    lines.push(`    args)`);
    lines.push(`      case $words[1] in`);
    for (const sub of cmd.subcommands) {
      const allNames = [sub.name, ...sub.aliases];
      lines.push(`        ${allNames.join('|')})`);
      lines.push(`          ${zshFuncName([...path, sub.name])}`);
      lines.push(`          ;;`);
    }
    lines.push(`      esac`);
    lines.push(`      ;;`);
    lines.push(`  esac`);
    lines.push(`}`);
    lines.push(``);

    for (const sub of cmd.subcommands) {
      lines.push(...generateZshFunctions(sub, [...path, sub.name]));
    }
  } else {
    lines.push(`${funcName}() {`);
    const optSpecs = cmd.options.flatMap(zshOptionSpec);
    if (optSpecs.length > 0) {
      lines.push(`  _arguments \\`);
      for (let i = 0; i < optSpecs.length; i++) {
        const sep = i < optSpecs.length - 1 ? ' \\' : '';
        lines.push(`    ${optSpecs[i]}${sep}`);
      }
    } else {
      lines.push(`  _arguments`);
    }
    lines.push(`}`);
    lines.push(``);
  }

  return lines;
}

export function generateZshCompletions(program: Command, invokeCmd = 'podkit'): string {
  const tree = extractCommandTree(program);
  const lines: string[] = [];

  lines.push('#compdef podkit');
  lines.push('# Auto-generated by podkit completions zsh');
  lines.push('# To activate, add to your ~/.zshrc:');
  lines.push('#   source <(podkit completions zsh)');
  lines.push('');

  // CLI command used for dynamic completions (matches whatever invoked this script)
  lines.push(`_podkit_cmd="${invokeCmd}"`);
  lines.push('');

  // Dynamic completion helpers
  lines.push('_podkit_devices() {');
  lines.push('  local -a devices');
  lines.push('  devices=(${(f)"$($_podkit_cmd __complete devices 2>/dev/null)"})');
  lines.push("  [[ ${#devices} -gt 0 ]] && _describe -t devices 'device' devices");
  lines.push('}');
  lines.push('');
  lines.push('_podkit_collections() {');
  lines.push('  local -a collections');
  lines.push('  collections=(${(f)"$($_podkit_cmd __complete collections 2>/dev/null)"})');
  lines.push("  [[ ${#collections} -gt 0 ]] && _describe -t collections 'collection' collections");
  lines.push('}');
  lines.push('');

  lines.push(...generateZshFunctions(tree));

  lines.push('compdef _podkit podkit');
  lines.push('');

  return applyInvokeCmd(lines.join('\n'), invokeCmd, 'compdef');
}

export function generateBashCompletions(program: Command, invokeCmd = 'podkit'): string {
  const tree = extractCommandTree(program);

  const lines: string[] = [];
  lines.push('# Auto-generated by podkit completions bash');
  lines.push('# To activate, add to your ~/.bashrc:');
  lines.push('#   source <(podkit completions bash)');
  lines.push('');
  lines.push(`_podkit_cmd="${invokeCmd}"`);
  lines.push('');

  const commandMap = new Map<string, { subcommands: string[]; options: string[] }>();
  collectBashCommands(tree, [], commandMap);

  lines.push('_podkit() {');
  lines.push('  local cur prev words cword');
  lines.push('  _get_comp_words_by_ref -n : cur prev words cword');
  lines.push('');
  lines.push('  # Build command path from words');
  lines.push('  local cmd_path="podkit"');
  lines.push('  local i=1');
  lines.push('  while [ $i -lt $cword ]; do');
  lines.push('    case "${words[$i]}" in');
  lines.push('      -*) ;; # skip flags');
  lines.push('      *)');
  lines.push('        cmd_path="${cmd_path} ${words[$i]}"');
  lines.push('        ;;');
  lines.push('    esac');
  lines.push('    i=$((i + 1))');
  lines.push('  done');
  lines.push('');

  // Emit argument value completions for options with known choices
  const choicesMap = new Map<string, string[]>();
  collectBashChoices(tree, choicesMap);

  // Group by identical choices to combine flags
  const choiceGroups = new Map<string, string[]>();
  for (const [flag, choices] of choicesMap) {
    const key = choices.join(' ');
    const group = choiceGroups.get(key) || [];
    group.push(flag);
    choiceGroups.set(key, group);
  }

  // Collect dynamic completions
  const dynamicMap = new Map<string, string>();
  collectBashDynamic(tree, dynamicMap);

  // Group dynamic by completion type
  const dynamicGroups = new Map<string, string[]>();
  for (const [flag, completionType] of dynamicMap) {
    const group = dynamicGroups.get(completionType) || [];
    group.push(flag);
    dynamicGroups.set(completionType, group);
  }

  if (choiceGroups.size > 0 || dynamicGroups.size > 0) {
    lines.push('  # Complete argument values for options with known choices');
    lines.push('  case "$prev" in');
    for (const [choicesKey, flags] of choiceGroups) {
      lines.push(`    ${flags.join('|')})`);
      lines.push(`      COMPREPLY=($(compgen -W "${choicesKey}" -- "$cur"))`);
      lines.push(`      return 0`);
      lines.push(`      ;;`);
    }
    for (const [completionType, flags] of dynamicGroups) {
      lines.push(`    ${flags.join('|')})`);
      lines.push(
        `      COMPREPLY=($(compgen -W "$($_podkit_cmd __complete ${completionType} 2>/dev/null)" -- "$cur"))`
      );
      lines.push(`      return 0`);
      lines.push(`      ;;`);
    }
    lines.push('  esac');
    lines.push('');
  }

  lines.push('  local completions=""');
  lines.push('  case "$cmd_path" in');

  for (const [cmdPath, info] of commandMap) {
    const words = [...info.subcommands, ...info.options].join(' ');
    lines.push(`    "${cmdPath}")`);
    lines.push(`      completions="${words}"`);
    lines.push(`      ;;`);
  }

  lines.push('  esac');
  lines.push('');
  lines.push('  COMPREPLY=($(compgen -W "$completions" -- "$cur"))');
  lines.push('  return 0');
  lines.push('}');
  lines.push('');
  lines.push('complete -F _podkit podkit');
  lines.push('');

  return applyInvokeCmd(lines.join('\n'), invokeCmd, 'complete -F');
}

function collectBashCommands(
  cmd: CommandInfo,
  path: string[],
  map: Map<string, { subcommands: string[]; options: string[] }>
): void {
  const cmdPath = ['podkit', ...path].join(' ');

  const subcommandNames = cmd.subcommands.flatMap((sub) => [sub.name, ...sub.aliases]);
  const optionNames = cmd.options.flatMap((opt) => {
    const names: string[] = [];
    if (opt.long) names.push(opt.long);
    if (opt.short) names.push(opt.short);
    return names;
  });

  map.set(cmdPath, { subcommands: subcommandNames, options: optionNames });

  for (const sub of cmd.subcommands) {
    collectBashCommands(sub, [...path, sub.name], map);
  }
}

function collectBashChoices(cmd: CommandInfo, choicesMap: Map<string, string[]>): void {
  for (const opt of cmd.options) {
    if (opt.choices && opt.choices.length > 0) {
      if (opt.long) choicesMap.set(opt.long, opt.choices);
      if (opt.short) choicesMap.set(opt.short, opt.choices);
    }
  }
  for (const sub of cmd.subcommands) {
    collectBashChoices(sub, choicesMap);
  }
}

function collectBashDynamic(cmd: CommandInfo, dynamicMap: Map<string, string>): void {
  for (const opt of cmd.options) {
    if (opt.dynamicCompletion) {
      if (opt.long) dynamicMap.set(opt.long, opt.dynamicCompletion);
      if (opt.short) dynamicMap.set(opt.short, opt.dynamicCompletion);
    }
  }
  for (const sub of cmd.subcommands) {
    collectBashDynamic(sub, dynamicMap);
  }
}

// --- Dynamic completion helpers ---

/**
 * Read the config file for completion purposes.
 * Returns the raw parsed TOML content, or undefined if unavailable.
 * This is intentionally lightweight — no validation, just key extraction.
 */
export function loadCompletionConfig(): Record<string, any> | undefined {
  try {
    const configPath = process.env.PODKIT_CONFIG ?? DEFAULT_CONFIG_PATH;
    const content = fs.readFileSync(configPath, 'utf-8');
    return parseTOML(content) as Record<string, any>;
  } catch {
    return undefined;
  }
}

export const completeCommand = new Command('__complete')
  .description('completion helper (internal)')
  .helpOption(false);

completeCommand
  .command('devices')
  .description('list device names')
  .action(() => {
    const config = loadCompletionConfig();
    if (config?.devices && typeof config.devices === 'object') {
      for (const name of Object.keys(config.devices)) {
        console.log(name);
      }
    }
  });

completeCommand
  .command('collections')
  .description('list all collection names')
  .action(() => {
    const config = loadCompletionConfig();
    const names = new Set<string>();
    if (config?.music && typeof config.music === 'object') {
      for (const name of Object.keys(config.music)) names.add(name);
    }
    if (config?.video && typeof config.video === 'object') {
      for (const name of Object.keys(config.video)) names.add(name);
    }
    for (const name of names) {
      console.log(name);
    }
  });

completeCommand
  .command('music-collections')
  .description('list music collection names')
  .action(() => {
    const config = loadCompletionConfig();
    if (config?.music && typeof config.music === 'object') {
      for (const name of Object.keys(config.music)) {
        console.log(name);
      }
    }
  });

completeCommand
  .command('video-collections')
  .description('list video collection names')
  .action(() => {
    const config = loadCompletionConfig();
    if (config?.video && typeof config.video === 'object') {
      for (const name of Object.keys(config.video)) {
        console.log(name);
      }
    }
  });
