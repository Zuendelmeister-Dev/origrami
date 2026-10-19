# Repository contents

The repository contains source code, tests, Docker/Compose files, helper scripts, package definitions and the lockfile, licence, documentation and its images. Screenshots show local test accounts and sample data. Documentation and diagrams use relative file links, not personal machine paths.

Builds, tests and live development use [Docker tooling](builds.md), so dependency trees and generated files are never required in the host checkout. Images and build caches occupy Docker storage instead. The only setup output in the checkout is the ignored local `.env`.

## Keep local

The [ignore rules](../.gitignore) exclude the following files in particular:

| Local only, not in Git | Reason |
|---|---|
| `.env` and other local `.env.*` files | Actual configuration and credentials |
| Private keys and `service-password` | Operational secrets |
| Databases, management state and Docker volume data | Accounts, receipts, roles and other runtime data |
| Backups, database dumps and logs | May contain confidential information |
| `node_modules`, `dist`, build and coverage files | Reproducible from source and the lockfile |
| Python caches, virtual environments, editor and temporary files | Machine-specific development files |

The explicitly allowed [.env.example](../.env.example) contains only a placeholder and the documented test superuser ID. `package-lock.json`, tests, Compose files and the four documentation screenshots belong in the repository. `alice/alice` and `bob/bob` are intentionally published local test credentials, not operational secrets.

## Before pushing

In an initialised Git repository:

```sh
git status --short
git diff --check
git diff --cached --stat
git diff --cached
```

Review staged changes for real passwords or tokens, private request receipts, other people's conversations and personal paths. A `.gitignore` does not remove already tracked files. Remove such files from the index deliberately; credentials that have already been published must also be rotated.

A local source folder may have no `.git` directory. In that case, its actual staging or push contents cannot yet be inspected. Ignore rules apply when Git is used. When transferring into a new repository, copy project files only, not local configuration, installed dependencies or runtime data.
