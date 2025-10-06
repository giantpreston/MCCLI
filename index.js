/**
 * MCCLI v1.1.1pr
 * Modular rewrite of v1.0.0 for maintainability, clarity, and scalability.
 * Added "_rc" (release candidate) check in version handler.
 */

const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const minecraftData = require('minecraft-data');
const readline = require('readline');
const chalk = require('chalk');
const axios = require('axios');

const currentVersion = '1.1.1_pr1';
const versionURL = 'https://raw.githubusercontent.com/giantpreston/MCCLI/refs/heads/main/info/version.txt';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> ',
});

/** Centralized colored logger */
function log(level, msg) {
  const colors = {
    info: chalk.cyan,
    warn: chalk.yellow,
    error: chalk.red,
    success: chalk.green,
    chat: chalk.whiteBright,
    event: chalk.magenta,
  };
  const tag = level.toUpperCase().padEnd(6);
  console.log(colors[level] ? colors[level](`[${tag}] ${msg}`) : `[LOG] ${msg}`);
}

/** Check version info (handles pre-release and RC builds) */
async function checkForUpdate() {
  try {
    const res = await axios.get(versionURL);
    const latest = res.data.trim();

    if (currentVersion.includes('pr')) {
      log('warn', '⚠️ You are running a pre-release version of MCCLI; bugs may occur.');
    } else if (currentVersion.includes('_rc')) {
      log('info', 'ℹ️ This is a release-candidate build (_rc). Some minor issues may exist.');
    } else if (latest !== currentVersion) {
      log('error', `Outdated MCCLI! Latest is v${latest}. Get it from github.com/giantpreston/MCCLI`);
    } else {
      log('success', `Running latest version: v${currentVersion}`);
    }
  } catch (err) {
    log('warn', `Failed to check for updates: ${err.message}`);
  }
}

/** BotController – handles all bot state and actions */
class BotController {
  constructor() {
    this.bot = null;
    this.connected = false;
  }

  /** Create and connect the bot */
  async connect(host, port = 25565, version) {
    if (this.connected) return log('warn', 'Bot already connected. Use "leave" first.');
    if (!host) return log('warn', 'Usage: join <ip> [port|version] [version]');

    log('info', `🔌 Connecting to ${chalk.yellow(host)}:${chalk.yellow(port)} ${version ? `(v${version})` : ''}`);

    return new Promise((resolve) => {
      this.bot = mineflayer.createBot({ host, port, version, auth: 'microsoft' });
      this.bot.loadPlugin(pathfinder);

      this.bot.once('spawn', () => {
        this.connected = true;
        const pos = this.bot.entity.position;
        log('success', `🎮 Spawned at ${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}`);
        resolve();
      });

      this.bot.on('chat', (user, msg) => {
        if (user !== this.bot.username) log('chat', `${chalk.blue(user)}: ${msg}`);
      });

      this.bot.on('message', (msg) => {
        const text = typeof msg === 'string' ? msg : msg.toString();
        log('event', `[srv msg] ${text}`);
      });

      this.bot.on('kicked', (r) => log('error', `💀 Kicked: ${r?.text || JSON.stringify(r)}`));
      this.bot.on('error', (err) => log('error', `🔥 ${err.message}`));
      this.bot.on('end', () => {
        this.connected = false;
        this.bot = null;
        log('warn', '🔌 Disconnected.');
      });
    });
  }

  /** Disconnect the bot */
  disconnect() {
    if (!this.connected || !this.bot) return log('warn', 'No bot connected.');
    this.bot.quit('User requested disconnect');
    this.connected = false;
    this.bot = null;
    log('warn', '👋 Bot disconnected manually.');
  }

  /** Send chat message */
  say(message) {
    if (!this.connected) return log('warn', 'Bot not connected.');
    if (!message) return log('warn', 'Usage: say <message>');
    try {
      this.bot.chat(message.slice(0, 256));
      log('info', `📢 You said: ${chalk.green(message)}`);
    } catch (err) {
      log('error', `Chat failed: ${err.message}`);
    }
  }

