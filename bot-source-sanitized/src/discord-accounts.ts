/**
 * Add your own authorized test accounts here through a secure secret store.
 * Never commit real email/password pairs to source control.
 */
export const discordAccounts: string[] = [];

export function randomDiscordAccount(): string {
  if (discordAccounts.length === 0) {
    throw new Error("No Discord account configured");
  }
  const idx = Math.floor(Math.random() * discordAccounts.length);
  return discordAccounts[idx]!;
}
