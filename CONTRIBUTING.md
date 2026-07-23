# Contributing to Slim Router

Thank you for considering contributing to Slim Router! We welcome contributions of all kinds: bug reports, feature requests, documentation improvements, and code changes.

## Code of Conduct

This project is committed to providing a welcoming, inclusive environment for everyone. By participating, you agree to:

- Be respectful and constructive in all communications
- Focus on what is best for the project and its users
- Accept constructive criticism gracefully
- Show empathy towards other community members

## How to Contribute

### Reporting Bugs

1. **Check existing issues** — Search the [issue tracker](https://github.com/green-dalii/pi-slim-router/issues) before filing a duplicate.
2. **Use a clear title** — Summarize the problem concisely.
3. **Provide reproduction steps** — Include the exact command, expected behavior, and actual behavior.
4. **Include environment info** — pi-agent version, OS, Node.js version.

### Feature Requests

1. **Open an issue** first to discuss the feature before implementing.
2. **Describe the problem** you're trying to solve, not just your proposed solution.
3. **Consider scope** — Small, focused changes have a much higher chance of acceptance.

### Pull Requests

1. **Fork the repository** and create a feature branch from `main`.
2. **Follow the code philosophy:**
   - Prefer pure functions over classes and mutable state
   - Keep files small and focused on one responsibility
   - Avoid adding external dependencies
   - Flat code over nested — early return, extract helpers
   - Delete code before adding it — ask "is this truly needed?"
3. **Write clear commit messages** with the module prefix:
   - `feat:` — New feature
   - `fix:` — Bug fix
   - `refactor:` — Code restructuring
   - `docs:` — Documentation changes
   - `test:` — Test additions or changes
   - `chore:` — Build/config changes
4. **Keep PRs focused** — One logical change per PR. Large changes should be broken into smaller PRs.
5. **Update documentation** — README, SPEC, and inline code comments as needed.

### Development Setup

```bash
git clone https://github.com/green-dalii/pi-slim-router.git
cd pi-slim-router
npm install
npm run typecheck
```

### Type Checking

```bash
npm run typecheck
```

This project is pure TypeScript with strict mode enabled. Ensure your changes pass type checking before submitting.

## Architecture Notes

```
src/
├── index.ts       # Entry point: pi-agent lifecycle hooks
├── router.ts      # Core routing engine
├── judge.ts       # Two-stage classifier (LLM + heuristic)
├── tier.ts        # Tier validation and model lookup
├── config.ts      # Configuration persistence
├── commands.ts    # Slash command handlers
└── types.ts       # All type definitions and DEFAULT_CONFIG
```

**Dependency rule:** `index → router → judge|tier → config → types`. No circular imports.

## License

By contributing, you agree that your contributions will be licensed under the [Apache 2.0](LICENSE) license.
