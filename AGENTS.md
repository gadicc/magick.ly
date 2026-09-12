<!-- loom-managed:agents:start -->
## Loom
This repo consumes `@gadicc/loom`.

For all work in this repo:
1. Use the `loom` skill first.
2. Read `loom.json` before making Loom-related changes.
3. Treat active Loom features and configured paths as the contract between the app and the shared package.
4. Read `project.tooling` in `loom.json`; do not assume tasks live in `package.json` or that pnpm is the runner.
5. If the task touches a specific active Loom feature, also use the matching feature skill such as `loom-jobs`.
6. Next commands load `.env*` themselves; non-Next commands that need env should use the authoritative project task or `loom env -- <command>`, not inline env-loader imports.
7. Keep project-specific rules outside this managed block; shared Loom policy lives in the `loom` skill.
8. For code and design reviews, use `loom-torvalds-review` before `linus-torvalds-skill`; its context profiles and precedence rules override literal kernel guidance.
<!-- loom-managed:agents:end -->
