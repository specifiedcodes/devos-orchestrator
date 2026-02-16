# DevOS Orchestrator

![CI](https://github.com/devos-platform/devos-orchestrator/actions/workflows/ci.yml/badge.svg)

AI agent orchestration engine for the DevOS platform using Claude AI and BullMQ.

## Technology Stack

- **Runtime:** Node.js with TypeScript
- **AI:** Anthropic Claude SDK
- **Queue:** BullMQ
- **Storage:** Redis (ioredis)
- **Config:** dotenv, js-yaml
- **Logging:** Winston

## Getting Started

### Prerequisites

- Node.js 20.x or higher
- npm 10.x or higher
- Redis 6.x or higher

### Installation

1. Install dependencies:

```bash
npm install
```

2. Create environment file:

```bash
cp .env.example .env
```

3. Update the `.env` file with your Anthropic API key and configuration.

### Development

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Start

```bash
npm start
```

## Project Structure

```
devos-orchestrator/
├── src/
│   ├── agents/        # Agent definitions and spawning
│   ├── context/       # Context recovery system
│   ├── claude/        # Claude Code CLI integration
│   ├── queue/         # Task queue management
│   ├── workflows/     # BMAD workflow implementations
│   ├── config/        # Configuration loader
│   ├── utils/         # Shared utilities
│   └── main.ts        # Service entry point
├── .env.example       # Environment variables template
├── .gitignore         # Git ignore rules
├── package.json       # Dependencies and scripts
├── tsconfig.json      # TypeScript configuration
└── README.md          # This file
```

## License

MIT
