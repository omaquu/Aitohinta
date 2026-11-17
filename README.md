# 🏷️ Aitohinta – Hintatarkistaja & Hintavertailu

**Paljastaa feikkialennukset suomalaisissa verkkokaupoissa.** Näyttää tuotteen oikean normihinnan, hintakehityksen ja vertaa hintoja automaattisesti Hinta.fi-, Hintaopas- ja Vertaa.fi-palveluissa.

![Firefox](https://img.shields.io/badge/Firefox-Add--on-FF7139?logo=firefox-browser&logoColor=white)
![Chrome](https://img.shields.io/badge/Chrome-Coming_Soon-4285F4?logo=google-chrome&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

---

## ✨ Ominaisuudet

| Ominaisuus | Kuvaus |
|---|---|
| 🚨 **Feikkialennusten paljastus** | Vertaa kaupan väittämää "normihintaa" tuotteen todelliseen historialliseen keskihintaan |
| 📉 **Todellinen säästö** | Näyttää oikean säästöprosentin ja euromäärän, ei kaupan keksimää |
| 📈 **Hintakäyrä hover-popoverilla** | Interaktiivinen SVG-hintahistoriagraafi – vie hiiri pisteiden päälle nähdäksesi kauppakohtaiset hinnat |
| 🏆 **Halvin hinta nyt** | Näyttää missä kaupassa tuote on edullisimmillaan (klikattavat linkit) |
| 📅 **Hintaennuste** | Arvioi historiadata perusteella milloin tuote todennäköisesti seuraavan kerran halpenee |
| 🏪 **Monilähdehaku** | Hakee automaattisesti Hinta.fi:stä ja Hintaopas.fi:stä, tarjoaa linkit Vertaa.fi:hin |
| 🔍 **Tuotelistausten vertailu** | Näyttää kompaktit hintavertailubadget myös hakutulos- ja kategoriasivuilla |

## 🛒 Tuetut verkkokaupat

- [Gigantti.fi](https://www.gigantti.fi)
- [Verkkokauppa.com](https://www.verkkokauppa.com)
- [Power.fi](https://www.power.fi)
- [Proshop.fi](https://www.proshop.fi)
- [Jimms.fi](https://www.jimms.fi)
- [Dustinhome.fi](https://www.dustinhome.fi)
- [Multitronic.fi](https://www.multitronic.fi)
- [CDON.fi](https://www.cdon.fi)
- [Amazon.fi / .de / .com](https://www.amazon.fi)

## 📥 Asennus

### Firefox (saatavilla nyt)
1. Lataa uusin versio [Releases](https://github.com/omaquu/Aitohinta/releases)-sivulta
2. Avaa Firefoxissa `about:debugging#/runtime/this-firefox`
3. Klikkaa **Lataa tilapäinen lisäosa…**
4. Valitse ladattu `manifest.json`-tiedosto

### Chrome (tulossa pian 🚧)
Chrome-versio on kehityksessä. Manifest V3 -tuki tulossa!

## 📸 Kuvakaappaukset

Katso [nettisivu](https://omaquu.github.io/Aitohinta/) esimerkkikuvakaappauksista.

## 🛠️ Kehitys

```bash
git clone https://github.com/omaquu/Aitohinta.git
cd Aitohinta
# Lataa about:debugging → Lataa tilapäinen lisäosa → valitse manifest.json
```

### Tiedostorakenne
```
Aitohinta/
├── manifest.json          # Firefox Manifest V2
├── background/
│   └── background.js      # Hinta.fi/Hintaopas haku & history parser
├── content/
│   ├── content.js          # Tuotesivujen & listausten DOM-injektio
│   └── inject.css          # Widget & popover -tyylit
├── popup/
│   ├── popup.html          # Toolbar-popup UI
│   ├── popup.js
│   └── popup.css
├── icons/
│   ├── icon-48.png
│   └── icon-96.png
└── docs/                   # GitHub Pages -nettisivu
    └── index.html
```

## 📄 Lisenssi

MIT License – katso [LICENSE](LICENSE)

## 🤝 Tekijä

[@omaquu](https://github.com/omaquu)
