/**
 * MOP-endpointerna svarar `<MOPStatus status="X"></MOPStatus>` (KRAV-1), inte
 * ren text. Testerna bryr sig nästan alltid om statuskoden och inte om
 * inpackningen, så de plockar ut den här – men eftersom det är just
 * inpackningen MeOS kräver finns formatet också pinnat i ett eget test
 * (`test/api.test.js`) och ett eget scenario.
 *
 * `/iof` svarar fortfarande ren text; då returneras kroppen oförändrad.
 */
const MOP_STATUS = /<MOPStatus\s+status="([^"]*)"/;

export function mopStatus(body) {
  return body.match(MOP_STATUS)?.[1] ?? body;
}
