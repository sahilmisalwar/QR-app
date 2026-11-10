import type { Team, Category } from "./types";
export function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function parseRoster(csv: string): Array<Omit<Team, "id">> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && csv[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  row.push(field);
  if (row.some((x) => x.trim())) rows.push(row);
  const headers = rows.shift()?.map((x) =>
    x
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase(),
  );
  if (
    !headers ||
    ["code", "name", "college", "category", "members"].some(
      (x) => !headers.includes(x),
    )
  )
    throw new Error(
      "Use the template columns code, name, college, category and members.",
    );
  const codes = new Set<string>();
  const teams = rows.map((cells, index) => {
    const get = (key: string) => cells[headers.indexOf(key)]?.trim() ?? "";
    const code = get("code").toUpperCase();
    const category = get("category").toUpperCase();
    if (
      !code ||
      !get("name") ||
      !get("college") ||
      !["A", "B", "C"].includes(category) ||
      !get("members")
    )
      throw new Error(`Row ${index + 2} has missing or invalid fields.`);
    if (codes.has(code))
      throw new Error(`Team code ${code} occurs more than once.`);
    codes.add(code);
    return {
      code,
      name: get("name"),
      college: get("college"),
      category: category as Category,
      members: get("members")
        .split("|")
        .map((x) => x.trim())
        .filter(Boolean),
      active: true,
    };
  });
  if (!teams.length || teams.length > 1000)
    throw new Error("Import between 1 and 1,000 teams at a time.");
  return teams;
}
