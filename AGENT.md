# AI Maintainer Workflow

1. Use plan mode to create a clear implementation plan.
2. Execute the plan in small, focused changes.
3. Run required validation/tests before proposing merge.
4. Add a changeset if package code changed.
5. Use `gh` to push, create a PR, and request review from GitHub Copilot; if no changeset is included, add the `skip-changeset` label to the PR.
6. Wait for review comments, read them with `gh`, apply needed updates, and re-run validation.

For detailed policy, commands, and release rules, follow `docs/develop.md`.