  /** Query info */
  query(type) {
    if (!this.connected) return log('warn', 'Not connected.');
    if (type === 'position') {
      const p = this.bot.entity.position;
      log('info', `📍 Position: ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`);
    } else if (type === 'players') {
      log('info', `👥 Players online:`);
      Object.keys(this.bot.players).forEach(p => console.log('   - ' + chalk.cyan(p)));
    } else {
      log('warn', 'Usage: query position | players');
    }
  }

  /** Look at coordinates */
  async lookAt(x, y, z) {
    if (!this.connected) return log('warn', 'Not connected.');
    if (![x, y, z].every(Number.isFinite)) return log('warn', 'Usage: lookat <x> <y> <z>');
    try {
      const vec3 = this.bot.vec3(x, y, z);
      await this.bot.lookAt(vec3);
      log('success', `👀 Looking at ${x},${y},${z}`);
    } catch (e) {
      log('error', `Look failed: ${e.message}`);
    }
  }

  /** Move to coordinates */
  goto(x, y, z) {
    if (!this.connected) return log('warn', 'Not connected.');
    if (![x, y, z].every(Number.isFinite)) return log('warn', 'Usage: goto <x> <y> <z>');
    const mcData = minecraftData(this.bot.version);
    const goal = new goals.GoalBlock(x, y, z);
    const move = new Movements(this.bot, mcData);
    this.bot.pathfinder.setMovements(move);
    this.bot.pathfinder.setGoal(goal);
    log('info', `🧭 Moving to ${x},${y},${z}`);
  }
}

const controller = new BotController();

/** Command registry for cleaner extensibility */
const commands = {
  join: async (args) => {
    const ip = args[0];
    let port = 25565, version;
    if (args[1]) args[1].includes('.') ? version = args[1] : port = parseInt(args[1]);
    if (args[2]) version = args[2];
    await controller.connect(ip, port, version);
  },
  leave: () => controller.disconnect(),
  say: (args) => controller.say(args.join(' ')),
  query: (args) => controller.query(args[0]),
  lookat: async (args) => {
    const [x, y, z] = args.map(Number);
    await controller.lookAt(x, y, z);
  },
  goto: (args) => {
    const [x, y, z] = args.map(Number);
    controller.goto(x, y, z);
  },
  help: () => {
    console.log(chalk.bold('\nAvailable Commands:'));
    console.log(chalk.cyan('  join <ip> [port|version] [version] ') + '→ connect to a server');
    console.log(chalk.cyan('  leave                       ') + '→ disconnect');
    console.log(chalk.cyan('  say <message>               ') + '→ send chat message');
    console.log(chalk.cyan('  query position | players    ') + '→ show info');
    console.log(chalk.cyan('  lookat <x> <y> <z>          ') + '→ face a coordinate');
    console.log(chalk.cyan('  goto <x> <y> <z>            ') + '→ walk to coords');
    console.log(chalk.cyan('  help                        ') + '→ show this help\n');
  },
};

/** Handle user command */
async function handleCommand(input) {
  const [cmd, ...args] = input.trim().split(' ');
  if (!cmd) return;
  const fn = commands[cmd.toLowerCase()];
  if (!fn) return log('warn', `Unknown command: ${cmd}`);
  try {
    await fn(args);
  } catch (e) {
    log('error', `Command failed: ${e.message}`);
  }
}

/** Program entry point */
async function init() {
  await checkForUpdate();
  log('success', `Welcome to MCCLI v${currentVersion}`);
  log('success', 'Type "help" for commands.');
  rl.prompt();

  rl.on('line', async line => {
    await handleCommand(line);
    rl.prompt();
  });

  rl.on('SIGINT', () => {
    controller.disconnect();
    process.exit(0);
  });
}

init();
