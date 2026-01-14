## Description

<!-- Provide a clear and concise description of your changes -->

## Why is this change needed?

<!-- Explain the problem this PR solves or the feature it adds -->
<!-- Link to related issues: Fixes #123, Closes #456 -->

## What changes were made?

<!-- Describe the technical changes in detail -->
<!-- List the key files/components modified -->

## Affected Components

<!-- Check all that apply -->

- [ ] Frontend (Web UI - `@selva/frontend`)
- [ ] Plugin (C# Grasshopper component)
- [ ] Schema (JSON Schema / Type definitions)
- [ ] Core (`@selva/compute`)
- [ ] Svelte UI (`@selva/svelte-ui`)
- [ ] Communication (WebSocket/HTTP)
- [ ] Build System
- [ ] Documentation

## Type of Change

<!-- Check all that apply -->

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update
- [ ] Refactoring (no functional changes)
- [ ] Performance improvement
- [ ] Testing improvements

## Testing

<!-- Describe the tests you ran to verify your changes -->
<!-- Provide instructions so reviewers can reproduce -->

### Manual Testing

- [ ] Tested on Windows - Rhino 8
- [ ] Tested on macOS - Rhino 8

### Automated Testing

- [ ] Added/updated unit tests
- [ ] All tests pass (`pnpm test`)
- [ ] Type checking passes (`pnpm type-check`)

## Checklist

<!-- Ensure you have completed these steps -->

- [ ] My code follows the project's code style guidelines
- [ ] I have added comments only for complex logic or non-obvious decisions
- [ ] I have updated the documentation if needed
- [ ] I have run `./generate-schemas.sh` if I modified JSON Schema definitions
- [ ] I have run `pnpm build:plugin` to verify the production build works
- [ ] My changes generate no new warnings or errors
- [ ] I have tested the WebSocket communication if modified
- [ ] I have verified schema persistence in .gh files if modified

## Breaking Changes

<!-- If this is a breaking change, describe the migration path for users -->
<!-- What do users need to change in their existing workflows? -->

## Screenshots / Videos

<!-- If applicable, add screenshots or videos demonstrating the changes -->

## Additional Context

<!-- Add any other context about the PR here -->
<!-- Links to related PRs, design documents, or discussions -->
