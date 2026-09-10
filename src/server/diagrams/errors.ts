/** Thrown by the repository when a diagram or version id points at nothing. */
export class DiagramNotFoundError extends Error {
  constructor(id: string) {
    super(`Diagram not found: ${id}`);
    this.name = 'DiagramNotFoundError';
  }
}

export class VersionNotFoundError extends Error {
  constructor(id: string) {
    super(`Version not found: ${id}`);
    this.name = 'VersionNotFoundError';
  }
}
