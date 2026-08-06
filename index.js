import 'dotenv/config';
import { createApp } from './server.js';

const port = parseInt(process.env.PORT || '3000', 10);
const dataDir = process.env.DATA_DIR || './data';
const password = process.env.MEOS_PASSWORD || '';

if (!password) {
  console.warn('VARNING: MEOS_PASSWORD är inte satt – alla kan skicka data till /meos.');
}

const app = createApp({ dataDir, password });
app.listen(port, () => {
  console.log(`MeOS digitalt kvitto lyssnar på http://localhost:${port}`);
  console.log(`MeOS onlineresultat (MOP) tas emot på POST /meos`);
});
