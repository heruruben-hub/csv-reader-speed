// A fast drop-in replacement for csv-reader 1.0.0: run(input) returns csv-reader's exact answer
// {columns, rows, errors} for every input {text, header}, reading the text once, left to right,
// under the same broken-row policy:
//
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled, "" inside it one
//     quote, and each CRLF or lone CR inside it is read as LF; what follows its closing quote, up to
//     the next comma or line break, is appended as it stands (quote_junk, when the field ends); a
//     quote that never closes is a literal character, and the text after it is read again as an
//     unquoted field (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings;
//   - columns is the first record when header is true, else null; rows holds the records after it
//     (every record when header is false), each padded with "" (short_row, with fields: its count)
//     or cut (long_row, with extra: the cut fields) to the first record's width;
//   - each error is {code, line, row}: line the 1-based line its record starts on (every LF, CRLF
//     and lone CR inside a quoted field counted), row its record's index in rows (null for the
//     header), in the order met.
//
// Where the reference walks one character at a time and builds each field character by character,
// this reader scans by char code and cuts each field out of the text with one slice wherever the
// characters allow it. The whole parse runs as one loop over the text with the field readers
// inlined into it, so the common record costs no call and no result object; it diverts to a
// character-at-a-time walk only on the rare broken paths (a stray CR inside an unquoted field, the
// tail after an unterminated quote). Pure: no clock, no randomness, nothing kept between calls.

// How a field ended.
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // Walks the rest of an unquoted field a character at a time, from a stray CR at pos, with the
  // field's already-kept prefix in `value` and its kept count in `added`. This is the plain
  // reader's own walk, kept for the broken paths where a slice cannot speak for the characters:
  // stray CRs are dropped one error at a time. Sets `ended` and returns the field's whole value.
  let ended = END;
  function walkUnquotedTail(value, added) {
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        ended = COMMA;
        return { value, added };
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        ended = LINE_BREAK;
        return { value, added };
      }
      if (c === 13) {
        if (text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line += 1;
          ended = LINE_BREAK;
          return { value, added };
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        pos += 1;
        continue;
      }
      value += text[pos];
      added += 1;
      pos += 1;
    }
    ended = END;
    return { value, added };
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      if (text.charCodeAt(pos) === 10) {
        pos += 1;
        line += 1;
      } else if (text.charCodeAt(pos) === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;

    // The record's fields, one at a time, until one ends at a line break or at the text's end.
    for (;;) {
      let value;
      if (text.charCodeAt(pos) === 34) {
        // A quoted field. Its characters are cut out of the text in slices: a segment runs until
        // the next quote or CR, the two characters that can change it (a quote may close the field
        // or double; a CR or CRLF inside quotes is read as one LF), and the segments are joined
        // once at the closing quote.
        quoted = true;
        const open = pos;
        const openLine = line;
        let parts = null; // the segments cut so far, once the field needs more than one
        let segStart = open + 1;
        let i = segStart;
        let closed = false;
        while (i < n) {
          const c = text.charCodeAt(i);
          if (c === 34) {
            if (text.charCodeAt(i + 1) === 34) {
              // A doubled quote: one quote in the field, and the field goes on.
              if (parts === null) parts = [text.slice(segStart, i), '"'];
              else parts.push(text.slice(segStart, i), '"');
              i += 2;
              segStart = i;
              continue;
            }
            closed = true;
            break;
          }
          if (c === 13) {
            // CRLF and a lone CR inside quotes are each read as one LF.
            if (parts === null) parts = [text.slice(segStart, i), '\n'];
            else parts.push(text.slice(segStart, i), '\n');
            line += 1;
            i += text.charCodeAt(i + 1) === 10 ? 2 : 1;
            segStart = i;
            continue;
          }
          if (c === 10) line += 1;
          i += 1;
        }
        if (!closed) {
          // The quote never closes: it is a literal character, and the text after it is read
          // again as an unquoted field, from just past the quote, on the line the quote opened on.
          pos = open + 1;
          line = openLine;
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          const tail = walkUnquotedTail('"', 0);
          value = tail.value;
          fields.push(value);
          if (ended === COMMA) continue;
          break;
        }
        if (parts === null) value = text.slice(segStart, i);
        else {
          parts.push(text.slice(segStart, i));
          value = parts.join('');
        }
        i += 1; // past the closing quote
        if (i >= n) {
          pos = n;
          ended = END;
          fields.push(value);
          break;
        }
        const d = text.charCodeAt(i);
        if (d === 44) {
          pos = i + 1;
          ended = COMMA;
          fields.push(value);
          continue;
        }
        if (d === 10) {
          pos = i + 1;
          line += 1;
          ended = LINE_BREAK;
          fields.push(value);
          break;
        }
        if (d === 13 && text.charCodeAt(i + 1) === 10) {
          pos = i + 2;
          line += 1;
          ended = LINE_BREAK;
          fields.push(value);
          break;
        }
        // What follows the closing quote is appended as it stands, up to the next comma or line
        // break; it is junk only when something was in fact appended. The tail is scanned like an
        // unquoted field with the quoted value as its prefix.
        {
          const start = i;
          let j = i;
          while (j < n) {
            const c = text.charCodeAt(j);
            if (c === 44 || c === 10 || c === 13) break;
            j += 1;
          }
          if (j < n && text.charCodeAt(j) === 13 && text.charCodeAt(j + 1) !== 10) {
            // A stray CR in the junk: finish the field with the character walk.
            pos = j;
            const tail = walkUnquotedTail(value + text.slice(start, j), j - start);
            value = tail.value;
            if (tail.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
            fields.push(value);
            if (ended === COMMA) continue;
            break;
          }
          if (j >= n) {
            pos = n;
            ended = END;
          } else if (text.charCodeAt(j) === 44) {
            pos = j + 1;
            ended = COMMA;
          } else if (text.charCodeAt(j) === 10) {
            pos = j + 1;
            line += 1;
            ended = LINE_BREAK;
          } else {
            pos = j + 2;
            line += 1;
            ended = LINE_BREAK;
          }
          if (j > start) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
          value = value + text.slice(start, j);
          fields.push(value);
          if (ended === COMMA) continue;
          break;
        }
      }
      // An unquoted field: scan to its comma or line break and cut it out with one slice. A CR
      // that is not part of a CRLF diverts to the character walk.
      quoted = false;
      {
        const start = pos;
        let i = pos;
        while (i < n) {
          const c = text.charCodeAt(i);
          if (c === 44 || c === 10 || c === 13) break;
          i += 1;
        }
        if (i < n && text.charCodeAt(i) === 13 && text.charCodeAt(i + 1) !== 10) {
          pos = i;
          const tail = walkUnquotedTail(text.slice(start, i), i - start);
          value = tail.value;
          fields.push(value);
          if (ended === COMMA) continue;
          break;
        }
        if (i >= n) {
          pos = n;
          ended = END;
        } else if (text.charCodeAt(i) === 44) {
          pos = i + 1;
          ended = COMMA;
        } else if (text.charCodeAt(i) === 10) {
          pos = i + 1;
          line += 1;
          ended = LINE_BREAK;
        } else {
          pos = i + 2;
          line += 1;
          ended = LINE_BREAK;
        }
        value = text.slice(start, i);
        fields.push(value);
        if (ended === COMMA) continue;
        break;
      }
    }

    // A line that held only stray CRs is left with no characters: no record (its errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
