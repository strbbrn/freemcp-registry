// Serve the official badge as an explicit Pages Function to avoid HTML fallbacks.
// Keep the SVG markup in sync with public/badges/listed.svg.
const SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"224\" height=\"36\" viewBox=\"0 0 224 36\" role=\"img\" aria-label=\"FreeMCP — Listed\">\n<title>Listed on FreeMCP</title>\n<defs>\n  <filter id=\"soft-glow\" x=\"-100%\" y=\"-150%\" width=\"300%\" height=\"400%\">\n    <feGaussianBlur stdDeviation=\"2.2\"/>\n  </filter>\n  <linearGradient id=\"edge\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\">\n    <stop offset=\"0\" stop-color=\"#778aff\"/>\n    <stop offset=\".55\" stop-color=\"#465a96\"/>\n    <stop offset=\"1\" stop-color=\"#55d9b2\"/>\n  </linearGradient>\n</defs>\n<rect x=\"2\" y=\"2\" width=\"220\" height=\"32\" rx=\"9\" fill=\"none\" stroke=\"#7589ff\" stroke-opacity=\".5\" stroke-width=\"2\" filter=\"url(#soft-glow)\"/>\n<rect x=\".5\" y=\".5\" width=\"223\" height=\"35\" rx=\"9\" fill=\"#101521\" stroke=\"url(#edge)\"/>\n<path d=\"M9 0h126v36H9A9 9 0 0 1 0 27V9A9 9 0 0 1 9 0Z\" fill=\"#192237\"/>\n<path d=\"M17 10h12l5 8-5 8H17l-5-8Z\" fill=\"none\" stroke=\"#9dabff\" stroke-width=\"1.8\" stroke-linejoin=\"round\"/>\n<path d=\"m20 18 3 3 5-6\" fill=\"none\" stroke=\"#a7f3d0\" stroke-width=\"1.9\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n<text x=\"43\" y=\"23\" fill=\"#f4f6ff\" font-family=\"Arial,Helvetica,sans-serif\" font-size=\"15\" font-weight=\"700\" letter-spacing=\"-.4\">FreeMCP</text>\n<path d=\"M135 5v26\" stroke=\"#39445c\"/>\n<circle cx=\"151\" cy=\"18\" r=\"6\" fill=\"#68e0ac\" opacity=\".48\" filter=\"url(#soft-glow)\"/>\n<circle cx=\"151\" cy=\"18\" r=\"3\" fill=\"#68e0ac\"/>\n<text x=\"161\" y=\"22\" fill=\"#b7f7d5\" font-family=\"Arial,Helvetica,sans-serif\" font-size=\"11\" font-weight=\"700\" letter-spacing=\"1\">LISTED</text>\n</svg>";
export function onRequestGet() {
 return new Response(SVG, {
  status: 200,
  headers: {
   'content-type': 'image/svg+xml; charset=utf-8',
   'cache-control': 'public, max-age=300',
   'x-content-type-options': 'nosniff',
   'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  },
 });
}
