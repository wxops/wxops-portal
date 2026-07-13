export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/`[^`]*`/g, (m) => m.slice(1, -1))
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-");
}
