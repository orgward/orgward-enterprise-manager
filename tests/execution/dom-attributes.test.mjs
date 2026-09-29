import assert from 'node:assert/strict';
import test from 'node:test';
import { setDomAttributes } from '../../public/dom-attributes.mjs';

function testNode() {
  const attributes = new Map();
  return {
    attributes,
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    hasAttribute(name) { return attributes.has(name); },
  };
}

test('DOM boolean attributes are present only when true', () => {
  const node = testNode();
  setDomAttributes(node, { disabled: true });
  assert.equal(node.hasAttribute('disabled'), true, 'true must enable a boolean attribute');
  setDomAttributes(node, { disabled: false, required: true, 'aria-expanded': false, type: 'button', 'aria-label': 'Continue' });

  assert.equal(node.hasAttribute('disabled'), false, 'false must omit a boolean attribute');
  assert.equal(node.hasAttribute('required'), true, 'true must enable a boolean attribute');
  assert.equal(node.attributes.get('required'), '');
  assert.equal(node.attributes.get('aria-expanded'), 'false', 'ARIA booleans stay string values');
  assert.equal(node.attributes.get('type'), 'button');
  assert.equal(node.attributes.get('aria-label'), 'Continue');
});
