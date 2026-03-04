const sanitizeHtml = require('sanitize-html');

const ALLOWED_TAGS = [
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'col', 'colgroup',
  'dd', 'del', 'div', 'dl', 'dt', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 's', 'small', 'span', 'strong',
  'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul'
];

const ALLOWED_ATTRIBUTES = {
  a: ['href', 'name', 'target', 'title'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  table: ['border', 'cellpadding', 'cellspacing', 'width'],
  td: ['colspan', 'rowspan', 'align', 'valign', 'width'],
  th: ['colspan', 'rowspan', 'align', 'valign', 'width'],
  div: ['align'],
  p: ['align'],
  span: ['align']
};

const sanitizeOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: ALLOWED_ATTRIBUTES,
  allowedSchemes: ['http', 'https', 'data'],
  allowedSchemesByTag: {
    a: ['http', 'https', 'mailto', 'tel'],
    img: ['http', 'https', 'data']
  },
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', {
      rel: 'nofollow noopener noreferrer'
    }, true)
  },
  disallowedTagsMode: 'discard'
};

function sanitizeRichText(html) {
  if (html === null || html === undefined) {
    return '';
  }
  return sanitizeHtml(String(html), sanitizeOptions).trim();
}

module.exports = {
  sanitizeRichText
};
