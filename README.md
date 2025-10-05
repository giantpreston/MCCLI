# MCCLI

**Minecraft Command-Line Interface (MCCLI)**

MCCLI is a lightweight, console-based tool that lets you interact with Minecraft servers through the command line. Whether you want to chat, explore, or experiment with bots, MCCLI gives you a simple, powerful interface to do it all, no launcher required.

---

## Features

* **Connect to any server** – Just type `join <ip>` and you’re in.
* **Chat like a player** – Send messages with `say <message>` and see live chat.
* **Explore the world** – Use `goto <x> <y> <z>` to make the bot move around.
* **Look around** – Make your bot face any coordinate with `lookat <x> <y> <z>`.
* **Query server info** – Check player lists, positions, and more.
* **Lightweight CLI interface** – Minimal setup, maximum control.

---

## Getting Started

**Grab the latest release:** MCCLI is distributed as a standalone `.exe`. Download the latest version from the [Releases page on GitHub](https://github.com/giantpreston/MCCLI/releases) and run it, no installation required.

For developers or anyone who wants to modify the bot:

1. Make sure you have **Node.js v18+** installed.
2. Clone this repo or download the source files.
3. Install dependencies:

```bash
npm install
```

4. Start MCCLI:

```bash
node index.js
```

---

## Commands

| Command                      | Description                        |
| ---------------------------- | ---------------------------------- |
| `join <ip> [port] [version]` | Connect to a Minecraft server      |
| `leave`                      | Disconnect the bot                 |
| `say <message>`              | Send a chat message                |
| `query position`             | Show the bot's current coordinates |
| `query players`              | List online players                |
| `lookat <x> <y> <z>`         | Face a specific coordinate         |
| `goto <x> <y> <z>`           | Move to a specific coordinate      |
| `help`                       | Display this help menu             |

---

## Notes

* **Microsoft account login** is mandatory on production releases. Tokens are cached locally (.minecraft\nmp-cache); your password is never stored.
* **Version checks** are automatic. MCCLI will notify you if a newer version is available.
* Designed for experimentation and lightweight automation, not for griefing or cheating. Play responsibly.

---

## Why MCCLI?

MCCLI is perfect for developers, server admins, or curious players who want **hands-on control** over a Minecraft bot without the distractions of a full client. It’s fast, intuitive, and fun to tinker with.

---

## Contribution

We love contributions! Whether it’s fixing bugs, adding commands, or improving logging, your input is welcome. Just fork, modify, and submit a pull request.
And if you have found any bugs on pre-releases (or production releases), just open a new issue and let me know!

---

## License

MIT License. Free to use, modify, and share.
