# Documentation Index

Welcome to the anthropic-oauth documentation. This directory contains comprehensive guides, architecture documentation, and development standards.

> **Platform notice**: This project has been tested and confirmed working on **macOS** with
> **OpenCode v1.2.27**. Other platforms and OpenCode versions may work but are untested.

## Getting Started

If you're new to this library, start here:

1. **[Setup Guide](./SETUP_SUMMARY.md)** - Initial installation and configuration
2. **[Main README](../README.md)** - Quick start and API overview
3. **[OpenCode Integration](./OPENCODE_INTEGRATION.md)** - Connect with OpenCode
4. **[Version Downgrade](./VERSION_DOWNGRADE.md)** - Pinning OpenCode to v1.2.27

## Architecture & Design

### [Architecture Documentation](./ARCHITECTURE.md)

Complete system design with Mermaid diagrams covering:

- System architecture and component interactions
- OAuth authentication flow
- Token lifecycle management
- Request pipeline and header construction
- Error handling patterns
- OpenCode integration flow

**Visual Aids**: 10+ Mermaid diagrams illustrating system behavior

## Integration Guides

### [OpenCode Integration](./OPENCODE_INTEGRATION.md)

Comprehensive guide for syncing OAuth credentials to OpenCode:

- Quick start (2-step process)
- Credential storage locations
- Troubleshooting common issues
- Security considerations

### [OAuth Patches](./OAUTH_PATCHES.md)

Details on critical OAuth authentication fixes:

- User-agent spoofing (`claude-cli/2.1.87 (external, cli)`)
- RFC 6749 compliance (form-urlencoded)
- Beta headers and request transformations
- Implementation notes and references

### [Version Downgrade](./VERSION_DOWNGRADE.md)

Instructions for pinning OpenCode to the confirmed-working v1.2.27:

- Homebrew-based downgrade via `brew extract`
- Pinning to prevent unintended upgrades
- Optional backup to private GitHub repository

## Development

### [Project Guidelines (.opencode/rules.md)](../.opencode/rules.md)

Development conventions and coding standards:

- Runtime & API requirements (Bun-only)
- TypeScript configuration (ESNext, TypeScript 6.0, strict mode)
- Effect-TS patterns and best practices
- Code quality standards
- Commit message format

### [Questions Answered](./QUESTIONS_ANSWERED.md)

FAQ and common questions with detailed answers

## Additional Resources

### External Documentation

- [Bun Documentation](https://bun.sh/docs) - Runtime reference
- [Effect-TS Documentation](https://effect.website) - Functional programming library
- [OAuth 2.0 RFC 6749](https://datatracker.ietf.org/doc/html/rfc6749) - OAuth specification
- [PKCE RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636) - PKCE extension
- [Anthropic API Docs](https://docs.anthropic.com) - API reference

### Related Projects

- [OpenCode](https://github.com/anomalyco/opencode) - AI coding assistant (use v1.2.27)
- [Claude Code](https://github.com/anthropics/claude-code) - Official Claude CLI
- [OpenAuth](https://github.com/openauthjs/openauth) - OAuth library used for PKCE

## Quick Links

### Common Tasks

| Task                    | Documentation                                     |
| ----------------------- | ------------------------------------------------- |
| First time setup        | [Setup Guide](./SETUP_SUMMARY.md)                 |
| Connect to OpenCode     | [OpenCode Integration](./OPENCODE_INTEGRATION.md) |
| Pin OpenCode to v1.2.27 | [Version Downgrade](./VERSION_DOWNGRADE.md)       |
| Understand architecture | [Architecture](./ARCHITECTURE.md)                 |
| Fix OAuth errors        | [OAuth Patches](./OAUTH_PATCHES.md)               |
| Coding standards        | [rules.md](../.opencode/rules.md)                 |
| API reference           | [Main README](../README.md)                       |

### Troubleshooting

| Issue                          | Solution                                                            |
| ------------------------------ | ------------------------------------------------------------------- |
| "x-api-key header is required" | [OpenCode Integration](./OPENCODE_INTEGRATION.md#troubleshooting)   |
| 429 rate limiting              | [OAuth Patches](./OAUTH_PATCHES.md#1-user-agent-spoofing)           |
| Token expired                  | [Architecture - Token Lifecycle](./ARCHITECTURE.md#token-lifecycle) |
| Invalid credentials            | [Setup Guide](./SETUP_SUMMARY.md)                                   |
| Wrong OpenCode version         | [Version Downgrade](./VERSION_DOWNGRADE.md)                         |

## Document Organization

```
docs/
├── README.md                    # This file - documentation index
├── ARCHITECTURE.md              # System design with Mermaid diagrams
├── OPENCODE_INTEGRATION.md      # OpenCode sync guide
├── OAUTH_PATCHES.md             # Authentication fixes explained
├── SETUP_SUMMARY.md             # Initial setup instructions
├── OPENCODE_USAGE.md            # OpenCode usage reference
├── VERSION_DOWNGRADE.md         # Pinning OpenCode to v1.2.27
├── QUESTIONS_ANSWERED.md        # FAQ and Q&A
└── prod-ready.md                # Production readiness analysis
```

## Contributing to Documentation

When adding or updating documentation:

1. **Use Mermaid diagrams** for visual explanations
2. **Add examples** with code blocks
3. **Cross-reference** related documents
4. **Update this index** when adding new docs
5. **Keep it concise** - link to external docs for deep dives

### Mermaid Diagram Types

We use these diagram types throughout the documentation:

- **Flowcharts** (`graph TB`) - Process flows and decision trees
- **Sequence diagrams** (`sequenceDiagram`) - API interactions
- **State diagrams** (`stateDiagram-v2`) - Token lifecycle
- **Class diagrams** (`classDiagram`) - Type hierarchies

### Documentation Standards

- Use GitHub-flavored Markdown
- Code blocks must specify language for syntax highlighting
- Headers use ATX style (`#` prefix)
- Links use reference style for long URLs
- Maximum line length: 120 characters (except code/diagrams)

## Feedback

Found an issue or have suggestions for documentation improvements?

1. Check existing docs for similar topics
2. Open an issue on GitHub
3. Submit a pull request with fixes

---

**Last Updated**: 2026-03-23
**Maintained By**: [cipher-rc5](https://github.com/cipher-rc5/anthropic-oauth)
