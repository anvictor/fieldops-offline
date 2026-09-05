# FieldOps Offline — Project Conventions

## Development & Deployment

Deployment is part of development and must not be postponed until the end of the project.

Standard workflow:

local development
→ Git commit
→ push to GitHub
→ automatic build / CI
→ public deployment
→ live verification

### Rules

- Establish a public deployment early in the project.
- Keep the public version updated as features are added.
- GitHub is the central remote repository.
- Once the repository is available through the connected GitHub integration, ChatGPT should read and modify repository files directly whenever possible.
- Avoid unnecessary copy/paste of source code between Viktor and ChatGPT.
- Local and remote code are synchronized using Git push and Git pull.
- Prefer free-tier hosting suitable for a public recruiter portfolio demo.
- External hosting may require Viktor to perform a one-time account authorization.
- Passwords, access tokens, and private credentials must never be shared in chat.
- CI/CD and deployment configuration should evolve together with the application.
- The project should remain publicly demonstrable throughout development.

## Learning Principle

The goal is not only to build the application, but to understand the technologies used in it well enough to explain them during technical interviews.

Implementation should therefore progress in small understandable steps rather than hiding important concepts behind automation.
