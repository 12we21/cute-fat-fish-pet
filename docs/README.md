# Documentation

English-first where it matters (the front page and the security/contribution docs); some maintainer notes are still Chinese and are named `*.zh-CN.md` so it is obvious at a glance.

| Document | Language | What is in it |
| --- | --- | --- |
| [release-notes-1.1.2.md](release-notes-1.1.2.md) | EN + 中文 | 1.1.2 release notes — the online model no longer says its thinking out loud: what changed, download hashes, known limitations |
| [release-notes-1.1.1.md](release-notes-1.1.1.md) | EN + 中文 | 1.1.1 release notes — the portable zip installs and uninstalls on a double-click: what changed, download hashes, known limitations |
| [known-issues.md](known-issues.md) | EN + 中文 | Defects confirmed in shipped builds: symptom → reproduction → root cause → fix (the portable-zip `安装.cmd`/uninstall problems and KI-6, the spoken thinking, live here) |
| [release-notes-1.1.0.md](release-notes-1.1.0.md) | EN + 中文 | 1.1.0 release notes — the first public release: what the release is, download hashes, what changed, known limitations |
| [development-log.md](development-log.md) | EN + 中文 | Development log — goal → change → verification → commit, for every milestone, with the commands to check it |
| [differences-from-upstream.md](differences-from-upstream.md) | EN + 中文 | Every file that differs from upstream dsh-pet 0.3.0, with sizes and SHA-256, plus how to reproduce the comparison |
| [architecture-roadmap.zh-CN.md](architecture-roadmap.zh-CN.md) | 中文 | Roadmap: host-coupling removal (`resolveActivePetId` and friends), control-bridge security, long-term plans — with real file:line anchors |
| [how-to-publish.zh-CN.md](how-to-publish.zh-CN.md) | 中文 | How a release is published: build, verify, tag, upload, and the ASCII-file-name rule |
| [code-signing.zh-CN.md](code-signing.zh-CN.md) | 中文 | Code signing: why the binaries are unsigned, what signing would cost and involve |
| [history/release-notes-1.0.0.zh-CN.md](history/release-notes-1.0.0.zh-CN.md) | 中文 | The 1.0.0 notes, kept for the record. 1.0.0 was an internal milestone and was never published publicly |
| [images/](images) | — | Screenshots and the animated demo used by the README |

Related files outside this directory: [../README.md](../README.md) (English front page), [../README.zh-CN.md](../README.zh-CN.md) (Chinese front page), [../SECURITY.md](../SECURITY.md), [../CONTRIBUTING.md](../CONTRIBUTING.md), [../NOTICE.md](../NOTICE.md).

### Reading order for a reviewer

1. [differences-from-upstream.md](differences-from-upstream.md) — what came from where.
2. [development-log.md](development-log.md) — what was changed, when and how it was verified.
3. [release-notes-1.1.2.md](release-notes-1.1.2.md) — what the current release contains ([1.1.1](release-notes-1.1.1.md) for the portable-zip fixes, [1.1.0](release-notes-1.1.0.md) for the first public release).
4. [SECURITY.md](../SECURITY.md) — the local-port hardening and what the app can do on your machine.
