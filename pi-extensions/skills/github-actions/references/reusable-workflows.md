# Reusable Workflows and Workflow Dispatch

## `workflow_call` — called by other workflows

A reusable workflow is triggered via `workflow_call`. It can coexist with `workflow_dispatch` in the same workflow — define inputs under each trigger separately. `schedule` is the only trigger that is mutually exclusive with `workflow_call`. Other triggers (`push`, `pull_request`, `issues`, etc.) can be combined freely.

### Defining inputs, secrets, and outputs

```yaml
on:
  workflow_call:
    inputs:
      environment:
        description: "Deployment environment"
        required: true
        type: string
      dry-run:
        description: "Run without deploying"
        required: false
        type: boolean
        default: false
    secrets:
      deploy-token:
        description: "Token for deployment"
        required: true
    outputs:
      deployment-url:
        description: "URL of the deployed app"
        value: ${{ jobs.deploy.outputs.url }}

jobs:
  deploy:
    runs-on: ubuntu-latest
    outputs:
      url: ${{ steps.deploy-step.outputs.url }}
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false
      - name: Deploy
        id: deploy-step
        run: |
          echo "url=https://${{ inputs.environment }}.example.com" >> "$GITHUB_OUTPUT"
        env:
          DEPLOY_TOKEN: ${{ secrets.deploy-token }}
```

Key points:
- `inputs` have a `type` field: `string`, `boolean`, `number`, or `choice`. Models often omit `type` or use invalid types.
- `secrets` are accessed as `${{ secrets.<name> }}` inside the reusable workflow, same as normal secrets.
- Workflow-level `outputs` use `value:` with an expression, referencing job outputs (`${{ jobs.<id>.outputs.<key> }}`).
- Job outputs come from step outputs via `$GITHUB_OUTPUT`.

### Calling a reusable workflow

```yaml
jobs:
  deploy-prod:
    uses: ./.github/workflows/deploy.yml
    with:
      environment: production
      dry-run: false
    secrets:
      deploy-token: ${{ secrets.PROD_DEPLOY_TOKEN }}
```

- `uses:` goes at the **job level**, not under `steps`. A job that calls a reusable workflow cannot have its own `steps`.
- To pass all caller secrets through: `secrets: inherit` (no mapping needed).

```yaml
jobs:
  deploy-prod:
    uses: ./.github/workflows/deploy.yml
    with:
      environment: production
    secrets: inherit
```

- To use outputs from a called workflow:

```yaml
jobs:
  deploy:
    uses: ./.github/workflows/deploy.yml
    with:
      environment: production
    secrets: inherit

  verify:
    needs: deploy
    runs-on: ubuntu-latest
    steps:
      - run: curl "${{ needs.deploy.outputs.deployment-url }}"
```

### Permissions in reusable workflows

By default, the reusable workflow gets its own `GITHUB_TOKEN` with the permissions defined in **its own** `permissions:` block, not the caller's. If the caller has restrictive permissions but the called workflow needs more access, the called workflow must declare its own `permissions:`. The caller cannot grant permissions the called workflow doesn't declare.

## `workflow_dispatch` — manual trigger

```yaml
on:
  workflow_dispatch:
    inputs:
      environment:
        description: "Environment to deploy"
        required: true
        type: choice
        options:
          - staging
          - production
      version:
        description: "Version to deploy"
        required: true
        type: string
```

Key differences from `workflow_call` inputs:
- `type: choice` requires an `options` array (only available on `workflow_dispatch`, not `workflow_call`).
- `type: environment` is available and provides a dropdown of configured environments.
- `workflow_dispatch` inputs are always strings in expressions — use `${{ inputs.dry-run == 'true' }}` for booleans, not `${{ inputs.dry-run }}` directly (it's the string `"true"`, not a boolean).

### Running a workflow_dispatch from another workflow

```yaml
jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/github-script@v7
        with:
          script: |
            await github.rest.actions.createWorkflowDispatch({
              owner: context.repo.owner,
              repo: context.repo.repo,
              workflow_id: 'deploy.yml',
              ref: 'main',
              inputs: {
                environment: 'production',
                version: '1.2.3'
              }
            })
```

This calls a workflow in the **same repo**. For cross-repo, use the same call with the target repo's `owner`/`repo`.
