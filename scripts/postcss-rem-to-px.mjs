/**
 * Converts rem units to px (16px base). The in-page UI lives inside a Shadow DOM but rem is still
 * resolved against the host page's <html> font-size, which many sites change.
 */
export default function remToPx(base = 16) {
  const re = /(-?\d*\.?\d+)rem\b/g;
  return {
    postcssPlugin: 'ml-rem-to-px',
    Declaration(decl) {
      if (decl.value.includes('rem')) {
        decl.value = decl.value.replace(re, (_, n) => `${+(parseFloat(n) * base).toFixed(3)}px`);
      }
    },
  };
}
remToPx.postcss = true;
