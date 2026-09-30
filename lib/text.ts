// Small text helpers shared by the corpus builder and runtime.
export const lawKeyOf = (name: string) => name.replace(/[\s·ㆍᆞ‧・「」]/g, "").normalize("NFKC").replace(/[\sᆞ]/g, "");

export function formatDate(d: string) {
  const m = d.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : d;
}
