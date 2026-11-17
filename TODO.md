# 📋 Aitohinta – Kehityssuunnitelma & TODO

Tämä lista sisältää toteutetut ominaisuudet sekä tulevat kehityskohteet.

## ✅ Toteutetut ominaisuudet (v1.3.1)
- [x] **Hintaopas.fi täysi hintahistoria- & kauppaparsinta**:
  - Hakee ja parsii Hintaopas.fi:n tuotesivun koko `historyItems`-hintahistorian (Next.js-streamista).
  - Tuottaa täydellisen interaktiivisen SVG-hintakäyrän pisteineen, päivämäärineen ja kauppakohtaisine tarjouksineen myös silloin kun Hinta.fi on poissa käytöstä tai ei löydä tuotetta.
  - Laskee Hintaopas-datalle alimman koskaan, korkeimman, keskihinnan (oikea normihinta) ja hintaennusteen.
  - Parsii nykyiset myyvät kaupat ja niiden hinnat klikattavaksi listaksi.
- [x] **Saumaton automaattinen varalähde-fallback**:
  - Jos Hinta.fi ei vastaa tai tuotetta ei löydy, extension ottaa välittömästi käyttöön Hintaopas.fi:n tulokset hintahistorioineen.
  - Tuotelistauksissa ja tuotesivulla `getProductDetails` hakee aina täydet hintatiedot lähteestä riippumatta.
- [x] **Tuotelistaus: "Hae hinta" -nappi (ei automaattista hakua)**:
  - Tuotelistausnäkymissä (hakutulokset, kategoriat) ei enää haeta hintoja automaattisesti kaikilta tuotteilta.
  - Jokaisen tuotekortin kohdalle tulee `💰 Hae hinta` -nappi, jota klikkaamalla haetaan vertailuhinta vain kyseiselle tuotteelle.
  - Estää rate limiting / flood protection -ongelmia hintavertailusivustoilla.
  - Yksittäisen tuotteen sivulla hinnat haetaan edelleen automaattisesti.
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
