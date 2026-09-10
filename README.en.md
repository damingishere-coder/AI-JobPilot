<div align="center">

<img src="front/public/toudi-niuma.svg" width="88" alt="AI JobPilot logo" />

# AI JobPilot · 投递牛马

**Spend your time on jobs worth applying for.**

Organize your resume, collect jobs, review AI matching evidence, and confirm applications from your own computer.

[简体中文](README.md) · [Download 1.5](https://github.com/damingishere-coder/AI-JobPilot/releases/tag/v1.5.0) · [Quick start](#quick-start) · [Documentation](docs/README.md) · [Report an issue](https://github.com/damingishere-coder/AI-JobPilot/issues)

[![Release](https://img.shields.io/github/v/release/damingishere-coder/AI-JobPilot?color=2563eb&label=release)](https://github.com/damingishere-coder/AI-JobPilot/releases/latest) [![CI](https://github.com/damingishere-coder/AI-JobPilot/actions/workflows/ci.yml/badge.svg)](https://github.com/damingishere-coder/AI-JobPilot/actions/workflows/ci.yml) [![CodeQL](https://github.com/damingishere-coder/AI-JobPilot/actions/workflows/codeql.yml/badge.svg)](https://github.com/damingishere-coder/AI-JobPilot/actions/workflows/codeql.yml) [![License](https://img.shields.io/badge/license-Non--Commercial-64748b)](LICENSE)

![v1.5 dashboard: application overview, shortcuts and setup checks with synthetic data](docs/images/screenshots/v1.5-dashboard.jpg)

*Actual v1.5 interface · Synthetic data · Screenshot preview disconnected from recruitment platforms*

</div>

## From job discovery to your decision

AI JobPilot is a local workspace for individual job seekers. It brings together information scattered across browser tabs, resume files and application records.

| Your task | How the workspace helps |
| --- | --- |
| Find relevant jobs | Collect BOSS Zhipin and Zhilian jobs through Chrome Bridge, with scan progress and failure information |
| Assess the fit | Review scores, supporting evidence and risks against your resume and goals; a score does not express your willingness to apply |
| Prepare a conversation | Read and edit a job-specific greeting, then review its final text before confirming |
| Track applications | Keep profile-scoped records, distinguish pending, delivered, failed and uncertain outcomes, and skip jobs you are not interested in |

**Save your profile → Set search criteria → Collect and analyze → Review jobs and greetings → Confirm → Check results**

## Inside the workspace

### Visible matching evidence

The Zhilian analysis page shows the current saved resume, search keywords and confirmation threshold. Editing your profile does not automatically recalculate historical scores, and the interface makes that distinction explicit.

![Zhilian matching evidence and current profile, using synthetic data](docs/images/screenshots/v1.5-analysis-basis.jpg)

### Review the evidence and greeting before applying

Pending-confirmation cards bring together requirements, matching reasons, risks and the final greeting. Edit the draft, open the original job, or mark it as not interested.

![Pending jobs with matching reasons and greeting drafts; all companies and jobs are fictional](docs/images/screenshots/v1.5-job-review.jpg)

<details>
<summary><strong>See more: a separate set of documents for each profile</strong></summary>

Maintain your resume, job preferences and analysis configuration together. File parsing produces a preview before you confirm and save it.

![v1.5 resume configuration with a fictional content-operations profile](docs/images/screenshots/v1.5-resume.jpg)

</details>

These are unmodified browser captures of the v1.5 frontend. All companies, jobs, resumes and statistics are synthetic, not evidence of real applications. See [screenshot provenance](docs/images/screenshots/README.md).

## Quick start

**Recommended: Windows 10 / 11, Java 21, Node.js 24 LTS, pnpm 10.20.0, Chrome and Git.**

### 1. Download and start

Run in PowerShell:

```powershell
git clone --branch v1.5.0 --depth 1 https://github.com/damingishere-coder/AI-JobPilot.git
cd AI-JobPilot
cd front
pnpm install --frozen-lockfile
cd ..
.\start_windows.bat
```

The first launch downloads dependencies. Open **http://127.0.0.1:6866 in Chrome** after startup. For prerequisites and troubleshooting, follow the [Windows guide (Chinese)](WINDOWS_SETUP.md). If an instance is already running, use that instance to avoid port conflicts.

### 2. Connect Chrome Bridge

Open `chrome://extensions/`, enable **Developer mode**, select **Load unpacked**, and choose the repository's `chrome-extension` folder. Application v1.5 ships with **Chrome Bridge 1.8.0**. After updating extension files, reload the extension and refresh both the workspace and platform tabs.

### 3. Run your first analysis

Configure your model connection in Environment settings. Create a profile and save your resume and preferences in AI configuration. Log in to your chosen recruitment platform, set search criteria, and collect jobs. Review the pending-confirmation queue before deciding whether to apply. Follow the [task flow (Chinese)](TASK_FLOW.md) for details.

> Local storage does not mean fully offline: AI analysis sends relevant resume and job content to your configured model service. The model service, recruitment platform login and local workspace each need their own configuration.

## Choose a download

The [v1.5.0 release](https://github.com/damingishere-coder/AI-JobPilot/releases/tag/v1.5.0) includes:

| Asset | Purpose |
| --- | --- |
| `AI-JobPilot-v1.5.0-source.zip` | Source and startup scripts; install prerequisites using the Windows guide |
| `AI-JobPilot-v1.5.0.jar` | Java application with bundled frontend; requires Java 21 and local configuration |
| `AI-JobPilot-v1.5.0-chrome-extension.zip` | Unpack and load in Chrome; internal extension version is 1.8.0 |
| `AI-JobPilot-v1.5.0-frontend-static.zip` | Static frontend for integration with an existing backend |
| `SHA256SUMS.txt` | Download integrity checksums |

A standalone Windows `.exe` installer is not available. See [download and verification instructions](docs/releases.md) and [v1.5 release notes](docs/releases/v1.5.0.md).

## Platform support and limitations

| Platform | Status | Execution path |
| --- | --- | --- |
| BOSS Zhipin | Primary maintenance | Chrome Bridge collection, AI analysis and user-confirmed applications |
| Zhilian | Primary maintenance | Chrome Bridge collection, matching evidence, confirmation queue and result reconciliation |
| Liepin / 51job | Experimental compatibility | Legacy adapters remain; sidebar entries are disabled and ordinary starts default to read-only collection; full real-platform acceptance is incomplete |

- Website changes, expired sessions and verification prompts can interrupt a scan. Resolve them in Chrome before continuing.
- Review uncertain outcomes before retrying to avoid duplicate applications. Scores and greetings require human judgment.
- Windows on a personal computer is the primary environment. Do not directly expose the workspace to the public internet. Docker is an advanced development option; see the [Docker guide](README_DOCKER.md).
- [Demo fixtures](demo/README.md) are not wired into a one-click demo. Experimental integrations such as OpenClaw are not required for the main workflow.

## Documentation and contributions

Most detailed guides are currently in Chinese.

| Topic | Entry point |
| --- | --- |
| Installation and first use | [Windows](WINDOWS_SETUP.md) · [Task flow](TASK_FLOW.md) |
| Documentation and versions | [Documentation hub](docs/README.md) · [Changelog](CHANGELOG.md) · [Roadmap](ROADMAP.md) |
| Development and testing | [Development guide](docs/development/setup.md) · [Architecture](ARCHITECTURE.md) |
| Contributing | [Contribution guide](CONTRIBUTING.md) · [Issues](https://github.com/damingishere-coder/AI-JobPilot/issues) |
| Data and security | [Security policy](SECURITY.md) |

Reproducible reports, sanitized test fixtures and documentation improvements are welcome. Never publish real resumes, conversations, cookies, API keys or databases in issues, screenshots or commits.

## License

Licensed under the [TOUDI NIUMA Non-Commercial License 1.0](LICENSE). Non-commercial use is permitted with attribution and license notices retained. Commercial use, paid hosting and commercial integration require separate authorization.

This project is intended for personal job-search assistance, research and learning. Follow recruitment platform rules and take responsibility for your account actions, data handling and applications.
