/** Sorts names A to Z by last name, then first name: "Tim Bilski" before "Amy Danielowski". */
export function byLastName(a: string, b: string): number {
  const key = (n: string) => {
    const words = n.trim().split(/\s+/);
    return `${words[words.length - 1]} ${words.slice(0, -1).join(' ')}`;
  };
  return key(a).localeCompare(key(b), undefined, { sensitivity: 'base' });
}
