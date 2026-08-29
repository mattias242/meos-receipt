import test from 'node:test';
import assert from 'node:assert/strict';
import { tolkaVardnamnTavlingar } from '../lib/vardnamn.js';

/**
 * KRAV-20: ett värdnamn kan bindas till en bestämd tävling, så att arrangören
 * kan trycka klubbens egen adress i PM i stället för tjänstens domän.
 *
 * Konfigurationen kommer ur miljön och skrivs för hand inför varje arrangemang.
 * Den ska därför tåla att se ut som handskriven text – mellanslag, versaler,
 * ett kvarglömt kommatecken – utan att tjänsten vägrar starta. En trasig rad är
 * värd en varning; en trasig start mitt under tävlingshelgen är det inte.
 */

test('tom eller saknad konfiguration ger ingen bindning', () => {
  assert.equal(tolkaVardnamnTavlingar('').size, 0);
  assert.equal(tolkaVardnamnTavlingar('   ').size, 0);
  assert.equal(tolkaVardnamnTavlingar(undefined).size, 0);
  assert.equal(tolkaVardnamnTavlingar(null).size, 0);
});

test('ett värdnamn binds till sin tävling', () => {
  const m = tolkaVardnamnTavlingar('kvitto.klubben.se=26082002');
  assert.equal(m.get('kvitto.klubben.se'), '26082002');
  assert.equal(m.size, 1);
});

test('flera värdnamn skiljs med komma', () => {
  const m = tolkaVardnamnTavlingar('a.se=1, b.se=2 ,c.se=3');
  assert.deepEqual([...m], [
    ['a.se', '1'],
    ['b.se', '2'],
    ['c.se', '3'],
  ]);
});

// DNS är skiftlägesokänsligt, och Host-headern bär det löparen skrev in.
test('värdnamnet lagras i gemener', () => {
  const m = tolkaVardnamnTavlingar('Kvitto.Klubben.SE=4');
  assert.equal(m.get('kvitto.klubben.se'), '4');
});

// Skrivs porten in av misstag ska bindningen ändå gälla; req.hostname är
// portlös, så ett värdnamn med port hade annars aldrig kunnat träffa.
test('portnummer i värdnamnet skalas bort', () => {
  const m = tolkaVardnamnTavlingar('kvitto.klubben.se:8443=4');
  assert.equal(m.get('kvitto.klubben.se'), '4');
});

test('tomma poster hoppas över utan att fälla resten', () => {
  const m = tolkaVardnamnTavlingar('a.se=1,,b.se=2,');
  assert.equal(m.size, 2);
  assert.equal(m.get('b.se'), '2');
});

/**
 * Tävlings-id:t hamnar i adressen `/t/<id>`, som bara släpper igenom siffror
 * (KRAV-18). Ett id som inte är siffror skulle ge en vidareskickning till en
 * adress som svarar 404 – tyst, och först när löparen står i målfållan.
 */
test('poster med ogiltigt tävlings-id ignoreras', () => {
  const m = tolkaVardnamnTavlingar('a.se=abc,b.se=2,c.se=,d.se=-1,e.se=1x');
  assert.deepEqual([...m.keys()], ['b.se']);
});

test('poster utan likhetstecken ignoreras', () => {
  const m = tolkaVardnamnTavlingar('skräp,b.se=2');
  assert.deepEqual([...m.keys()], ['b.se']);
});

test('en post utan värdnamn ignoreras', () => {
  const m = tolkaVardnamnTavlingar('=4,b.se=2');
  assert.deepEqual([...m.keys()], ['b.se']);
});

// Sista ordet gäller: den som skriver om raden i .env rättar oftast i slutet.
test('vid dubblett vinner den sista posten', () => {
  const m = tolkaVardnamnTavlingar('a.se=1,a.se=2');
  assert.equal(m.get('a.se'), '2');
  assert.equal(m.size, 1);
});
