import { createApp } from '../../server.js';

/**
 * Startar en engångsserver på en ledig port. Testet ansvarar för att stänga
 * den (se `withServer`, som gör det åt en).
 */
export async function startServer(opts = {}) {
  const app = createApp(opts);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, app, base };
}

/**
 * Slår ihop serverstart och nedstängning till en testfunktion:
 *
 *   test('namn', withServer(async ({ base }) => {
 *     // ...
 *   }));
 *
 * `opts` skickas vidare till `createApp` (t.ex. `{ password, readLimit }`).
 * Ett fåtal tester behöver seeda tävlingsdata innan testkroppen körs (se
 * `test/proxy.test.js`); ge då en `seed(base)`-funktion i `opts.seed` – den
 * körs efter att servern startat men före testkroppen, och nyckeln plockas
 * bort innan resten av `opts` går vidare till `createApp`.
 */
export function withServer(fn, opts = {}) {
  const { seed, ...appOpts } = opts;
  return async (t) => {
    const { server, app, base } = await startServer(appOpts);
    t.after(() => server.close());
    if (seed) await seed(base);
    return fn({ t, server, app, base });
  };
}
