import type { Role } from '@/lib/domain';

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

/**
 * The diagram exists, and this person may not do that with it. `required` is
 * the least role that could; `ownerName` lets the interface say whom to ask.
 */
export class DiagramForbiddenError extends Error {
  constructor(
    readonly diagramId: string,
    readonly required: Role,
    readonly ownerName: string | null = null,
  ) {
    super(`No ${required} access to diagram: ${diagramId}`);
    this.name = 'DiagramForbiddenError';
  }
}

/** Inviting by e-mail only works for people who have signed in at least once. */
export class UserNotFoundError extends Error {
  constructor(readonly email: string) {
    super('No account with that e-mail has signed in yet.');
    this.name = 'UserNotFoundError';
  }
}

/** A member change that makes no sense: touching the owner's own row. */
export class MembershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MembershipError';
  }
}
