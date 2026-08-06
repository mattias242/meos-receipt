import os from 'node:os';

/**
 * Adresser som löpare kan nå tjänsten på över det lokala nätverket
 * (arenans wifi) – alla externa IPv4-gränssnitt (KRAV-12).
 */
export function lanUrls(port, interfaces = os.networkInterfaces()) {
  const urls = [];
  for (const list of Object.values(interfaces)) {
    for (const iface of list || []) {
      const ipv4 = iface.family === 'IPv4' || iface.family === 4;
      if (ipv4 && !iface.internal) urls.push(`http://${iface.address}:${port}`);
    }
  }
  return urls;
}
