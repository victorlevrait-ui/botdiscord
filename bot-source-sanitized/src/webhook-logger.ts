const WEBHOOK_URL = process.env["DISCORD_WEBHOOK_URL"];

type Color = number;
const Colors = {
  green:  0x2ecc71,
  red:    0xe74c3c,
  yellow: 0xf1c40f,
  blue:   0x3498db,
  orange: 0xe67e22,
  purple: 0x9b59b6,
  grey:   0x95a5a6,
} satisfies Record<string, Color>;

interface Field {
  name: string;
  value: string;
  inline?: boolean;
}

interface EmbedPayload {
  title: string;
  color: Color;
  fields?: Field[];
  footer?: string;
  timestamp?: boolean;
}

async function sendWebhook(embed: EmbedPayload): Promise<void> {
  if (!WEBHOOK_URL) return;
  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: embed.title,
          color: embed.color,
          fields: embed.fields ?? [],
          footer: embed.footer ? { text: embed.footer } : undefined,
          timestamp: embed.timestamp !== false ? new Date().toISOString() : undefined,
        }],
      }),
    });
  } catch {
    // webhook errors must never crash the bot
  }
}

function userField(tag: string, id: string): Field {
  return { name: "👤 Utilisateur", value: `${tag} (\`${id}\`)`, inline: true };
}

function serverField(name: string | null, id: string | null): Field {
  return { name: "🏠 Serveur", value: name ? `${name} (\`${id}\`)` : "DM / User App", inline: true };
}

// ─── Bot events ───────────────────────────────────────────────────────────────

export function logBotReady(tag: string): void {
  void sendWebhook({
    title: "🟢 Bot connecté",
    color: Colors.green,
    fields: [{ name: "Tag", value: tag, inline: true }],
  });
}

// ─── Account generation ───────────────────────────────────────────────────────

export function logRobloxGenerated(opts: {
  tag: string; userId: string;
  guildName: string | null; guildId: string | null;
  username: string; leftToday: number; via: "slash" | "prefix";
}): void {
  void sendWebhook({
    title: "🎮 Compte Roblox généré",
    color: Colors.green,
    fields: [
      userField(opts.tag, opts.userId),
      serverField(opts.guildName, opts.guildId),
      { name: "🕹️ Compte", value: `\`${opts.username}\``, inline: true },
      { name: "📟 Via", value: opts.via === "slash" ? "/compte" : "+compte", inline: true },
      { name: "📊 Reste aujourd'hui", value: `${opts.leftToday}/5`, inline: true },
    ],
  });
}

export function logDidiGenerated(opts: {
  tag: string; userId: string;
  guildName: string | null; guildId: string | null;
  email: string; leftToday: number; via: "slash" | "prefix";
}): void {
  void sendWebhook({
    title: "💬 Compte Discord (didi) généré",
    color: Colors.purple,
    fields: [
      userField(opts.tag, opts.userId),
      serverField(opts.guildName, opts.guildId),
      { name: "📧 Email", value: `\`${opts.email}\``, inline: true },
      { name: "📟 Via", value: opts.via === "slash" ? "/compte didi" : "+compte didi", inline: true },
      { name: "📊 Reste aujourd'hui", value: `${opts.leftToday}/3`, inline: true },
    ],
  });
}

// ─── Limits & cooldowns ───────────────────────────────────────────────────────

export function logCooldownHit(opts: {
  tag: string; userId: string;
  guildName: string | null; guildId: string | null;
  command: string; remainingSec: number;
}): void {
  void sendWebhook({
    title: "⏳ Cooldown déclenché",
    color: Colors.yellow,
    fields: [
      userField(opts.tag, opts.userId),
      serverField(opts.guildName, opts.guildId),
      { name: "⌨️ Commande", value: opts.command, inline: true },
      { name: "⏱️ Temps restant", value: `${opts.remainingSec}s`, inline: true },
    ],
  });
}

export function logDailyLimitHit(opts: {
  tag: string; userId: string;
  guildName: string | null; guildId: string | null;
  type: "roblox" | "didi"; via: "slash" | "prefix";
}): void {
  void sendWebhook({
    title: "🚫 Limite journalière atteinte",
    color: Colors.red,
    fields: [
      userField(opts.tag, opts.userId),
      serverField(opts.guildName, opts.guildId),
      { name: "🎯 Type", value: opts.type === "roblox" ? "Roblox (5/j)" : "Discord didi (3/j)", inline: true },
      { name: "📟 Via", value: opts.via === "slash" ? "slash" : "prefix", inline: true },
    ],
  });
}

// ─── Moderation ───────────────────────────────────────────────────────────────

export function logModAction(opts: {
  action: string; emoji: string;
  tag: string; userId: string;
  guildName: string | null; guildId: string | null;
  target?: string; reason?: string;
}): void {
  const fields: Field[] = [
    userField(opts.tag, opts.userId),
    serverField(opts.guildName, opts.guildId),
  ];
  if (opts.target) fields.push({ name: "🎯 Cible", value: opts.target, inline: true });
  if (opts.reason) fields.push({ name: "📝 Raison", value: opts.reason, inline: true });
  void sendWebhook({
    title: `${opts.emoji} ${opts.action}`,
    color: Colors.orange,
    fields,
  });
}

// ─── Slash commands (general) ─────────────────────────────────────────────────

export function logSlashCommand(opts: {
  command: string; tag: string; userId: string;
  guildName: string | null; guildId: string | null;
  extra?: Record<string, string>;
}): void {
  const fields: Field[] = [
    userField(opts.tag, opts.userId),
    serverField(opts.guildName, opts.guildId),
    { name: "⌨️ Commande", value: `/${opts.command}`, inline: true },
  ];
  for (const [k, v] of Object.entries(opts.extra ?? {})) {
    fields.push({ name: k, value: v, inline: true });
  }
  void sendWebhook({ title: "📡 Slash command utilisée", color: Colors.blue, fields });
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export function logError(opts: {
  context: string; error: unknown;
  tag?: string; userId?: string;
}): void {
  const msg = opts.error instanceof Error ? opts.error.message : String(opts.error);
  const fields: Field[] = [
    { name: "📍 Contexte", value: opts.context, inline: true },
    { name: "❌ Erreur", value: msg.slice(0, 1024), inline: false },
  ];
  if (opts.tag && opts.userId) fields.unshift(userField(opts.tag, opts.userId));
  void sendWebhook({ title: "🔴 Erreur bot", color: Colors.red, fields });
}
