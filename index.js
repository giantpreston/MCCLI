/**
 * MCCLI v1.1.1 – Stable Release
 * 
 * Changes since v1.0.0:
 *  - Encapsulated bot in BotController class (no more global bot/connected)
 *  - Full global error handling (unhandledRejection, uncaughtException, SIGINT/SIGTERM)
 *  - Event listeners (chat, message, kicked, end) wrapped in try/catch to prevent crashes
 *  - Async timeout wrapper for critical operations (connect, etc.)
 *  - Auto-reconnect works after disconnects, crashes, or global errors; toggle via CLI
 *  - Centralized prompt-safe logging with colors for all messages
 *  - Commands refactored via registry: join, leave, say, query, lookat, goto, autoreconnect, help, exit, clear
 *  - Bot actions improved: say handles signature errors, lookAt/goto validate coordinates, query shows position/players
 *  - Version check enhanced: warns for outdated, RC, or pre-release builds
 *  - Minor CLI and stability fixes
 *  - Java Edition only (Mineflayer does not support Bedrock)
 */


const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const minecraftData = require('minecraft-data');
const readline = require('readline');
const chalk = require('chalk');
const axios = require('axios');

const currentVersion = '1.1.1';
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

/** Check for version updates */
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

/** Timeout wrapper for async operations */
async function withTimeout(promise, ms = 10000, description = 'operation') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${description} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/** Global error handler */
async function handleGlobalError(err, origin = 'unknown') {
  log('error', `Global error (${origin}): ${err?.message || err}`);

  if (controller && controller.connected) {
    try {
      log('warn', 'Attempting to safely recover the bot...');
      controller.cleanup();
      controller.tryReconnect();
    } catch (cleanupErr) {
      log('error', `Failed to recover bot: ${cleanupErr.message}`);
    }
  } else {
    log('warn', 'No bot connected, nothing to recover.');
  }
}

// Global handlers
process.on('unhandledRejection', (reason, promise) => handleGlobalError(reason, 'unhandledRejection'));
process.on('uncaughtException', (err) => handleGlobalError(err, 'uncaughtException'));
process.on('SIGINT', () => { log('warn', 'SIGINT received, cleaning up...'); controller.disconnect(); process.exit(0); });
process.on('SIGTERM', () => { log('warn', 'SIGTERM received, cleaning up...'); controller.disconnect(); process.exit(0); });

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

  async connect(host, port = 25565, version) {
    if (this.connected) return log('error', 'Bot already connected.');
    if (!host) return log('warn', 'Usage: join <ip> [port|version] [version]');

    this.lastHost = host;
    this.lastPort = port;
    this.lastVersion = version;

    log('info', `🔌 Connecting to ${chalk.yellow(host)}:${chalk.yellow(port)} ${version ? `(v${version})` : ''}`);

    return withTimeout(new Promise((resolve) => {
      try {
        const bot = mineflayer.createBot({ host, port, version, auth: 'microsoft' });
        this.bot = bot;
        this.connected = false;
        bot.loadPlugin(pathfinder);

        const handleError = (err) => {
          if (!this.connected) log('error', `❌ ${err.message}`);
          this.cleanup();
          resolve();
        };

        bot.once('spawn', () => {
          this.connected = true;
          const pos = bot.entity.position;
          log('success', `🎮 Spawned at ${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}`);
          resolve();
        });

        bot.on('chat', (user, msg) => {
          try {
            if (user && user !== bot.username) log('chat', `${chalk.blue(user)}: ${msg}`);
          } catch (err) {
            log('error', `Chat listener error: ${err.message}`);
          }
        });

        bot.on('message', (msg) => {
          try {
            const clean = msg.toString().trim().replace(/\s+/g, ' ');
            log('event', `[srv msg] ${clean}`);
          } catch (err) {
            log('error', `Message listener error: ${err.message}`);
          }
        });

        bot.on('kicked', (reason) => {
          try {
            log('error', `⬅️ Kicked: ${reason?.text || JSON.stringify(reason)}`);
            this.cleanup();
            this.tryReconnect();
          } catch (err) { handleGlobalError(err, 'kicked'); }
        });

        bot.on('error', handleError);

        bot.on('end', () => {
          try {
            if (this.connected) log('warn', '🔌 Disconnected.');
            this.cleanup();
            this.tryReconnect();
          } catch (err) { handleGlobalError(err, 'end'); }
        });

      } catch (err) {
        handleGlobalError(err, 'connect');
        resolve();
      }
    }), 15000, 'Bot connect');
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
    try { this.bot.quit('User requested disconnect'); } catch {}
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

    try { this.bot.chat(message.slice(0, 256), false); }
    catch (err) {
      if (err.message.includes('signature')) log('warn', '⚠️ Chat failed due to signature, ignored.');
      else log('error', `Chat failed: ${err.message}`);
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
  catch (e) { handleGlobalError(e, `command:${cmd}`); }
}

/** Program entry point */
(async function init() {
  await checkForUpdate();
  log('success', `Welcome to MCCLI v${currentVersion}`);
  log('success', 'Type "help" for commands.');
  rl.prompt();

  rl.on('line', async (line) => { await handleCommand(line); rl.prompt(); });
})();

