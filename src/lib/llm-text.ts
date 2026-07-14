export function cleanModelOutput(text: string): string {
  return text
    .trim()
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractText).find(Boolean) ?? "";
  if (!value || typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  for (const key of ["output", "text", "response", "content", "message", "data"]) {
    const text = extractText(record[key]);
    if (text) return text;
  }
  return extractText(record.choices);
}
