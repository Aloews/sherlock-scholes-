# Autonomous local-model coding agent

## Usage

The `Local autonomous coding agent` workflow runs an open-weight coding model locally on an ephemeral GitHub-hosted runner. It does not call a paid inference API and requires no model API key.

Open a GitHub issue, then post a comment as the repository owner beginning with `/ai `, for example:

```text
/ai Fix the team-selection filtering bug and add a regression test.
```

The workflow downloads Ollama and `qwen2.5-coder:3b`, selects a bounded set of repository files, asks the model for a unified diff, validates the paths and patch, and runs fixed project checks. If the checks pass, it opens a pull request. It never merges or deploys automatically.

## Limits and safety

- The model runs only during a workflow run; it is not a continuously running server.
- The model is smaller than hosted frontier models and may fail on complex tasks. Failures must remain visible.
- No Railway service, paid inference API, model key, or Vercel deployment is required.
- The model cannot call shell tools. It proposes a patch; the workflow runs only predefined validation commands.
- Patches are restricted to source, tests, scripts, docs, scraper, ML, and Supabase function/migration directories. Workflow files, deployment settings, package manifests, lockfiles, and secrets are outside the allowed paths.
- The workflow only accepts `/ai ` comments posted by the repository owner. Never put secrets in issue text.
- GitHub-hosted runners and Actions usage are subject to GitHub's applicable usage limits.
- The resulting pull request requires human review; the agent does not merge its own changes.
