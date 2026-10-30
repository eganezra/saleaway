// Hostile 3 MiB pages: every scanner of a page (the validator, the extractors) must finish on each in under a second.
const MIB = 1024 * 1024;

export function hostilePages(): Record<string, string> {
  return {
    'many closed script tags and no style tag': '<script></script>'.repeat(Math.floor((3 * MIB) / 17)),
    'many closed style tags and no script tag': '<style></style>'.repeat(Math.floor((3 * MIB) / 15)),
    'many closed script and style tags together': '<script></script><style></style>'.repeat(Math.floor((3 * MIB) / 32)),
    'many comments': '<!-- x -->'.repeat(Math.floor((3 * MIB) / 10)),
    'many small tags with text': '<b>word</b> '.repeat(Math.floor((3 * MIB) / 12)),
    'many unclosed script tags': '<script '.repeat(Math.floor((3 * MIB) / 8)),
    'many unclosed style tags': '<style>'.repeat(Math.floor((3 * MIB) / 7)),
    'many open angle brackets and no close': '<'.repeat(3 * MIB),
    'many open tags and no text': '<a'.repeat(Math.floor((3 * MIB) / 2)),
    'a long run of digits and spaces after R': `R${'1 '.repeat(Math.floor((3 * MIB) / 2))}`,
    'many R characters': 'R'.repeat(3 * MIB),
    'a long run of digits after R that ends in a letter': `R${'1'.repeat(3 * MIB)}x`,
    'many prices with no thousands separator': 'R1299999 '.repeat(Math.floor((3 * MIB) / 9)),
    'many percent signs': '<span>9%</span>'.repeat(Math.floor((3 * MIB) / 15)),
    'a long attribute that never closes': `<div class="${'old-price '.repeat(Math.floor((3 * MIB) / 10))}`,
    'a long title that never closes': `<title>${'a'.repeat(3 * MIB)}`,
    // for the extractors: nav, header and footer blocks that never close, and many of them
    'many nav, header and footer tags that never close': '<nav><header><footer>'.repeat(Math.floor((3 * MIB) / 21)),
    'many closed nav blocks': '<nav>x</nav>'.repeat(Math.floor((3 * MIB) / 12)),
    'many old-price markers and amounts': '<s>R100</s>R50 '.repeat(Math.floor((3 * MIB) / 14)),
    'many was words': 'was R1 '.repeat(Math.floor((3 * MIB) / 7)),
    'many list price fields': '<script>{"listPrice":100,'.repeat(Math.floor((3 * MIB) / 25)),
  };
}
