export function normalizeServiceName(name: string) {
  return name.trim().toLowerCase();
}

function normalizedServiceWords(name: string) {
  return normalizeServiceName(name)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function includesConsecutiveWords(words: readonly string[], phrase: readonly string[]) {
  if (!phrase.length || words.length < phrase.length) return false;
  return words.some((_, index) => phrase.every((word, phraseIndex) => words[index + phraseIndex] === word));
}

function isQuoteLikeServiceName(serviceName: string) {
  const words = normalizedServiceWords(serviceName);
  if (!words.length) return false;

  const hasQuoteLanguage = words.some((word) => word === "quote" || word === "quotes" || word === "estimate" || word === "estimates");
  if (!hasQuoteLanguage) return false;

  return includesConsecutiveWords(words, ["new", "system"]) || words.includes("drainage") || words.includes("installation");
}

export function excludedServiceNameSet(names: readonly string[]) {
  return new Set(names.map(normalizeServiceName).filter(Boolean));
}

export function isExcludedServiceName(
  serviceName: string | null | undefined,
  excluded: ReadonlySet<string> | string[],
) {
  if (!serviceName) return false;
  if (isQuoteLikeServiceName(serviceName)) return true;
  const excludedSet = Array.isArray(excluded) ? excludedServiceNameSet(excluded) : excluded;
  if (!excludedSet.size) return false;
  return excludedSet.has(normalizeServiceName(serviceName));
}
