# 📋 Aitohinta – Kehityssuunnitelma & TODO

Tämä lista sisältää toteutetut ominaisuudet sekä tulevat kehityskohteet.

## ✅ Toteutetut ominaisuudet (v1.2.0)
- [x] **Ostolaatikon automaattinen tunnistus ja sijoittelu**:
  - Gigantti.fi: Kohdistuu `[data-cro="pdp-main-price-box"]` / `[data-cro="pdp-buy-box"]` hinnan viereen.
  - Verkkokauppa.com: Kohdistuu `<aside>`-ostosarakkeen hintalohkoon `[class*='stm-price__root']`.
  - Proshop.fi: Kohdistuu `.site-currency-attention` ostolohkoon.
- [x] **Feikkialennusten tunnistus & todellinen säästö**:
  - Laskee oikean säästön vanhojen hintojen keskiarvon (normihinnan) perusteella.
  - Näyttää säästön sekä euroina että todellisena prosenttina (esim. `79 € (-19%)`).
  - Suuntanuoli: vihreä `↓` aidolle alennukselle, punainen `↑` feikkialennukselle (+X% yli keskihinnan).
- [x] **Interaktiivinen SVG-hintakäyrä**:
  - Kuvaajan pisteitä osoittamalla näkee mitkä kaupat ovat myyneet tuotetta kyseisenä päivänä ja mihin hintaan.
- [x] **Hintaennuste & ajoitus**:
  - Analysoi vanhoja hintapudotuksia ja antaa arvion koska hinta todennäköisesti seuraavan kerran laskee (esim. marraskuussa / Black Friday).
  - Hover-infoteksti (`ℹ️`), joka selittää miksi arvio on tehty.
- [x] **3-in-1 Monilähdehaku**:
  - Hakee ensisijaisesti Hinta.fi:stä (koko hintahistoria ja kauppalinkit).
  - Varajärjestelmänä Hintaopas.fi (Schema.org JSON-LD).
  - Suorat 1-klikkauksen hakulinkit Hinta.fi-, Hintaopas.fi- ja Vertaa.fi-palveluihin.
- [x] **Tuotelistaustuki (hakutulokset ja kategoriat)**:
  - Kompaktit merkit tuotekorttien hinnan viereen ja leijuva vertailuikkuna.
- [x] **Esittelysivusto (GitHub Pages)**:
  - Sivusto `docs/index.html` kuvakaappauksineen, tuettuine kauppoineen ja latauslinkkeineen.
  - Ilmoitus: *Chrome plugin coming soon*.

---

## 🚀 Tulevat kehityskohteet (Roadmap)
- [ ] **Chrome-versio (Manifest V3)**:
  - Muunnos Firefox Manifest V2 -> Chrome MV3 (service worker -taustaprosessi).
  - Julkaisu Chrome Web Storeen.
- [ ] **Virallinen Firefox AMO -julkaisu**:
  - Allekirjoitettu paketti Mozilla Add-ons (AMO) -kauppaan suoraa 1-klikkauksen asennusta varten.
- [ ] **Hintavahti & alennushälytykset**:
  - Mahdollisuus asettaa tuotteelle haluttu tavoitehinta ja saada ilmoitus kun hinta alittuu.
- [ ] **Käytettyjen ja outlet-tuotteiden suodatus**:
  - Erottaa uudet ja B-stock/outlet-hinnat automaattisesti käyrästä.
- [ ] **Power.fi ja Jimm's täsmäsäädöt**:
  - Omat erikoistunnistimet Powerin ja Jimm'sin dynaamisille ostolaatikoille.
