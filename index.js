const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const minecraftData = require('minecraft-data');
const readline = require('readline');
const chalk = require('chalk');
const axios = require('axios');  // For fetching version from GitHub

let bot = null;
let connected = false;
let currentVersion = '1.0.0';  // Set your current MCCLI version here
const versionURL = 'https://raw.githubusercontent.com/giantpreston/MCCLI/refs/heads/main/info/version.txt';  // GitHub raw file URL

// CLI setup
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> ',
});

// Logger helper
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

// Function to check for updates
async function checkForUpdate() {
  try {
    const response = await axios.get(versionURL);
    const latestVersion = response.data.trim(); // Get the version from GitHub
    
    // Compare versions (you can use semantic versioning if needed)
    if (currentVersion.includes("pr")) {
      log('warn', `You are running a pre-release version of MCCLI, you may encounter bugs. Report them on the github.`);
    } else if (currentVersion !== latestVersion) {
      log('error', `Outdated MCCLI version! The latest version is v${latestVersion}. Update by getting that version at github.com/giantpreston/MCCLI`);
    } else {
      log('success', `You are running the latest version of MCCLI!`);
    }

    return latestVersion;
  } catch (error) {
    log('warn', `Failed to check for updates: ${error.message}`);
    return null;
  }
}

// Create bot
function createBot(host, port = 25565, version) {
  return new Promise((resolve, reject) => {
    if (bot) return reject(log('warn', 'Bot already connected. Use "leave" first.'));

    log('info', `🔌 Connecting to ${chalk.yellow(host)}:${chalk.yellow(port)} ${version ? `(version: ${chalk.green(version)})` : ''}`);
    bot = mineflayer.createBot({ host, port, version, auth: 'microsoft' });
    bot.loadPlugin(pathfinder);

    bot.once('spawn', () => {
      connected = true;
      const pos = bot.entity.position;
      log('success', `🎮 Bot spawned at ${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}`);
      resolve(bot);
    });

    // Log chat messages
    bot.on('chat', (username, message) => {
      if (username !== bot.username) log('chat', `${chalk.blue(username)}: ${message}`);
    });

    // Log JSON/server messages
    bot.on('message', (msg) => {
      try {
        const text = typeof msg === 'string' ? msg : msg.toString();
        log('event', `[srv msg] ${text}`);
      } catch (e) {
        log('warn', `Failed to parse server message: ${e.message}`);
      }
    });

    // Handle kicks gracefully
    bot.on('kicked', reason => log('error', `💀 Kicked: ${reason?.text || JSON.stringify(reason)}`));
    bot.on('end', () => {
      connected = false;
      bot = null;
      log('warn', '🔌 Disconnected.');
    });
    bot.on('error', err => log('error', `🔥 ${err.message}`));

    // Patch chat to prevent crashes on invalid packets
    const oldChat = bot.chat;
    bot.chat = (msg) => {
      if (!connected) return log('warn', 'Bot not connected.');
      try {
        oldChat.call(bot, msg.slice(0, 256)); // prevent ERR_OUT_OF_RANGE
        log('info', `📢 You said: ${chalk.green(msg)}`);
      } catch (e) {
        log('warn', `Message not sent: ${e.message}`);
      }
    };
  });
}

// Disconnect bot
function leaveBot() {
  if (!bot) return log('warn', 'No bot connected.');
  bot.quit('User requested disconnect');
  connected = false;
  bot = null;
  log('warn', '👋 Bot disconnected manually.');
}

// CLI command handler
async function handleCommand(input) {
  const [cmd, ...args] = input.trim().split(' ');
  if (!cmd) return;

  switch (cmd.toLowerCase()) {
    case 'join': {
      if (args.length < 1) return log('warn', 'Usage: join <ip> [port|version] [version]');
      const ip = args[0];
      let port = 25565, version;
      if (args[1]) args[1].includes('.') ? (version = args[1]) : (port = parseInt(args[1]));
      if (args[2]) version = args[2];
      try { await createBot(ip, port, version); } catch {}
      break;
    }

    case 'leave':
      leaveBot();
      break;

    case 'say': {
      if (!bot) return log('warn', 'Bot is not connected.');
      const msg = args.join(' ');
      if (!msg) return log('warn', 'Usage: say <message>');
      bot.chat(msg);
      break;
    }

    case 'query': {
      if (!bot) return log('warn', 'Not connected.');
      if (args[0] === 'position') {
        const p = bot.entity.position;
        log('info', `📍 Position: ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`);
      } else if (args[0] === 'players') {
        log('info', `👥 Players online:`);
        Object.keys(bot.players).forEach(p => console.log('   - ' + chalk.cyan(p)));
      } else log('warn', 'Usage: query position | players');
      break;
    }

    case 'lookat': {
      if (!bot) return log('warn', 'Not connected.');
      if (args.length < 3) return log('warn', 'Usage: lookat <x> <y> <z>');
      const [x, y, z] = args.map(Number);
      try { await bot.lookAt(bot.vec3(x, y, z)); log('success', `👀 Looking at ${x},${y},${z}`); } 
      catch (e) { log('error', `Look failed: ${e}`); }
      break;
    }

    case 'goto': {
      if (!bot) return log('warn', 'Not connected.');
      if (args.length < 3) return log('warn', 'Usage: goto <x> <y> <z>');
      const [x, y, z] = args.map(Number);
      const goal = new goals.GoalBlock(x, y, z);
      const mcData = minecraftData(bot.version);
      const defaultMove = new Movements(bot, mcData);
      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(goal);
      log('info', `🧭 Moving to ${x},${y},${z}`);
      break;
    }

    case 'help':
      console.log(chalk.bold('\nAvailable Commands:'));
      console.log(chalk.cyan('  join <ip> [port|version] [version] ') + '→ connect to a server');
      console.log(chalk.cyan('  leave                       ') + '→ disconnect');
      console.log(chalk.cyan('  say <message>               ') + '→ send chat message');
      console.log(chalk.cyan('  query position | players    ') + '→ show info');
      console.log(chalk.cyan('  lookat <x> <y> <z>          ') + '→ face a coordinate');
      console.log(chalk.cyan('  goto <x> <y> <z>            ') + '→ walk to coords');
      console.log(chalk.cyan('  help                        ') + '→ show this help\n');
      break;

    default:
      log('warn', `Unknown command: ${cmd}`);
  }
}

// CLI loop
async function init() {
  const latestVersion = await checkForUpdate();

  // Print the welcome message
  log('success', `Welcome back to MCCLI, version v${currentVersion}`);
  log('success', 'This program allows you to play/join any server and do simple tasks such as chat, move, lookat, etc.');
  log('success', 'To learn more, simply write "help" in the console at any time.');

  rl.prompt();
  rl.on('line', async line => { await handleCommand(line); rl.prompt(); });
  rl.on('SIGINT', () => { leaveBot(); process.exit(0); });
}

// Initialize the bot and start CLI
init();
