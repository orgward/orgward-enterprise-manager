const MAX_NOTES = 20;
const MAX_NOTE_LENGTH = 1000;

export function parseHumanTaskEvidence(value) {
  if (typeof value !== 'string') return null;
  const notes = value.split('\n').map((entry) => entry.trim()).filter(Boolean);
  if (notes.length > MAX_NOTES || notes.some((entry) => entry.length > MAX_NOTE_LENGTH)) return null;
  return notes;
}
