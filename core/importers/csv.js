// A small CSV reader for password-manager exports (RFC 4180): quoted fields, "" inside quotes, commas
// and line breaks inside quotes, CRLF / LF / CR row ends, a leading BOM. Pure text in, rows out.

/** @param {string} text @returns {string[][]} every row, blank lines dropped */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const endRow = () => {
    row.push(field);
    field = "";
    // A line with nothing on it is not a row.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };
  for (; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      // A line break inside a field is stored as LF, whatever the exporting OS wrote (CRLF on Windows).
      if (ch === "\r") {
        field += "\n";
        if (text[i + 1] === "\n") i += 1;
      } else if (ch !== '"') field += ch;
      else if (text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else quoted = false;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      endRow();
    } else field += ch;
  }
  if (quoted) throw new Error("The file ends inside a quoted field.");
  if (field !== "" || row.length) endRow();
  return rows;
}

/**
 * The first row is the header (lower-cased, trimmed). Each later row becomes { header: value }; the
 * first column of a repeated header wins. `row` is the row's number in the file, header = 1.
 * @param {string} text
 * @returns {{ headers: string[], records: { row: number, get: (name: string) => string, hasOther: (known: string[]) => boolean }[] }}
 */
export function csvTable(text) {
  const [head = [], ...body] = parseCsv(text);
  const headers = head.map((h) => h.trim().toLowerCase());
  const records = body.map((cells, n) => ({
    row: n + 2,
    get(name) {
      const at = headers.indexOf(name);
      return at >= 0 && typeof cells[at] === "string" ? cells[at] : "";
    },
    // True when a column outside `known` holds something: a field the source parser has no place for.
    hasOther(known) {
      return headers.some((h, at) => !known.includes(h) && typeof cells[at] === "string" && cells[at].trim() !== "");
    },
  }));
  return { headers, records };
}
