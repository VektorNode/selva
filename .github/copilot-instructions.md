# Selva Project – GitHub Copilot Custom Instructions

## 1. Project Overview

Selva is a cross-platform Rhino Grasshopper plugin with a SvelteKit web UI. The backend is in C# (.NET multi-target: net48 and net7.0). The frontend is SvelteKit with TypeScript and Tailwind CSS. Copilot should use this context when generating code, explanations, review comments, or test scaffolding.

## 2. Tech Stack and Tooling

- C# (.NET 7.0 and .NET Framework 4.8) for backend logic and plugin hooks.
- SvelteKit + TypeScript + Tailwind CSS for frontend UI.
- Build and package using .NET CLI for backend and npm (or pnpm) for frontend.
- Testing: use existing test frameworks for C# (e.g., xUnit) and frontend tests (e.g., Playwright or Vitest) where defined.

## 3. Build, Test, Run, and Validate

Include how to build and validate changes so Copilot doesn’t need to search for commands:

- Backend build: `dotnet build -c Release` at solution root.
- Backend tests: `dotnet test --no-build`.
- Frontend build: `npm install` then `npm run build`.
- Frontend tests: `npm test`.
- Typical validation steps: build both backend and frontend, confirm plugin loads in Rhino and UI works in supported browsers.
  Prompt Copilot to use explicit commands and versions if available.

## 4. Code Style and Conventions

- Write self-documenting code; avoid unnecessary abstractions.
- Comment only complex logic; otherwise rely on clear naming.
- Consistent formatting for C#, TS, and Svelte.
- Follow existing patterns in the repository for naming, modularity, and structure.
  When Copilot suggests code, prioritize consistency with existing idioms.

## 5. Error and Boundary Handling

- Add error handling at system boundaries: user input, external API calls, build/test boundaries.
- Avoid unnecessary try/catch blocks inside pure logic paths.
- Prefer failing loudly in development with clear diagnostics over silent catch-all.

## 6. Commit Message Format

When asked to help generate commit messages:

- Use present tense (“Add feature” not “Added feature”).
- Start with one of: feat, fix, docs, style, refactor, test, chore.
- Keep concise and descriptive.
- If relevant, reference issue number.
- Use bullet points for multiple changes.

## 7. Do Not

- Do not generate code that assumes unspecified new frameworks or tooling not in this repo.
- Do not bypass documented build/test steps.
- Do not assume configurations or conventions not defined in existing config files or docs.

## 8. When Writing Tests or Validation Scripts

- Use existing test frameworks already in the repository.
- Follow the project’s style for tests.
- Provide clear descriptions and intent in test names.

## 9. When Reviewing Code or Explaining Behavior

- Reference the tech stack and conventions above.
- Provide actionable suggestions and code examples that integrate seamlessly.
