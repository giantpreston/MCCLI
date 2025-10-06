/**
 * MCCLI v1.1.1_rc1 – Release Candidate Build
 * Improvements:
 *  - Suppress stack traces by default
 *  - Fixed chat/signature error handling (bot won't hang)
 *  - Robust connection error handling
 *  - Consistent padded log tags, prompt-safe output
 *  - RC/pre-release version check restored
 */

const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const minecraftData = require('minecraft-data');
const readline = require('readline');
const chalk = require('chalk');
const axios = require('axios');

const currentVersion = '1.1.1_rc1';
const versionURL = 'https://raw.githubusercontent.com/giantpreston/MCCLI/refs/heads/main/info/version.txt';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> ',
});

/** Centralized colored logger (prompt-safe) */
function log(level, msg) {
  const colors = {
    info: chalk.cyan,
    warn: chalk.yellow,
    error: chalk.red,
    success: chalk.green,
    chat: chalk.whiteBright,
    event: chalk.magenta,
  };
  const tag = level.toUpperCase().padEnd(5).replace(" ", "");
  const line = colors[level] ? colors[level](`[${tag}] ${msg.trim()}`) : `[${tag}] ${msg.trim()}`;

  process.stdout.clearLine(0);
  process.stdout.cursorTo(0);
  console.log(line);
  rl.prompt(true);
}

/** Check for version updates (includes RC & PR detection) */
async function checkForUpdate() {
  try {
    const res = await axios.get(versionURL);
    const latest = res.data.trim();

    if (currentVersion.includes('pr')) {
      log('warn', '⚠️  You are running a pre-release build of MCCLI; bugs may occur.');
    } else if (currentVersion.includes('_rc')) {
      log('info', 'ℹ️  This is a release-candidate build (_rc). Some minor issues may exist.');
    } else if (latest !== currentVersion) {
      log('error', `Outdated MCCLI! Latest is v${latest}. Get it from github.com/giantpreston/MCCLI`);
    } else {
      log('success', `Running latest version: v${currentVersion}`);
    }
  } catch (err) {
    log('warn', `Failed to check for updates: ${err.message}`);
  }
}

/** BotController – handles bot state and actions */
class BotController {
  constructor() {
    this.bot = null;
    this.connected = false;
    this.autoReconnect = false;
    this.lastHost = null;
    this.lastPort = null;
    this.lastVersion = null;
  }

  /** Create and connect bot */
  async connect(host, port = 25565, version) {
    if (this.connected) return log('error', 'Bot already connected.');
    if (!host) return log('warn', 'Usage: join <ip> [port|version] [version]');

    this.lastHost = host;
    this.lastPort = port;
    this.lastVersion = version;

    log('info', `🔌 Connecting to ${chalk.yellow(host)}:${chalk.yellow(port)} ${version ? `(v${version})` : ''}`);

    return new Promise((resolve) => {
      const bot = mineflayer.createBot({ host, port, version, auth: 'microsoft' });
      this.bot = bot;
      this.connected = false;
      bot.loadPlugin(pathfinder);

      const handleError = (err) => {
        if (!this.connected) log('error', `❌ ${err.message}`);
        this.cleanup();
        resolve(); // resolve to prevent hanging
      };

      bot.once('spawn', () => {
        this.connected = true;
        const pos = bot.entity.position;
        log('success', `🎮 Spawned at ${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}`);
        resolve();
      });

      bot.on('chat', (user, msg) => {
        if (user && user !== bot.username) log('chat', `${chalk.blue(user)}: ${msg}`);
      });

      bot.on('message', (msg) => {
        const clean = msg.toString().trim().replace(/\s+/g, ' ');
        log('event', `[srv msg] ${clean}`);
      });

      bot.on('kicked', (reason) => {
        log('error', `⬅️ Kicked: ${reason?.text || JSON.stringify(reason)}`);
        this.cleanup();
        this.tryReconnect();
      });

      bot.on('error', handleError);

      bot.on('end', () => {
        if (this.connected) log('warn', '🔌 Disconnected.');
        this.cleanup();
        this.tryReconnect();
      });
    });
  }

  cleanup() {
    if (this.bot) {
      try { this.bot.removeAllListeners(); } catch {}
    }
    this.connected = false;
    this.bot = null;
  }

  tryReconnect() {
    if (this.autoReconnect && this.lastHost) {
      log('info', '🔄 Attempting to reconnect...');
      setTimeout(() => this.connect(this.lastHost, this.lastPort, this.lastVersion), 3000);
    }
  }

  disconnect() {
    if (!this.connected || !this.bot) return log('warn', 'No bot connected.');
    this.bot.quit('User requested disconnect');
    this.cleanup();
    log('warn', '👋 Bot disconnected manually.');
  }

