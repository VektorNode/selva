# Contributing to ComputeBuilder

Thank you for your interest in contributing! This guide will help you get started.

## Development Setup

### Prerequisites

- .NET SDK 7.0+
- Node.js 18+
- Rhino 7 or 8 installed
- Git

### Initial Setup

1. **Clone the repository:**

```bash
git clone <repository-url>
cd ComputeBuilder
```

2. **Build the C# plugin:**

```bash
dotnet restore
dotnet build
```

3. **Install web dependencies:**

```bash
cd web
npm install
```

4. **Use the development scripts:**

```bash
# Windows
.\start-dev.ps1

# macOS/Linux
./start-dev.sh
```

## Development Workflow

### Making Changes

1. **Create a feature branch:**

```bash
git checkout -b feature/your-feature-name
```

2. **Make your changes following the project structure:**
   - C# code: Follow existing patterns in `Components/`, `Utils/`, `Models/`
   - Web code: Use SvelteKit conventions in `web/src/`
   - Types: Update JSON Schema in `schemas/ui-schema.json`

3. **Run schema generation if you modified types:**

```bash
./generate-schemas.sh
```

4. **Test your changes:**
   - Build the plugin: `dotnet build`
   - Install to Grasshopper
   - Restart Rhino completely
   - Test in Grasshopper with the web app running

### Code Style

**C#:**

- Follow Microsoft C# coding conventions
- Use meaningful variable names
- Add XML documentation for public APIs
- Keep methods focused and single-purpose

**TypeScript/Svelte:**

- Use TypeScript strict mode
- Follow Svelte component conventions
- Use Tailwind CSS for styling
- Prefer composition over large components

**General:**

- Write clear commit messages
- Keep PRs focused on single features/fixes
- Update documentation when adding features

## Important Rules

### Type Safety

- **NEVER edit generated files directly:**
  - `web/src/lib/types/generated/schema.ts`
  - `Plugin/Models/Generated/UISchema.Generated.cs`
- **Always modify `schemas/ui-schema.json` instead**
- Run `./generate-schemas.sh` after schema changes

### Parameter Validation

Only these parameter types are allowed:

- Parameters implementing `IGH_ContextualParameter`
- `ContextPrintComponent` (outputs)
- `ContextBakeComponent` (outputs)

### File Organization

- **Utilities** should be in `Utils/` directory
- **Data models** should be in `Models/`
- **Components** should be minimal orchestration only
- Use dependency injection patterns where possible

## Testing

### Manual Testing Checklist

- [ ] Plugin builds without errors
- [ ] Plugin loads in Grasshopper
- [ ] UI builder opens and saves schemas
- [ ] Preview mode connects via WebSocket
- [ ] Parameter values update in real-time
- [ ] Output data displays correctly
- [ ] Works on both Windows and macOS (if applicable)

### Automated Testing

Currently, the project uses manual testing. Automated tests are welcome contributions!

## Submitting Changes

1. **Ensure your code builds:**

```bash
dotnet build --configuration Release
cd web && npm run check
```

2. **Commit your changes:**

```bash
git add .
git commit -m "feat: Add descriptive commit message"
```

3. **Push to your fork:**

```bash
git push origin feature/your-feature-name
```

4. **Create a Pull Request:**
   - Provide clear description of changes
   - Reference any related issues
   - Include screenshots/demos if UI changes

## Common Development Tasks

### Adding a New Input Type

1. Update `schemas/ui-schema.json` to add the type
2. Run `./generate-schemas.sh`
3. Implement value handling in `ValueApplicator.cs`
4. Create Svelte component in `web/src/lib/components/ui/`
5. Update builder UI to support configuration

### Adding a New Output Type

1. Update `schemas/ui-schema.json`
2. Run `./generate-schemas.sh`
3. Implement serialization in output collection
4. Create display component in Svelte
5. Update builder UI

### Debugging Session Issues

- Session files location:
  - Windows: `%TEMP%\ComputeBuilder\`
  - macOS: `/tmp/ComputeBuilder/`
- Check browser DevTools network tab
- Check Grasshopper component messages
- Verify WebSocket connection on port 8765

## Architecture Decisions

When making significant changes:

1. Maintain separation between C# and TypeScript via JSON Schema
2. Keep WebSocket as primary communication method
3. Preserve Rhino Compute compatibility in parameter metadata
4. Favor simplicity over premature optimization
5. Document breaking changes clearly

## Questions or Issues?

- Check [CLAUDE.md](CLAUDE.md) for detailed documentation
- Open an issue for bugs or feature requests
- Start a discussion for architectural questions

## Code of Conduct

- Be respectful and constructive
- Focus on technical merit
- Welcome newcomers
- Assume good intentions

Thank you for contributing to ComputeBuilder!
