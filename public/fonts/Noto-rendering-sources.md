These unmodified fonts complete the Tree of Life image renderer's existing
Devanagari chakra names and planetary/alchemical symbols. They were downloaded
from the Noto project's published builds on 2026-09-13. Font bytes are committed;
rendering never downloads them at runtime. The existing Noto Sans and Noto Sans
Hebrew fonts remain first in the renderer's font list.

| File | Source | SHA-256 |
| --- | --- | --- |
| NotoSansDevanagari-Regular.ttf | [Noto Devanagari](https://notofonts.github.io/devanagari/fonts/NotoSansDevanagari/hinted/ttf/NotoSansDevanagari-Regular.ttf) | ec01c32f0e967b0b0c49d3766e5eab9cbf80c41842d39a1866c5be1892a07474 |
| NotoSansSymbols-Regular.ttf | [Noto Symbols](https://notofonts.github.io/symbols/fonts/NotoSansSymbols/hinted/ttf/NotoSansSymbols-Regular.ttf) | 283f7b0d9626a2d2847810184bc38d137f370d8a5d535cc84b05e8553fac7f4d |
| NotoSansSymbols2-Regular.ttf | [Noto Symbols 2](https://notofonts.github.io/symbols/fonts/NotoSansSymbols2/hinted/ttf/NotoSansSymbols2-Regular.ttf) | 5b5c3d6e3bfc74d882c89363a5b68aac0af68ef43626ce9b746eda340325c2fc |

The adjacent `NotoDevanagari-OFL.txt` and `NotoSymbols-OFL.txt` contain the
upstream SIL Open Font License 1.1 notices. Symbols supplies the used alchemical
and most planetary glyphs; Symbols 2 supplies U+2609 (sun). Both are needed by
the existing grade fields. These files do not change the interactive component's
CSS or font-loading behavior.
