/** The workspace's icon library holds as much as it may; said with what it holds. */
export class IconLibraryFullError extends Error {
  constructor(
    readonly count: number,
    readonly bytes: number,
  ) {
    super('The icon library is full.');
    this.name = 'IconLibraryFullError';
  }
}
