# Source du bot Discord

Cette archive contient le code source du bot et sa configuration de build.

## Secrets requis

Configure les variables d'environnement suivantes dans le gestionnaire de secrets de ton hébergeur :

- `DISCORD_TOKEN`
- `BLOXGEN_API_KEY` si la génération Roblox est utilisée
- `DISCORD_WEBHOOK_URL` si les journaux webhook sont utilisés
- `SESSION_SECRET` si le serveur API l'utilise

Le fichier `src/discord-accounts.ts` est volontairement sans identifiants réels. Les mots de passe et comptes ne doivent pas être stockés dans le code.
