// Where a note points, in words (the same wording as the screen, see public/common.js).
export function noteWhere(note) {
  if (note.page) {
    if (note.page_kind === "print") return `p. ${note.page} (print edition)`;
    if (note.page_kind === "computed") return `p. ${note.page} (counted by the app)`;
    return `p. ${note.page}`;
  }
  if (note.percent !== null && note.percent !== undefined) return `${Number(note.percent).toFixed(1)}% of the book`;
  return "";
}
