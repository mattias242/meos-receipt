# MOP – protokollets facit

Melin Softwares officiella material för MeOS onlineprotokoll. Hämtat från
melin.nu (Utvecklingsresurser). **Det här är referensmaterial, inte kod som
körs** – ingenting här ingår i tjänsten.

| Fil | Vad det är |
| --- | --- |
| `mop.xsd` | Schemat för MOP 2.0. Facit för vilka element och attribut som finns |
| `update.php` | Referensimplementation av mottagarsidan – motsvarigheten till vår `POST /meos` |
| `zipupdate.php` | Samma sak med stöd för zip-komprimerade sändningar |
| `functions.php` | Hjälpfunktioner, bl.a. `returnStatus()` som definierar svarsformatet |
| `setup.php`, `show.php`, `config.php` | Resten av Melins exempeltjänst |

PHP-filerna är Apache 2.0. Specifikationen (`MeOS Online Protocol.pdf`) är Melins
dokumentation och versionshanteras därför inte här – hämta den från melin.nu.

## Varför den ligger kvar

Två saker som är lätta att gissa fel om, och som kostade oss deltagarfältet:

**Svaret ska vara XML.** `functions.php:433` visar formatet:

```php
die('<?xml version="1.0"?><MOPStatus status="'.$stat.'"></MOPStatus>');
```

Svarar man ren text `OK` kan MeOS inte tolka det, och avbryter sändningen. Se
KRAV-1 i `docs/KRAV.md`.

**Raderingar finns i protokollet** (`delete="true"`, nytt i version 2.0) och
gäller `cmp`, `tm` och `org`.

Kolla här innan du gissar om MOP.
