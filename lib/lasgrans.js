/**
 * Tak för hur många olika löpare en och samma klient får se (KRAV-5).
 *
 * Det som skiljer en uppräkning från en löpare som tittar på sitt kvitto är
 * inte antalet anrop utan antalet *personer*. Kvittosidan hämtar samma kvitto
 * var 15:e sekund så länge resultatet inte är klart – det är ett anrop i
 * minuten men alltid samma person. En uppräkning hämtar tusen olika.
 *
 * Därför räknas identiteter, inte anrop. En pollande sida kostar 1 oavsett hur
 * länge den står öppen, och taket kan sättas högt utan att bli verkningslöst.
 *
 * Höjden är vald med mobilnätet i åtanke: operatörer lägger många abonnenter
 * bakom samma publika adress, så på en arena kan hundratals löpare dela IP.
 * Taket ska aldrig kunna slå till mot dem, och är därför en bromskloss mot
 * massinsamling – inte en mur. Med `READ_LIMIT=0` stängs det av.
 */
export function createReadLimiter({
  // Samma tak som index.js levererar. Defaulten här används bara av en anropare
  // som utelämnar `max`, men står den kvar på ett gammalt värde beskriver den
  // en drift som inte finns – och nästa läsare tror på den.
  max = 5000,
  windowMs = 15 * 60 * 1000,
  now = () => Date.now(),
} = {}) {
  const klienter = new Map(); // nyckel -> { start, sedda:Set }

  function hämta(nyckel) {
    const post = klienter.get(nyckel);
    if (post && now() - post.start < windowMs) return post;
    const ny = { start: now(), sedda: new Set() };
    klienter.set(nyckel, ny);
    return ny;
  }

  /** Städar bort klienter vars fönster passerat, så kartan inte växer. */
  function städa() {
    for (const [nyckel, post] of klienter) {
      if (now() - post.start >= windowMs) klienter.delete(nyckel);
    }
  }

  return {
    /** Har klienten redan sett så många den får? */
    överSkridet(nyckel) {
      if (!(max > 0)) return false;
      return hämta(nyckel).sedda.size >= max;
    },

    /** Räknar in de identiteter svaret röjer. Returnerar antalet sedda. */
    räkna(nyckel, identiteter) {
      if (!(max > 0)) return 0;
      const post = hämta(nyckel);
      for (const id of identiteter) post.sedda.add(id);
      // Städningen görs här och inte på en timer: en timer måste stoppas vid
      // avslut, och den här kartan är liten nog att gås igenom.
      if (klienter.size > 500) städa();
      return post.sedda.size;
    },

    /** Antal olika löpare klienten sett i det pågående fönstret. */
    sedda(nyckel) {
      return hämta(nyckel).sedda.size;
    },
  };
}