  setAutoReconnect(flag) {
    this.autoReconnect = !!flag;
    log('info', `🔁 Auto-reconnect is now ${this.autoReconnect ? 'ENABLED' : 'DISABLED'}`);
  }

  say(message) {
    if (!this.connected || !this.bot) return log('warn', 'Bot not connected.');
    if (!message) return log('warn', 'Usage: say <message>');

    try {
      this.bot.chat(message.slice(0, 256), false);
    } catch (err) {
      if (err.message.includes('signature')) {
        log('warn', '⚠️ Chat failed due to signature, ignored.');
      } else {
        log('error', `Chat failed: ${err.message}`);
      }
    }
  }

  exit() { process.exit(0); }

  query(type) {
    if (!this.connected || !this.bot) return log('warn', 'Not connected.');
    if (type === 'position') {
      const p = this.bot.entity.position;
      log('info', `📍 Position: ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`);
    } else if (type === 'players') {
      log('info', '👥 Players online:');
      Object.keys(this.bot.players).forEach((p) => console.log('   - ' + chalk.cyan(p)));
      rl.prompt(true);
    } else { log('warn', 'Usage: query position | players'); }
  }

  async lookAt(x, y, z) {
    if (!this.connected || !this.bot) return log('warn', 'Not connected.');
    if (![x, y, z].every(Number.isFinite)) return log('warn', 'Usage: lookat <x> <y> <z>');
    try { await this.bot.lookAt(this.bot.vec3(x, y, z)); log('success', `👀 Looking at ${x},${y},${z}`); }
    catch (err) { log('error', `Look failed: ${err.message}`); }
  }

  goto(x, y, z) {
    if (!this.connected || !this.bot) return log('warn', 'Not connected.');
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

/** Command registry */
const commands = {
  join: async (args) => {
    const ip = args[0];
    if (!ip) return log('warn', 'Usage: join <ip> [port|version] [version]');
    let port = 25565, version;
    if (args[1]) args[1].includes('.') ? (version = args[1]) : (port = parseInt(args[1]));
    if (args[2]) version = args[2];
    await controller.connect(ip, port, version);
  },
  leave: () => controller.disconnect(),
  exit: () => controller.exit(),
  clear: () => console.clear(),
  say: (args) => controller.say(args.join(' ')),
  query: (args) => controller.query(args[0]),
  lookat: async (args) => { const [x, y, z] = args.map(Number); await controller.lookAt(x, y, z); },
  goto: (args) => { const [x, y, z] = args.map(Number); controller.goto(x, y, z); },
  autoreconnect: (args) => {
    if (!args[0]) return log('warn', 'Usage: autoreconnect true|false');
    controller.setAutoReconnect(args[0].toLowerCase() === 'true');
  },
  help: () => {
    console.log(chalk.bold('\nAvailable Commands:'));
    console.log(chalk.cyan('  join <ip> [port|version] [version] ') + '→ connect to a server');
    console.log(chalk.cyan('  leave                       ') + '→ disconnect');
    console.log(chalk.cyan('  say <message>               ') + '→ send chat message');
    console.log(chalk.cyan('  query position | players    ') + '→ show info');
    console.log(chalk.cyan('  lookat <x> <y> <z>          ') + '→ face a coordinate');
    console.log(chalk.cyan('  goto <x> <y> <z>            ') + '→ walk to coords');
    console.log(chalk.cyan('  autoreconnect true|false    ') + '→ toggle auto-reconnect');
    console.log(chalk.cyan('  exit                        ') + '→ close this program');
    console.log(chalk.cyan('  clear                       ') + '→ clear your console');
    console.log(chalk.cyan('  help                        ') + '→ show this help\n');
    rl.prompt(true);
  },
};

/** Command handler */
async function handleCommand(input) {
  const [cmd, ...args] = input.trim().split(' ');
  if (!cmd) return;
  const fn = commands[cmd.toLowerCase()];
  if (!fn) return log('warn', `Unknown command: ${cmd}`);
  try { await fn(args); }
  catch (e) { log('error', `Command failed: ${e.message}`); }
}

/** Global unhandled error catcher */
process.on('unhandledRejection', (err) => { log('error', `Unhandled rejection: ${err.message}`); });
process.on('uncaughtException', (err) => { log('error', `Uncaught exception: ${err.message}`); });

/** Program entry point */
(async function init() {
  await checkForUpdate();
  log('success', `Welcome to MCCLI v${currentVersion}`);
  log('success', 'Type "help" for commands.');
  rl.prompt();

  rl.on('line', async (line) => { await handleCommand(line); rl.prompt(); });
  rl.on('SIGINT', () => { controller.disconnect(); process.exit(0); });
})();
