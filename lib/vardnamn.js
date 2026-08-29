/**
 * KRAV-20: bindning av värdnamn till tävling.
 *
 * Arrangören vill kunna trycka en adress som hör till klubben – kvitto.klubben.se
 * – i stället för tjänstens egen domän med ett tävlings-id i sig. Bindningen hör
 * till driften och inte till tävlingsdatan: tävlingens JSON ägs av MeOS och
 * nollställs vid varje MOPComplete, och arbetskatalogen skrivs över vid deploy.
 * Därför kommer den ur miljön.
 *
 * Formatet är en rad i .env, skriven för hand inför varje arrangemang:
 *
 *   VARDNAMN_TAVLINGAR=kvitto.klubben.se=26082002,kvitto.grannklubben.se=26091401
 */

/** Tävlings-id:t hamnar i /t/<id>, som bara släpper igenom siffror (KRAV-18). */
const GILTIGT_ID = /^[0-9]+$/;

/**
 * Tolkar konfigurationssträngen till en uppslagstabell.
 *
 * En trasig post kostar bara sig själv. Att vägra starta hade flyttat ett
 * stavfel i .env till en tjänst som ligger nere mitt under tävlingshelgen, och
 * bindningen är en bekvämlighet – /t/<id> fungerar oavsett.
 *
 * @param {string|null|undefined} text  innehållet i VARDNAMN_TAVLINGAR
 * @param {(msg: string) => void} [varna]
 * @returns {Map<string, string>} värdnamn (gemener, utan port) → tävlings-id
 */
export function tolkaVardnamnTavlingar(text, varna = console.warn) {
  const bindningar = new Map();
  if (!text) return bindningar;

  for (const post of String(text).split(',')) {
    const rad = post.trim();
    if (!rad) continue;

    const delare = rad.indexOf('=');
    if (delare < 0) {
      varna(`VARDNAMN_TAVLINGAR: "${rad}" saknar =, hoppas över`);
      continue;
    }

    // Bara värdnamnet normaliseras: DNS är skiftlägesokänsligt, och req.hostname
    // är portlös – ett värdnamn med port hade annars aldrig kunnat träffa.
    const vardnamn = rad.slice(0, delare).trim().toLowerCase().split(':')[0];
    const cid = rad.slice(delare + 1).trim();

    if (!vardnamn) {
      varna(`VARDNAMN_TAVLINGAR: "${rad}" saknar värdnamn, hoppas över`);
      continue;
    }
    if (!GILTIGT_ID.test(cid)) {
      varna(
        `VARDNAMN_TAVLINGAR: "${rad}" har inget giltigt tävlings-id (bara siffror), hoppas över`
      );
      continue;
    }

    bindningar.set(vardnamn, cid);
  }

  return bindningar;
}
