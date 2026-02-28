export function replaceRawMigrateHint(message: string): string {
  return message.replace(
    /Fiber need to run some database migrations, please run `fnn-migrate[^`]*` to start migrations\.?/g,
    'Fiber database migration is required.',
  );
}

export function normalizeMigrationCheck<T extends { message: string }>(check: T): T {
  return {
    ...check,
    message: replaceRawMigrateHint(check.message),
  };
}
