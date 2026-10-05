/** Universal newlines: \r\n and a lone \r become \n. */
export function universalNewlines(s: string): string {
  return s.replace(/\r\n?/g, "\n");
}

/**
 * Wrap untrusted text in a Markdown code fence that the text cannot close: the fence is one
 * backtick longer than the longest backtick run inside it.
 */
export function fence(text: string): string {
  let longest = 0;
  for (const m of text.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  const f = "`".repeat(Math.max(3, longest + 1));
  return `${f}text\n${text}\n${f}`;
}
