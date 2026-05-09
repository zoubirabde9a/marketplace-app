// Reuse the homepage OG card for /search shares — without this, /search
// inherits the layout-level apple-icon (192px), which Facebook flags as
// "image too small" and crops awkwardly. Same 1200×630 brand card.

export { default, size, contentType, alt } from "../opengraph-image";
