// Shared HTML helpers. Used wherever untrusted text (raw Komoot names, file
// names, error strings) is interpolated into markup — the ride card and the
// upload results screen both build HTML strings by hand.

/** HTML-escape untrusted text so it can never be interpreted as markup. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
