const BOOLEAN_ATTRIBUTES = new Set([
  'allowfullscreen', 'async', 'autofocus', 'autoplay', 'checked', 'controls', 'default',
  'defer', 'disabled', 'download', 'formnovalidate', 'hidden', 'inert', 'ismap',
  'itemscope', 'loop', 'multiple', 'muted', 'novalidate', 'open', 'readonly',
  'required', 'reversed', 'selected',
]);

export function setDomAttributes(node, attributes = {}) {
  for (const [name, value] of Object.entries(attributes)) {
    if (BOOLEAN_ATTRIBUTES.has(name.toLowerCase()) && typeof value === 'boolean') {
      if (value) node.setAttribute(name, '');
      else node.removeAttribute(name);
      continue;
    }
    node.setAttribute(name, value);
  }
}
