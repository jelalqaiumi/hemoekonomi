export const ORE_PER_SEK = 100;

export function normalizeZero(value) {
  return Object.is(value, -0) ? 0 : value;
}

export function sekToOre(amountSek) {
  if (!Number.isFinite(amountSek)) {
    throw new RangeError('sekToOre kräver ett finit tal.');
  }
  return normalizeZero(Math.round(amountSek * ORE_PER_SEK));
}

export function oreToSek(ore) {
  if (!Number.isSafeInteger(ore)) {
    throw new RangeError('oreToSek kräver ett säkert heltal öre.');
  }
  return normalizeZero(ore / ORE_PER_SEK);
}

export function divideRoundHalfUp(numerator, denominator) {
  if (!Number.isInteger(numerator)) {
    throw new RangeError('divideRoundHalfUp kräver ett heltal som täljare.');
  }
  if (!Number.isInteger(denominator)) {
    throw new RangeError('divideRoundHalfUp kräver ett heltal som nämnare.');
  }
  if (denominator <= 0) {
    throw new RangeError('divideRoundHalfUp kräver en nämnare större än 0.');
  }
  if (!Number.isSafeInteger(2 * numerator + denominator)) {
    throw new RangeError('divideRoundHalfUp kräver att 2 * täljaren + nämnaren är ett säkert heltal.');
  }
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

const SEK_FORMATTER = new Intl.NumberFormat('sv-SE', {
  style: 'currency',
  currency: 'SEK',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export function formatSek(ore) {
  return SEK_FORMATTER.format(oreToSek(ore));
}
