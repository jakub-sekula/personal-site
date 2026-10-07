// Titles, descriptions and structured data for search results and link previews.

/**
 * Plain text cut to about `length` characters at a word boundary, with "…" when cut.
 * 160 fits Google's snippets; link previews show roughly the first 125.
 */
export function seoTrim(text: string, length = 160) {
  const plain = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_`#>[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= length) return plain;
  const cut = plain.slice(0, length - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, '')}…`;
}

/** "A, B and C" */
export const listOf = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/** The site's author, for structured data. */
export const author = { '@type': 'Person', name: 'Jakub Sekula', url: 'https://jakubsekula.com/' };

/** A <script type="application/ld+json"> body (safe inside HTML). */
export const jsonLd = (data: Record<string, unknown>) => JSON.stringify({ '@context': 'https://schema.org', ...data }).replace(/</g, '\\u003c');
