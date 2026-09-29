import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../../public/execution.css', import.meta.url), 'utf8');

function declarationsFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[1];
}

function rgb(hex) {
  return hex.slice(1).match(/.{2}/g).map((channel) => parseInt(channel, 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
}

function luminance(hex) {
  const [red, green, blue] = rgb(hex);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('Execution faint labels meet WCAG AA on their dark surfaces', () => {
  const token = css.match(/--exec-faint:\s*(#[\da-f]{6})/i)?.[1];
  assert.ok(token, 'Execution faint text token must be a literal hex color');
  for (const background of ['#11151b', '#161d26']) {
    assert.ok(contrastRatio(token, background) >= 4.5, `${token} on ${background} must reach 4.5:1`);
  }

  for (const selector of ['.boundary, .muted', '.run-link small', '.evidence-grid b', '.run-events span']) {
    const declarations = declarationsFor(selector);
    assert.match(declarations, /color:\s*var\(--exec-faint\)/, `${selector} must use the tested token`);
  }
  for (const selector of ['.boundary, .muted', '.evidence-grid b', '.run-events span']) {
    assert.match(declarationsFor(selector), /font-size:\s*(?:8|9|11)px/);
  }
  assert.match(declarationsFor('.run-events > div'), /flex-wrap:\s*wrap/);
  assert.match(declarationsFor('.run-events > div'), /min-width:\s*0/);
  assert.match(declarationsFor('.run-events span'), /min-width:\s*0/);
  assert.match(declarationsFor('.run-events span'), /overflow-wrap:\s*anywhere/);
  assert.match(declarationsFor('.run-section p, .run-section li'), /overflow-wrap:\s*anywhere/,
    'long evidence hashes and citation identifiers wrap within the mobile run panel');
});

test('Execution accent, status, and focus colors remain separately defined', () => {
  assert.match(css, /--exec:\s*#f2a65a/i);
  assert.match(css, /\.status-SUCCEEDED\s*\{\s*color:\s*var\(--mint-2\)/);
  assert.match(css, /\.process-task-status:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--exec\)/);
  assert.match(css, /\.run-status:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--exec\)/,
    'keyboard focus handed to a terminal run status remains visible');
});
