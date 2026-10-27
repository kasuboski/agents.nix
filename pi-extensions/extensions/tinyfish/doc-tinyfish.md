# Agent API
Source: https://docs.tinyfish.ai/agent-api/index

Use natural-language goals to automate workflows on real websites

The TinyFish Agent API lets you describe a task in natural language and have TinyFish execute it on a real website. Use it when you want goal-based automation rather than low-level browser scripting.

<Note>
  The Agent API is the right choice when TinyFish should decide the browser actions. If you need direct browser control instead, use the [Browser API](/browser-api).
</Note>

## Canonical Endpoints

| Endpoint     | Pattern           | Best for                               |
| ------------ | ----------------- | -------------------------------------- |
| `/run`       | Synchronous       | Quick tasks and simple integrations    |
| `/run-async` | Start then poll   | Long tasks and batch processing        |
| `/run-sse`   | Live event stream | Real-time progress in user-facing apps |

```bash theme={null}
POST https://agent.tinyfish.ai/v1/automation/run-sse
```

## Before You Start

<Steps>
  <Step title="Get your API key">
    Create an API key at [agent.tinyfish.ai/api-keys](https://agent.tinyfish.ai/api-keys).
  </Step>

  <Step title="Store it in your environment">
    ```bash theme={null}
    export TINYFISH_API_KEY="your_api_key_here"
    ```
  </Step>
</Steps>

All requests require the `X-API-Key` header. See [Authentication](/authentication) for the full setup and troubleshooting guide.

## Your First Request

<CodeGroup>
  ```python Python theme={null}
  from tinyfish import TinyFish

  client = TinyFish()

  with client.agent.stream(
      url="https://scrapeme.live/shop",
      goal="Extract the first 2 product names and prices. Return JSON.",
  ) as stream:
      for event in stream:
          print(event)
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish } from "@tiny-fish/sdk";

  const client = new TinyFish();

  const stream = await client.agent.stream({
    url: "https://scrapeme.live/shop",
    goal: "Extract the first 2 product names and prices. Return JSON.",
  });

  for await (const event of stream) {
    console.log(event);
  }
  ```

  ```bash cURL theme={null}
  curl -N -X POST https://agent.tinyfish.ai/v1/automation/run-sse \
    -H "X-API-Key: $TINYFISH_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "url": "https://scrapeme.live/shop",
      "goal": "Extract the first 2 product names and prices. Return JSON."
    }'
  ```
</CodeGroup>

## What Success Looks Like

```json theme={null}
{"type":"STARTED","run_id":"abc123"}
{"type":"PROGRESS","run_id":"abc123","purpose":"Visit the page to extract product information"}
{"type":"PROGRESS","run_id":"abc123","purpose":"Extract the first two products and prices"}
{"type":"COMPLETE","run_id":"abc123","status":"COMPLETED","result":{"products":[{"name":"Bulbasaur","price":"$63.00"},{"name":"Ivysaur","price":"$87.00"}]}}
```

If you want a blocking request that returns only the final result, use `/run`. If you want to start work and poll later, use `/run-async`.

## When to Use Agent vs the Other APIs

* Use **Agent** when TinyFish should decide the browser actions from your goal.
* Use **Browser** when you want to drive Playwright or CDP yourself.
* Use **Fetch** when you already know the URLs and only need extracted page content.
* Use **Search** when you need ranked search results rather than page automation.

## Writing Good Goals

A goal is the plain-English instruction you pass in the `goal` field. TinyFish uses it to decide what to click, type, extract, and return.

Good goals are:

* specific about the output you want
* explicit about the page or flow to follow
* clear about response format when you need structured JSON

## Read Next

<CardGroup>
  <Card title="Agent reference" icon="code" href="/agent-api/reference">
    Full request schema, run lifecycle, browser profiles, and errors
  </Card>

  <Card title="Endpoint selection" icon="plug" href="/key-concepts/endpoints">
    Choose between `/run`, `/run-async`, and `/run-sse`
  </Card>

  <Card title="Runs" icon="play" href="/key-concepts/runs">
    Understand status, polling, and completion
  </Card>

  <Card title="Goal prompting guide" icon="bullseye" href="/prompting-guide">
    Write more reliable automation instructions
  </Card>

  <Card title="Authentication" icon="key" href="/authentication">
    API key setup and troubleshooting
  </Card>
</CardGroup>


# Agent API Reference
Source: https://docs.tinyfish.ai/agent-api/reference

Technical reference for goal-based TinyFish automation

## Endpoints

| Endpoint                                            | Method | Returns              | Cancel support |
| --------------------------------------------------- | ------ | -------------------- | -------------- |
| `https://agent.tinyfish.ai/v1/automation/run`       | `POST` | Final run result     | No             |
| `https://agent.tinyfish.ai/v1/automation/run-async` | `POST` | `run_id` immediately | Yes            |
| `https://agent.tinyfish.ai/v1/automation/run-sse`   | `POST` | SSE event stream     | Yes            |

All requests require the `X-API-Key` header. See [Authentication](/authentication).

## Common Request Body

All three automation endpoints accept the same JSON body.

```json theme={null}
{
  "url": "https://example.com",
  "goal": "Find the pricing page and extract all plan details",
  "browser_profile": "lite",
  "proxy_config": {
    "enabled": true,
    "type": "tetra",
    "country_code": "US"
  },
  "use_vault": true,
  "credential_item_ids": ["cred:a1b2c3d4:Work:item-xyz"]
}
```

| Field                       | Type                                     | Required | Notes                                                                                                                                              |
| --------------------------- | ---------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`                       | `string`                                 | Yes      | Target website URL to automate                                                                                                                     |
| `goal`                      | `string`                                 | Yes      | Natural-language instruction for the automation                                                                                                    |
| `browser_profile`           | `lite \| stealth`                        | No       | Defaults to `lite`                                                                                                                                 |
| `proxy_config.enabled`      | `boolean`                                | No       | Enables proxying for the run                                                                                                                       |
| `proxy_config.type`         | `tetra \| custom`                        | No       | `tetra` uses TinyFish proxy infrastructure; `custom` requires your own proxy URL                                                                   |
| `proxy_config.country_code` | `US \| GB \| CA \| DE \| FR \| JP \| AU` | No       | Used with `type: "tetra"`                                                                                                                          |
| `proxy_config.url`          | `string`                                 | No       | Required when `type: "custom"`                                                                                                                     |
| `proxy_config.username`     | `string`                                 | No       | Custom proxy username                                                                                                                              |
| `proxy_config.password`     | `string`                                 | No       | Custom proxy password                                                                                                                              |
| `use_vault`                 | `boolean`                                | No       | Enable [vault credentials](/key-concepts/credentials) for this run. When `true`, TinyFish can log into sites using your connected password manager |
| `credential_item_ids`       | `string[]`                               | No       | Scope the run to specific credential URIs from `GET /v1/vault/items`. Requires `use_vault: true`. If omitted, all synced items are available       |

See [Browser Profiles](/key-concepts/browser-profiles), [Proxies](/key-concepts/proxies), and [Vault Credentials](/key-concepts/credentials) for operational guidance.

## `POST /v1/automation/run`

Use this endpoint when you want the final result in one blocking response.

```json theme={null}
{
  "run_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "COMPLETED",
  "started_at": "2024-01-01T00:00:00Z",
  "finished_at": "2024-01-01T00:00:30Z",
  "num_of_steps": 5,
  "result": {
    "product": "iPhone 15",
    "price": "$799"
  },
  "error": null
}
```

| Field          | Type                  | Notes                            |
| -------------- | --------------------- | -------------------------------- |
| `run_id`       | `string \| null`      | Unique identifier for the run    |
| `status`       | `COMPLETED \| FAILED` | Final run state                  |
| `started_at`   | `string \| null`      | ISO 8601 timestamp               |
| `finished_at`  | `string \| null`      | ISO 8601 timestamp               |
| `num_of_steps` | `number \| null`      | Number of steps taken            |
| `result`       | `object \| null`      | Extracted JSON result            |
| `error`        | `object \| null`      | Present only when the run failed |

Runs created via `/run` cannot be cancelled.

## `POST /v1/automation/run-async`

Use this endpoint when you want a `run_id` immediately and will fetch the full run later.

```json theme={null}
{
  "run_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "error": null
}
```

| Field    | Type             | Notes                                 |
| -------- | ---------------- | ------------------------------------- |
| `run_id` | `string \| null` | Created run ID                        |
| `error`  | `object \| null` | Present only when run creation failed |

Fetch the full run state later with `GET /v1/runs/{id}`.

## `POST /v1/automation/run-sse`

Use this endpoint when you want a streaming event feed while the automation runs.

Possible SSE event types:

| Event type      | Fields                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------ |
| `STARTED`       | `type`, `run_id`, `timestamp`                                                              |
| `STREAMING_URL` | `type`, `run_id`, `streaming_url`, `timestamp`                                             |
| `PROGRESS`      | `type`, `run_id`, `purpose`, `timestamp`                                                   |
| `HEARTBEAT`     | `type`, `timestamp`                                                                        |
| `COMPLETE`      | `type`, `run_id`, `status`, `result?`, `error?`, `help_url?`, `help_message?`, `timestamp` |

Example stream:

```text theme={null}
data: {"type":"STARTED","run_id":"run_123","timestamp":"2025-01-01T00:00:00Z"}

data: {"type":"STREAMING_URL","run_id":"run_123","streaming_url":"https://...","timestamp":"..."}

data: {"type":"PROGRESS","run_id":"run_123","purpose":"Clicking submit button","timestamp":"..."}

data: {"type":"COMPLETE","run_id":"run_123","status":"COMPLETED","result":{...},"timestamp":"..."}
```

<Note>
  **Reconnection:** SSE streams do not support `Last-Event-ID` reconnection. If your client disconnects mid-stream, recover by polling `GET /v1/runs/{run_id}` until the run reaches a terminal status (`COMPLETED`, `FAILED`, or `CANCELLED`).
</Note>

### Raw HTTP (no SDK)

Parse SSE events directly without the TinyFish SDK:

```python theme={null}
import httpx
import json

url = "https://agent.tinyfish.ai/v1/automation/run-sse"
headers = {"x-api-key": "sk-tinyfish-..."}
payload = {"url": "https://example.com", "goal": "Extract the page title"}

with httpx.stream("POST", url, headers=headers, json=payload, timeout=120) as response:
    for line in response.iter_lines():
        if line.startswith("data: "):
            event = json.loads(line[6:])
            print(f"Event: {event['type']}")
            if event["type"] == "COMPLETE":
                print(f"Result: {event.get('result', {})}")
```

## `GET /v1/runs/{id}`

Use this endpoint to retrieve the current or final state of an async or streaming run.

| Field            | Type                                                     | Notes                                     |
| ---------------- | -------------------------------------------------------- | ----------------------------------------- |
| `run_id`         | `string`                                                 | Unique run identifier                     |
| `status`         | `PENDING \| RUNNING \| COMPLETED \| FAILED \| CANCELLED` | Current run state                         |
| `goal`           | `string`                                                 | Original goal text                        |
| `created_at`     | `string`                                                 | ISO 8601 timestamp                        |
| `started_at`     | `string \| null`                                         | ISO 8601 timestamp                        |
| `finished_at`    | `string \| null`                                         | ISO 8601 timestamp                        |
| `num_of_steps`   | `integer \| null`                                        | Number of steps taken                     |
| `result`         | `object \| null`                                         | Extracted JSON result                     |
| `error`          | `object \| null`                                         | Error details if failed                   |
| `streaming_url`  | `string \| null`                                         | Live browser stream URL while running     |
| `browser_config` | `object \| null`                                         | Proxy settings used for the run           |
| `video_url`      | `string \| null`                                         | Presigned run recording URL, if available |
| `steps`          | `array`                                                  | Recorded step events for the run          |

`error` may include:

| Field          | Type                                                            | Notes                              |
| -------------- | --------------------------------------------------------------- | ---------------------------------- |
| `code`         | `string`                                                        | Machine-readable error code        |
| `message`      | `string`                                                        | Human-readable failure description |
| `category`     | `SYSTEM_FAILURE \| AGENT_FAILURE \| BILLING_FAILURE \| UNKNOWN` | Error class                        |
| `retry_after`  | `number \| null`                                                | Suggested retry delay in seconds   |
| `help_url`     | `string`                                                        | Troubleshooting link               |
| `help_message` | `string`                                                        | Human-readable guidance            |

## `POST /v1/runs/{id}/cancel`

Only runs created via `/run-async` or `/run-sse` can be cancelled.

```json theme={null}
{
  "run_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "CANCELLED",
  "cancelled_at": "2026-01-14T10:30:55Z",
  "message": null
}
```

| Field          | Type                               | Notes                                  |
| -------------- | ---------------------------------- | -------------------------------------- |
| `run_id`       | `string`                           | Run identifier                         |
| `status`       | `CANCELLED \| COMPLETED \| FAILED` | Actual status after the cancel attempt |
| `cancelled_at` | `string \| null`                   | ISO 8601 timestamp                     |
| `message`      | `string \| null`                   | Idempotency or terminal-state message  |

## Error Codes

Common HTTP-level errors across automation endpoints:

| Status | Meaning                                         |
| ------ | ----------------------------------------------- |
| `400`  | Invalid request body or missing required fields |
| `401`  | Missing or invalid API key                      |
| `429`  | Rate limit exceeded                             |
| `500`  | Internal server error                           |

The `COMPLETE` SSE event or `GET /v1/runs/{id}` may also include run-level failures such as `TASK_FAILED`, `SITE_BLOCKED`, `MAX_STEPS_EXCEEDED`, `TIMEOUT`, or `INSUFFICIENT_CREDITS`.

## Related

<CardGroup>
  <Card title="Agent overview" icon="sparkles" href="/agent-api">
    First request, endpoint selection, and goal-writing basics
  </Card>

  <Card title="Runs" icon="play" href="/key-concepts/runs">
    Statuses, polling, and lifecycle behavior
  </Card>

  <Card title="Goal prompting guide" icon="bullseye" href="/prompting-guide">
    Improve automation reliability
  </Card>

  <Card title="Authentication" icon="key" href="/authentication">
    API key setup and troubleshooting
  </Card>

  <Card title="Vault Credentials" icon="lock" href="/key-concepts/credentials">
    Use password manager credentials in runs
  </Card>
</CardGroup>


# Anti-Bot Guide
Source: https://docs.tinyfish.ai/anti-bot-guide

Diagnose and bypass bot detection when automating protected websites

You've sent a run, it came back `COMPLETED`, but the result is empty or wrong. Or maybe it outright `FAILED`. Before you start rewriting your goal, check whether the site is blocking you — bot detection is the most common cause of silent failures, and the fix is usually two lines of code.

This guide walks through the full process: confirm the problem, apply the right configuration, and tune your goal to behave more like a human.

<Note>
  Examples use the Python SDK. The same parameters work across all SDKs and the REST API — see [API Reference](/api-reference) for TypeScript and cURL equivalents.
</Note>

## Installation

```bash theme={null}
pip install tinyfish
```

Set your API key as an environment variable so you don't have to pass it explicitly:

```bash theme={null}
export TINYFISH_API_KEY="your-api-key"
```

***

## Step 1: Confirm Anti-Bot Is the Problem

Don't assume. Sites can fail for lots of reasons — slow JavaScript, unexpected layout changes, ambiguous goals. Anti-bot has specific fingerprints. Look for them first.

### Get the streaming URL and watch the browser

Every run produces a `streaming_url` — a live browser preview you can open while the run is happening. This is the fastest way to see exactly what the agent encountered.

Use `agent.stream()` to capture it as soon as it's available:

```python theme={null}
from tinyfish import TinyFish, CompleteEvent

client = TinyFish()

with client.agent.stream(
    goal="Extract the product name and price",
    url="https://example.com/products",
    on_streaming_url=lambda e: print(f"Watch live: {e.streaming_url}"),
    on_progress=lambda e: print(f"  > {e.purpose}"),
) as stream:
    for event in stream:
        if isinstance(event, CompleteEvent):
            print("Status:", event.status)
            print("Result:", event.result_json)
```

The `on_progress` callback shows each step the agent took — if it got stuck on a challenge page, you'll see it stop there.

If you already started a run with `agent.queue()`, retrieve the streaming URL from the run object:

```python theme={null}
run = client.runs.get("run_abc123")
print(run.streaming_url)   # open this in your browser
```

### What to look for in the browser preview

Open `streaming_url` in your browser. What you see tells you what happened:

| What you see                                   | Likely cause                                  |
| ---------------------------------------------- | --------------------------------------------- |
| Cloudflare challenge / "Checking your browser" | Cloudflare bot detection                      |
| DataDome popup or redirect                     | DataDome protection                           |
| Blank page or infinite spinner                 | IP-based block or JS fingerprinting           |
| CAPTCHA (reCAPTCHA, hCaptcha)                  | CAPTCHA gate — cannot be solved automatically |
| "Access Denied" or 403 page                    | IP or User-Agent block                        |
| Login page when you expected content           | Session-based bot detection                   |

### Check the result — `COMPLETED` doesn't mean it worked

The `result` field is a better indicator of agentic success.

```python theme={null}
from tinyfish import TinyFish, RunStatus, CompleteEvent

client = TinyFish()

with client.agent.stream(
    goal="Extract the product name and price",
    url="https://example.com/products",
) as stream:
    for event in stream:
        if isinstance(event, CompleteEvent):
            if event.status == RunStatus.COMPLETED and event.result_json:
                # Anti-bot shows up here as null fields or explicit failure flags
                result = event.result_json
                if result.get("status") == "failure" or not any(result.values()):
                    print("Blocked — result is empty despite COMPLETED status")
            elif event.status == RunStatus.FAILED:
                print("Run failed:", event.error.message if event.error else "unknown")
```

**Anti-bot signatures in the result:**

* Fields are all `null` or empty arrays AND the streaming view shows the target content was never loaded
* `result.reason` mentions "access denied", "blocked", or "could not find"

If the streaming view shows a challenge page and the result is empty or a failure — you've confirmed anti-bot. Move to Step 2.

***

## Step 2: Enable Stealth Mode and Proxy

Apply both together. Stealth changes the browser fingerprint; the proxy changes the IP. Sites that use anti-bot services correlate both signals — changing only one often isn't enough.

### Switch to stealth browser

```python theme={null}
from tinyfish import TinyFish, BrowserProfile

client = TinyFish()

response = client.agent.run(
    goal="Extract the product name and price",
    url="https://protected-site.com/products",
    browser_profile=BrowserProfile.STEALTH,   # was BrowserProfile.LITE or omitted
)
```

`BrowserProfile.STEALTH` is a modified browser with anti-detection techniques. The default (`BrowserProfile.LITE`) is faster but doesn't include these measures.

### Add a proxy

```python theme={null}
from tinyfish import TinyFish, BrowserProfile, ProxyConfig, ProxyCountryCode

client = TinyFish()

response = client.agent.run(
    goal="Extract the product name and price",
    url="https://protected-site.com/products",
    browser_profile=BrowserProfile.STEALTH,
    proxy_config=ProxyConfig(
        enabled=True,
        country_code=ProxyCountryCode.US,   # match the site's expected audience
    ),
)
```

**Choosing a country:** Pick the country where the site's primary users are. Available values:

| Enum                  | Country        |
| --------------------- | -------------- |
| `ProxyCountryCode.US` | United States  |
| `ProxyCountryCode.GB` | United Kingdom |
| `ProxyCountryCode.CA` | Canada         |
| `ProxyCountryCode.DE` | Germany        |
| `ProxyCountryCode.FR` | France         |
| `ProxyCountryCode.JP` | Japan          |
| `ProxyCountryCode.AU` | Australia      |

### Verify what proxy was actually used

After a run, `browser_config` on the run object confirms what was applied:

```python theme={null}
run = client.runs.get("run_abc123")
print(run.browser_config.proxy_enabled)        # True/False
print(run.browser_config.proxy_country_code)   # "US" or None
```

### Full example with both applied

```python theme={null}
from tinyfish import TinyFish, BrowserProfile, ProxyConfig, ProxyCountryCode, CompleteEvent, RunStatus

client = TinyFish()

with client.agent.stream(
    goal="Extract the product name and price",
    url="https://protected-site.com/products",
    browser_profile=BrowserProfile.STEALTH,
    proxy_config=ProxyConfig(enabled=True, country_code=ProxyCountryCode.US),
    on_streaming_url=lambda e: print(f"Watch: {e.streaming_url}"),
    on_progress=lambda e: print(f"  > {e.purpose}"),
) as stream:
    for event in stream:
        if isinstance(event, CompleteEvent):
            if event.status == RunStatus.COMPLETED:
                print("Result:", event.result_json)
            else:
                print("Failed:", event.error.message if event.error else "unknown")
```

Watch the streaming view again after this change. If the actual page loads instead of a challenge screen — you're through. Move to Step 3 to make the run more reliable at scale.

<Warning>
  TinyFish cannot solve CAPTCHAs (reCAPTCHA, hCaptcha, etc.). The configurations above — stealth mode, proxies, and human-like goal patterns — reduce the likelihood of CAPTCHAs being triggered, but if a site serves one, it's a hard limit for now. We're actively working on expanding our anti-detection capabilities.
</Warning>

***

## Step 3: Guide the Agent to Behave More Like a Human

Stealth and proxy get you past the door. But some sites layer behavioral analysis on top of fingerprinting — they watch for robotic patterns like instant form submissions, missing cookie consent dismissals, or zero mouse dwell time. Your goal controls a lot of this behavior.

### Handle cookie and consent banners

Bot detection systems often look at whether a user interacted with a consent banner before the main content. Always dismiss it explicitly:

```python theme={null}
goal = """
Close any cookie consent or GDPR banner that appears before doing anything else.
Then extract the product name, current price, and availability status.
Return as JSON: { "name": string, "price": number, "available": boolean }
"""
```

### Add deliberate pauses at suspicious checkpoints

Sites with aggressive behavioral detection (checkout pages, login flows) flag runs that move too fast:

```python theme={null}
goal = """
1. Wait for the page to fully load before interacting with anything.
2. Close any cookie banner.
3. Wait for the banner to disappear before proceeding.
4. Scroll down to view the pricing section.
5. Wait for the pricing section to fully render, then extract all plan names and monthly prices.

Return as JSON array: [{ "plan": string, "price_monthly": number }]
"""
```

### Describe elements visually, not by selector

Automation-aware selectors are sometimes deliberately changed to trip scrapers. Visual descriptions are more resilient:

```python theme={null}
# Fragile — may be intentionally changed by the site
goal = "Click the button with id='add-to-cart-btn'"

# Resilient — describes what a human would see
goal = "Click the blue 'Add to Cart' button directly below the product price"
```

### Use numbered steps for multi-step flows

For login flows or multi-page workflows, numbered steps give the agent explicit decision points rather than leaving it to guess:

```python theme={null}
goal = """
1. Wait for the page to fully load (spinner should disappear).
2. If a cookie consent banner is visible, click 'Accept' or 'Accept All'.
3. Locate the search bar at the top of the page and type "running shoes".
4. Wait for autocomplete suggestions to appear, then press Enter.
5. Wait for results to load.
6. Extract the first 10 results: product name, price, and product URL.

Stop after 10 results. Do not paginate.
Return as JSON array.
"""
```

### Add explicit fallback instructions

Protected sites sometimes show intermediate pages (challenge passed, now redirecting). Tell the agent how to handle them:

```python theme={null}
goal = """
Extract the product price from this page.

If a loading screen or redirect page appears, wait for it to complete before extracting.
If an 'Access Denied' page appears, return { "error": "access_denied" }.
If the price shows 'Contact Us', return { "price": null, "contact_required": true }.

Return: { "price": number or null, "currency": string }
"""
```

***

## Putting It All Together

A complete hardened run for a protected site:

```python theme={null}
from tinyfish import (
    TinyFish,
    BrowserProfile,
    ProxyConfig,
    ProxyCountryCode,
    CompleteEvent,
    RunStatus,
)

client = TinyFish()

with client.agent.stream(
    url="https://protected-site.com/pricing",
    browser_profile=BrowserProfile.STEALTH,
    proxy_config=ProxyConfig(enabled=True, country_code=ProxyCountryCode.US),
    goal="""
        1. Wait for the page to fully load.
        2. Close any cookie consent or GDPR banner that appears.
        3. Wait 1 second before proceeding.
        4. Locate the pricing section — it typically shows plan names in a grid or table.
        5. For each plan, extract: plan name, monthly price, and annual price if shown.

        If a Cloudflare or security check page appears, wait for it to complete automatically.
        If you see an 'Access Denied' or CAPTCHA page, return { "error": "blocked" }.
        Do not click any purchase or checkout buttons.

        Return as JSON array:
        [{ "plan": "Pro", "monthly_price": 49, "annual_price": 39 }]
    """,
    on_streaming_url=lambda e: print(f"Watch run: {e.streaming_url}"),
    on_progress=lambda e: print(f"  > {e.purpose}"),
) as stream:
    for event in stream:
        if isinstance(event, CompleteEvent):
            if event.status == RunStatus.COMPLETED:
                print("Result:", event.result_json)
            else:
                print("Failed:", event.error.message if event.error else "unknown")
```

***

## Decision Tree

```
Run returned empty or wrong result?
│
├── Open streaming_url (from on_streaming_url callback or runs.get())
│   ├── Challenge / "Checking your browser" page → Anti-bot confirmed
│   ├── Access Denied / 403 → Anti-bot confirmed
│   ├── Blank page → Likely anti-bot (fingerprint-based)
│   └── Page loaded but result wrong → Goal issue, not anti-bot
│
└── Anti-bot confirmed?
    ├── Add browser_profile=BrowserProfile.STEALTH
    ├── Add proxy_config=ProxyConfig(enabled=True, country_code=ProxyCountryCode.US)
    ├── Re-run and watch stream again
    │   ├── Page loads → Add goal hardening (Step 3) for reliability at scale
    │   └── Still blocked → Site likely requires CAPTCHA (hard limit)
    └── Done
```

***

## Creative Solutions and Iteration

When a site is actively defended, the most effective approach is often to rethink the workflow rather than force the original one.

**Watch yourself do it first.** Before writing your goal, navigate to the target site yourself and think through what a human would actually do. Use that as your script. The streaming view is also useful here — watch a run or two to understand exactly what the agent encounters before committing to a final goal.

**Start at the front door.** Linking directly to a filtered search results page or a deep URL can look robotic. Starting at `target.com` and navigating to your destination — searching for a product, clicking through a category — often succeeds where a direct deep link fails.

**Go to the source.** If the formatted data you need lives behind anti-bot and paywalls, ask whether the underlying raw data is available elsewhere. Aggregator sites are often heavily protected; their primary sources may not be. Synthesizing from multiple simpler sources is frequently more reliable than fighting for one complex one.

**Check for a public API or feed first.** Some sites that actively block scraping also publish APIs, RSS feeds, or sitemaps. Five minutes checking saves a lot of iteration.

**Keep dwell time low.** The longer an agent stays on a site, the higher the likelihood of detection. Balancing human-like navigation with speed matters — break large workflows into focused, smaller tasks that can be handled by multiple agents running in parallel. You get both the human-like pacing and the throughput. Scale is one of TinyFish's superpowers.

**Time your runs intentionally.** Anti-bot systems are sensitive to traffic volume. Running during off-peak hours for your target site (for US-based sites, late morning to early afternoon PST often works well) can reduce the likelihood of triggering rate-based challenges. If you're testing a new workflow, start with a single run during a quiet period before scaling up.

**Vary your entry points at scale.** If you're running hundreds of batch jobs against the same site, uniform traffic patterns can themselves become a fingerprint — even across different IPs. Mixing up how runs navigate to their destination (some via homepage search, some via category pages, some direct) makes the aggregate traffic look more organic. Runs have a 10-minute timeout, so this also naturally encourages breaking complex workflows into smaller, parallelizable pieces. Design goals to complete their core task well within that limit.

**Manage concurrency intentionally.** TinyFish does not throttle runs by domain — if you enqueue a large batch against the same site, they will fire in parallel up to your account's concurrency limit. For sensitive sites, consider staggering your jobs in your own queuing logic rather than enqueuing everything at once.

***

## What's Coming

TinyFish continuously improves browser behavior and anti-detection performance across the web. If a site blocked you on a previous project, it's worth trying again — the same run that failed before may work without any changes on your end.

**Authenticated sessions:** [Connect your password manager](/vault-setup) and use `use_vault: true` to log into sites as part of a run. Beyond unlocking gated content, authenticated sessions naturally bypass many anti-bot measures — logged-in users are treated very differently by most protection systems. See [Vault Credentials](/key-concepts/credentials) for details.

***

## Need Help?

If you're stuck on a specific site, share the URL and your current configuration with us — we can often diagnose the issue quickly.

* **Email:** [support@tinyfish.io](mailto:support@tinyfish.io)
* **Discord:** [discord.gg/tinyfish](https://discord.gg/tinyfish)


# Run browser automation synchronously
Source: https://docs.tinyfish.ai/api-reference/automation/run-browser-automation-synchronously

https://agent.tinyfish.ai/v1/openapi/main post /v1/automation/run
Execute a browser automation task synchronously and wait for completion. Returns the final result once the automation finishes (success or failure). Use this endpoint when you need the complete result in a single response. Note: Runs created via this endpoint cannot be cancelled. If you need cancellation support, use `/v1/automation/run-async` or `/v1/automation/run-sse` instead.



# Run browser automation with SSE streaming
Source: https://docs.tinyfish.ai/api-reference/automation/run-browser-automation-with-sse-streaming

https://agent.tinyfish.ai/v1/openapi/main post /v1/automation/run-sse
Execute a browser automation task with Server-Sent Events (SSE) streaming. Returns a real-time event stream with automation progress, browser streaming URL, and final results.



# Start automation asynchronously
Source: https://docs.tinyfish.ai/api-reference/automation/start-automation-asynchronously

https://agent.tinyfish.ai/v1/openapi/main post /v1/automation/run-async
Creates and enqueues an automation run, returning the run_id immediately without waiting for completion. Use this for long-running automations where you want to poll for results separately.



# Start multiple automations asynchronously
Source: https://docs.tinyfish.ai/api-reference/automation/start-multiple-automations-asynchronously

https://agent.tinyfish.ai/v1/openapi/main post /v1/automation/run-batch
Creates and enqueues multiple automation runs in a single request, returning run_ids immediately without waiting for completion. Maximum 100 runs per request.

**Atomic creation:** Run creation is all-or-nothing. Either all runs are created successfully, or none are (returns error).

**Idempotency:** This endpoint does not currently support idempotency keys. Retrying a failed request may create duplicate runs.



# Create a remote browser session
Source: https://docs.tinyfish.ai/api-reference/create-a-remote-browser-session

https://agent.tinyfish.ai/v1/openapi/browser post /
Creates a remote tf-browser session and returns CDP connection details. Optionally accepts a target URL to select the best proxy for that domain. Connect to the browser via CDP WebSocket at `cdp_url`.

Use `timeout_seconds` to set a custom inactivity timeout (5–86400 seconds). If omitted, null, or greater than your plan maximum, the plan maximum is used (15 min on free tier, 60 min on paid).



# Fetch and extract content from URLs
Source: https://docs.tinyfish.ai/api-reference/fetch-and-extract-content-from-urls

https://agent.tinyfish.ai/v1/openapi/fetch post /
Renders web pages using a real browser (including JavaScript-heavy sites) and returns clean extracted content in your preferred format. Submit up to 10 URLs, get back structured content. Per-URL failures appear in `errors[]` and do not fail the entire request.

**Per-URL error codes** (in `errors[].error`):
- `target_http_error` — target server returned a non-2xx HTTP status; the raw status code is in `errors[].status`
- `target_unreachable` — connection refused, TLS failure, DNS failure, or other network error
- `timeout` — request timed out
- `proxy_error` — proxy tunnel failure
- `bot_blocked` — bot-challenge page detected (Cloudflare, etc.)
- `empty_content` — page loaded but no extractable text was found
- `invalid_url` — malformed URL or SSRF-blocked address
- `invalid_redirect_url` — redirect target rejected before fetch



# List browser session usage
Source: https://docs.tinyfish.ai/api-reference/list-browser-session-usage

https://agent.tinyfish.ai/v1/openapi/browser get /usage
List Tetra browser session usage for the authenticated user. Returns session telemetry including duration, data transfer, mode, and status.



# List fetch usage
Source: https://docs.tinyfish.ai/api-reference/list-fetch-usage

https://agent.tinyfish.ai/v1/openapi/fetch get /usage
List fetch usage records for the authenticated user. Returns paginated results with URL, format, status, and metadata for each fetch operation.



# List search usage
Source: https://docs.tinyfish.ai/api-reference/list-search-usage

https://agent.tinyfish.ai/v1/openapi/search get /usage
List search usage records for the authenticated user. Returns paginated results with query details, status, and result counts.



# Cancel multiple runs by IDs
Source: https://docs.tinyfish.ai/api-reference/runs/cancel-multiple-runs-by-ids

https://agent.tinyfish.ai/v1/openapi/main post /v1/runs/batch/cancel
Cancel multiple runs by their IDs in a single request. Returns per-run results including cancelled runs, already-terminal runs, and not-found IDs. Maximum 100 IDs per request. Idempotent: calling twice returns consistent results.



# Cancel run by ID
Source: https://docs.tinyfish.ai/api-reference/runs/cancel-run-by-id

https://agent.tinyfish.ai/v1/openapi/main post /v1/runs/{id}/cancel
Cancel a run by ID. Only runs created via `/v1/automation/run-async` or `/v1/automation/run-sse` can be cancelled. Runs created via the synchronous `/v1/automation/run` endpoint cannot be cancelled.



# Get multiple runs by IDs
Source: https://docs.tinyfish.ai/api-reference/runs/get-multiple-runs-by-ids

https://agent.tinyfish.ai/v1/openapi/main post /v1/runs/batch
Retrieve multiple runs by their IDs in a single request. Returns found runs and lists any IDs that were not found or not owned. Maximum 100 IDs per request.



# Get run by ID
Source: https://docs.tinyfish.ai/api-reference/runs/get-run-by-id

https://agent.tinyfish.ai/v1/openapi/main get /v1/runs/{id}
Get detailed information about a specific automation run by its ID.



# Get step HTML snapshot
Source: https://docs.tinyfish.ai/api-reference/runs/get-step-html-snapshot

https://agent.tinyfish.ai/v1/openapi/main get /v1/runs/{id}/steps/{stepId}/html
Serve the full-page HTML snapshot captured at a specific step via API key. Returns raw HTML. Only available when the run was started with capture_config.html: true.



# Get step screenshot
Source: https://docs.tinyfish.ai/api-reference/runs/get-step-screenshot

https://agent.tinyfish.ai/v1/openapi/main get /v1/runs/{id}/steps/{stepId}/screenshot
Serve the JPEG screenshot captured at a specific step via API key. Returns binary image data. Note: screenshots=url on GET /v1/runs/{id} returns browser-accessible URLs at /runs/{id}/steps/{stepId}/screenshot (session auth).



# List and search runs
Source: https://docs.tinyfish.ai/api-reference/runs/list-and-search-runs

https://agent.tinyfish.ai/v1/openapi/main get /v1/runs
List automation runs with optional filtering by status, goal text, and date range. Returns paginated results with total count. Default sort order is newest first.



# Search the web
Source: https://docs.tinyfish.ai/api-reference/search-the-web

https://agent.tinyfish.ai/v1/openapi/search get /
Search the web and get structured results. Returns ranked results with titles, snippets, and URLs.

**Location and language resolution:**
- If `location` is set but `language` is not, the language auto-resolves to the most predominantly used language in that country.
- If `language` is set but `location` is not, the location auto-resolves to the country where that language is most predominantly used.
- If neither `location` nor `language` is set, defaults to `us` and `en`.



# Terminate a browser session
Source: https://docs.tinyfish.ai/api-reference/terminate-a-browser-session

https://agent.tinyfish.ai/v1/openapi/browser delete /{sessionId}
Terminates a remote browser session immediately. If the session is already ended this call is idempotent and still returns 204.



# Connect a vault provider
Source: https://docs.tinyfish.ai/api-reference/vault/connect-a-vault-provider

https://agent.tinyfish.ai/v1/openapi/main post /v1/vault/connections
Connect a supported password manager and immediately sync display-safe credential metadata.



# Disconnect a vault provider
Source: https://docs.tinyfish.ai/api-reference/vault/disconnect-a-vault-provider

https://agent.tinyfish.ai/v1/openapi/main delete /v1/vault/connections/{connectionId}
Disconnect a vault provider and remove its stored enabled items.



# List vault connections
Source: https://docs.tinyfish.ai/api-reference/vault/list-vault-connections

https://agent.tinyfish.ai/v1/openapi/main get /v1/vault/connections
List all connected vault providers for the authenticated user.



# List vault items
Source: https://docs.tinyfish.ai/api-reference/vault/list-vault-items

https://agent.tinyfish.ai/v1/openapi/main get /v1/vault/items
List all vault items currently available from connected providers.



# Sync vault items
Source: https://docs.tinyfish.ai/api-reference/vault/sync-vault-items

https://agent.tinyfish.ai/v1/openapi/main post /v1/vault/items/sync
Sync items from connected providers and return merged item state plus sync counters.



# Authentication
Source: https://docs.tinyfish.ai/authentication

How to authenticate with the TinyFish API

TinyFish uses different authentication methods depending on how you're accessing the API:

| Access Method   | Auth Type | When to Use                         |
| --------------- | --------- | ----------------------------------- |
| REST API        | API Key   | Direct HTTP requests from your code |
| MCP Integration | OAuth 2.1 | AI assistants (Claude, Cursor)      |

***

## REST API Authentication

All REST API requests require an API key passed in the `X-API-Key` header.

### Getting Your API Key

<Steps>
  <Step title="Go to the API Keys page">
    Visit [agent.tinyfish.ai/api-keys](https://agent.tinyfish.ai/api-keys)
  </Step>

  <Step title="Create a new key">
    Click "Create API Key"
  </Step>

  <Step title="Copy and store your key">
    Copy and store your key securely
  </Step>
</Steps>

<Warning>
  API keys are shown only once. Store them securely and never commit them to version control.
</Warning>

### Using Your API Key

Pass your API key when making requests. The Python SDK reads `TINYFISH_API_KEY` from your environment automatically:

<CodeGroup>
  ```python Python theme={null}
  from tinyfish import TinyFish

  client = TinyFish()  # Reads TINYFISH_API_KEY from environment

  result = client.agent.run(
      url="https://example.com",
      goal="Extract the page title",
  )
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish } from "@tiny-fish/sdk";

  const client = new TinyFish();  // Reads TINYFISH_API_KEY from environment

  const response = await client.agent.run({
    url: "https://example.com",
    goal: "Extract the page title",
  });
  ```

  ```bash cURL theme={null}
  curl -X POST https://agent.tinyfish.ai/v1/automation/run \
    -H "X-API-Key: $TINYFISH_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"url": "https://example.com", "goal": "Extract the page title"}'
  ```
</CodeGroup>

### Environment Variables

Store your API key in an environment variable:

```bash theme={null}
# Add to your shell profile (.bashrc, .zshrc, etc.)
export TINYFISH_API_KEY="your_api_key_here"
```

For Node.js projects, use a `.env` file:

```bash theme={null}
# .env
TINYFISH_API_KEY=your_api_key_here
```

<Warning>
  Add `.env` to your `.gitignore` to prevent accidental commits.
</Warning>

***

## MCP Authentication

The MCP endpoint uses OAuth 2.1 for secure authentication with AI assistants.

### How It Works

<Steps>
  <Step title="Add the TinyFish MCP server">
    Add the TinyFish MCP server to your AI client configuration. See the [MCP Integration guide](/mcp-integration) for setup instructions.
  </Step>

  <Step title="Authenticate in browser">
    When you first use the tool, a browser window opens for authentication
  </Step>

  <Step title="Log in">
    Log in with your TinyFish account
  </Step>

  <Step title="Start using TinyFish Web Agent">
    Authorization is cached for future sessions
  </Step>
</Steps>

<Note>
  You need a TinyFish account with an active subscription or credits. [Sign up here](https://agent.tinyfish.ai/api-keys).
</Note>

***

## Error Responses

Authentication errors return standard HTTP status codes with a JSON error body. See [Error Codes](/error-codes) for the full reference.

<AccordionGroup>
  <Accordion title="401 Unauthorized — Missing API Key" icon="key">
    The request is missing the `X-API-Key` header.

    ```json theme={null}
    {
      "error": {
        "code": "MISSING_API_KEY",
        "message": "X-API-Key header is required"
      }
    }
    ```

    **How to fix:**

    * Add the `X-API-Key` header to your request
    * Check the header name is exactly `X-API-Key` (case-sensitive)
  </Accordion>

  <Accordion title="401 Unauthorized — Invalid API Key" icon="xmark">
    The API key in the request is not valid.

    ```json theme={null}
    {
      "error": {
        "code": "INVALID_API_KEY",
        "message": "The provided API key is invalid"
      }
    }
    ```

    **How to fix:**

    * Verify your API key is correct
    * Ensure no extra whitespace around the key
    * Check if the key has been revoked or regenerated

    ```bash theme={null}
    # Debug: Check your key is set
    echo $TINYFISH_API_KEY

    # Debug: Test authentication
    curl -I -X POST https://agent.tinyfish.ai/v1/automation/run \
      -H "X-API-Key: $TINYFISH_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{"url": "https://example.com", "goal": "test"}'
    ```
  </Accordion>

  <Accordion title="403 Forbidden — Insufficient Credits" icon="credit-card">
    Authentication succeeded, but you lack credits or an active subscription.

    ```json theme={null}
    {
      "error": {
        "code": "FORBIDDEN",
        "message": "Insufficient credits or no active subscription"
      }
    }
    ```

    **How to fix:**

    * Check your account at [agent.tinyfish.ai/api-keys](https://agent.tinyfish.ai/api-keys)
    * Add credits or upgrade your plan
  </Accordion>
</AccordionGroup>

***

## Security Best Practices

<CardGroup>
  <Card title="Use Environment Variables" icon="key">
    Never hardcode API keys in source code
  </Card>

  <Card title="Rotate Keys Regularly" icon="rotate">
    Regenerate keys periodically and after team changes
  </Card>

  <Card title="Limit Exposure" icon="shield">
    Use separate keys for development and production
  </Card>

  <Card title="Monitor Usage" icon="chart-line">
    Review API usage in your dashboard for anomalies
  </Card>
</CardGroup>

***

## Related

<CardGroup>
  <Card title="Quick Start" icon="rocket" href="/quick-start">
    Run your first automation
  </Card>

  <Card title="Error Codes" icon="triangle-exclamation" href="/error-codes">
    Full error code reference
  </Card>
</CardGroup>


# Browser Examples
Source: https://docs.tinyfish.ai/browser-api/examples

Real-world examples for the Browser API

## Create a Session

Start a remote browser session and get the CDP connection URL:

<CodeGroup>
  ```python Python theme={null}
  from tinyfish import TinyFish

  client = TinyFish()
  session = client.browser.sessions.create(url="https://example.com")

  print(f"Session: {session.session_id}")
  print(f"CDP URL: {session.cdp_url}")
  print(f"Base URL: {session.base_url}")
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish } from "@tiny-fish/sdk";

  const client = new TinyFish();
  const session = await client.browser.sessions.create({
    url: "https://example.com",
  });

  console.log(`Session: ${session.session_id}`);
  console.log(`CDP URL: ${session.cdp_url}`);
  console.log(`Base URL: ${session.base_url}`);
  ```

  ```bash cURL theme={null}
  curl -s -X POST https://api.browser.tinyfish.ai \
    -H "X-API-Key: $TINYFISH_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"url": "https://example.com"}'
  ```
</CodeGroup>

**Output:**

```json theme={null}
{
  "session_id": "tf-84ac6714-0f08-4592-b626-e51105a079f9",
  "cdp_url": "wss://ip-52-53-175-49.tetra-data.tinyfish.io/tf-84ac6714-...",
  "base_url": "https://ip-52-53-175-49.tetra-data.tinyfish.io/tf-84ac6714-..."
}
```

## Connect with Playwright

Create a session and control it with Playwright via CDP:

<CodeGroup>
  ```python Python theme={null}
  import asyncio
  from playwright.async_api import async_playwright
  from tinyfish import TinyFish

  async def main():
      client = TinyFish()
      session = client.browser.sessions.create(url="https://scrapeme.live/shop")

      async with async_playwright() as p:
          browser = await p.chromium.connect_over_cdp(session.cdp_url)
          page = browser.contexts[0].pages[0]

          await asyncio.sleep(2)
          await page.wait_for_load_state("domcontentloaded")

          title = await page.title()
          print(f"Page title: {title}")

          await page.screenshot(path="shop.png")
          print("Screenshot saved to shop.png")

  asyncio.run(main())
  ```

  ```typescript TypeScript theme={null}
  import { chromium } from "playwright";
  import { TinyFish } from "@tiny-fish/sdk";

  async function main() {
    const client = new TinyFish();
    const session = await client.browser.sessions.create({
      url: "https://scrapeme.live/shop",
    });

    const browser = await chromium.connectOverCDP(session.cdp_url);
    const page = browser.contexts()[0].pages()[0];

    await page.waitForLoadState("domcontentloaded");

    const title = await page.title();
    console.log(`Page title: ${title}`);

    await page.screenshot({ path: "shop.png" });
    console.log("Screenshot saved to shop.png");
  }

  main();
  ```
</CodeGroup>

<Note>
  Session creation takes 10-30 seconds. Set your HTTP client timeout to at least 60 seconds. The browser navigates to the URL asynchronously — wait for `domcontentloaded` before interacting.
</Note>

## Scrape with Playwright

Extract structured data from a page using Playwright selectors:

<CodeGroup>
  ```python Python theme={null}
  import asyncio, json
  from playwright.async_api import async_playwright
  from tinyfish import TinyFish

  async def main():
      client = TinyFish()
      session = client.browser.sessions.create(url="https://scrapeme.live/shop")

      async with async_playwright() as p:
          browser = await p.chromium.connect_over_cdp(session.cdp_url)
          page = browser.contexts[0].pages[0]
          await asyncio.sleep(2)
          await page.wait_for_load_state("domcontentloaded")

          products = await page.evaluate("""
              () => [...document.querySelectorAll('.product')].slice(0, 5).map(el => ({
                  name: el.querySelector('.woocommerce-loop-product__title')?.textContent,
                  price: el.querySelector('.price .amount')?.textContent,
              }))
          """)

          print(json.dumps(products, indent=2))

  asyncio.run(main())
  ```

  ```typescript TypeScript theme={null}
  import { chromium } from "playwright";
  import { TinyFish } from "@tiny-fish/sdk";

  async function main() {
    const client = new TinyFish();
    const session = await client.browser.sessions.create({
      url: "https://scrapeme.live/shop",
    });

    const browser = await chromium.connectOverCDP(session.cdp_url);
    const page = browser.contexts()[0].pages()[0];
    await page.waitForLoadState("domcontentloaded");

    const products = await page.evaluate(() =>
      [...document.querySelectorAll(".product")].slice(0, 5).map((el) => ({
        name: el.querySelector(".woocommerce-loop-product__title")?.textContent,
        price: el.querySelector(".price .amount")?.textContent,
      }))
    );

    console.log(JSON.stringify(products, null, 2));
  }

  main();
  ```
</CodeGroup>

**Output:**

```json theme={null}
[
  { "name": "Bulbasaur", "price": "£63.00" },
  { "name": "Ivysaur", "price": "£87.00" },
  { "name": "Venusaur", "price": "£105.00" },
  { "name": "Charmander", "price": "£48.00" },
  { "name": "Charmeleon", "price": "£165.00" }
]
```

***

## Related

<CardGroup>
  <Card title="Browser Reference" icon="browser" href="/browser-api/reference">
    Session parameters, lifecycle, and debugging
  </Card>

  <Card title="Browser Profiles" icon="window" href="/key-concepts/browser-profiles">
    Standard and stealth browser modes
  </Card>
</CardGroup>


# Browser API
Source: https://docs.tinyfish.ai/browser-api/index

Create a remote browser session and control it programmatically

The Browser API creates a remote browser session and returns a WebSocket connection URL. Use it when you need direct, low-level browser control — scripting page interactions, running your own automation framework, or tasks that go beyond the [automation run API](/key-concepts/endpoints).

```bash theme={null}
POST https://api.browser.tinyfish.ai
```

***

## Before You Start

<Steps>
  <Step title="Get your API key">
    Create a key at [agent.tinyfish.ai/api-keys](https://agent.tinyfish.ai/api-keys).
  </Step>

  <Step title="Store it in your environment">
    ```bash theme={null}
    export TINYFISH_API_KEY="your_api_key_here"
    ```
  </Step>

  <Step title="Install the required packages">
    <CodeGroup>
      ```bash Python theme={null}
      pip install tinyfish playwright
      playwright install chromium
      ```

      ```bash Node theme={null}
      npm install @tiny-fish/sdk playwright
      npx playwright install chromium
      ```
    </CodeGroup>
  </Step>
</Steps>

All requests require the `X-API-Key` header. See [Authentication](/authentication) for the full setup and troubleshooting guide.

## Your First Request

<Note>
  Session creation typically takes 10-30 seconds. Set your HTTP client timeout to at least 60 seconds.
</Note>

<CodeGroup>
  ```python Python theme={null}
  from tinyfish import TinyFish

  client = TinyFish()
  session = client.browser.sessions.create(url="https://www.tinyfish.ai")
  print(session.session_id)
  print(session.cdp_url)
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish } from "@tiny-fish/sdk";

  const client = new TinyFish();
  const session = await client.browser.sessions.create({
    url: "https://www.tinyfish.ai",
  });
  console.log(session.session_id);
  console.log(session.cdp_url);
  ```

  ```bash cURL theme={null}
  curl -X POST https://api.browser.tinyfish.ai \
    -H "X-API-Key: $TINYFISH_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"url": "https://www.tinyfish.ai"}'
  ```
</CodeGroup>

## What Success Looks Like

```json theme={null}
{
  "session_id": "br-a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "cdp_url": "wss://example.tinyfish.io/cdp",
  "base_url": "https://example.tinyfish.io"
}
```

Then connect with Playwright using `cdp_url`:

<CodeGroup>
  ```python Python theme={null}
  import asyncio
  from playwright.async_api import async_playwright

  CDP_URL = "<cdp_url from API response>"

  async def main():
      async with async_playwright() as p:
          browser = await p.chromium.connect_over_cdp(CDP_URL)
          await asyncio.sleep(2)  # let startup navigation settle

          page = browser.contexts[0].pages[0]
          await page.wait_for_load_state("domcontentloaded")
          print(await page.title())

  asyncio.run(main())
  ```

  ```typescript TypeScript theme={null}
  import { chromium } from 'playwright';

  const CDP_URL = '<cdp_url from API response>';

  const browser = await chromium.connectOverCDP(CDP_URL);
  await new Promise(r => setTimeout(r, 2000)); // let startup navigation settle

  const page = browser.contexts()[0].pages()[0];
  await page.waitForLoadState('domcontentloaded');
  console.log(await page.title());
  ```
</CodeGroup>

<Note>
  Pass `cdp_url` (the WebSocket URL) to `connect_over_cdp`. Do not use `base_url` — it is for polling session status via `/pages`, not for Playwright connections.
</Note>

## When to Use Browser vs the Other APIs

* Use **Browser** when you want direct Playwright or CDP control.
* Use **Agent** when TinyFish should decide the browser actions from a goal.
* Use **Fetch** when you only need extracted content from one or more URLs.
* Use **Search** when you need ranked search results, not a browser session.

***

## Session Lifecycle

| Behavior               | Details                                                                                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Startup navigation** | If `url` was provided at session creation, the browser navigates there immediately. The 201 response is returned before navigation completes — the page may still be loading when you connect. |
| **Inactivity timeout** | Sessions automatically terminate after **1 hour of inactivity**. A session is considered inactive when no CDP commands are being sent.                                                         |
| **No explicit delete** | There is no endpoint to delete a session. Sessions are cleaned up automatically when the inactivity timeout elapses.                                                                           |
| **Session isolation**  | Each session is a fully isolated browser instance. No cookies, storage, or state is shared between sessions.                                                                                   |

***

## Read Next

<CardGroup>
  <Card title="API Reference" icon="code" href="/browser-api/reference">
    Request and response schema
  </Card>

  <Card title="Authentication" icon="key" href="/authentication">
    API key setup
  </Card>

  <Card title="Browser Profiles" icon="browser" href="/key-concepts/browser-profiles">
    Configure browser behavior for automation runs
  </Card>

  <Card title="Key Concepts" icon="plug" href="/key-concepts/endpoints">
    Understand when to use Agent vs Browser
  </Card>

  <Card title="For coding agents" icon="robot" href="/for-coding-agents">
    One page that routes an agent to the right TinyFish API
  </Card>
</CardGroup>


# Browser API Reference
Source: https://docs.tinyfish.ai/browser-api/reference

Complete reference for the Browser API endpoints

## Endpoints

| Method   | Path                                           | Description                 |
| -------- | ---------------------------------------------- | --------------------------- |
| `POST`   | `https://api.browser.tinyfish.ai`              | Create a browser session    |
| `DELETE` | `https://api.browser.tinyfish.ai/{session_id}` | Terminate a browser session |

All requests require an `X-API-Key` header. See [Authentication](/authentication).

<Note>
  Session creation typically takes 10-30 seconds. Set your HTTP client timeout to at least 60 seconds.
</Note>

***

## Request

```json theme={null}
{
  "url": "https://www.tinyfish.ai",
  "timeout_seconds": 300
}
```

### Parameters

<ParamField type="string">
  Target URL the session will navigate to on startup. Bare domains (e.g. `tinyfish.ai`) are automatically prefixed with `https://`. Omit to start at `about:blank`.
</ParamField>

<ParamField type="integer">
  Inactivity timeout in seconds (5–86400). Defaults to your plan maximum.
</ParamField>

***

## Response

```json theme={null}
{
  "session_id": "br-a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "cdp_url": "wss://example.tinyfish.io/cdp",
  "base_url": "https://example.tinyfish.io"
}
```

<ResponseField name="session_id" type="string">
  Unique identifier for this session.
</ResponseField>

<ResponseField name="cdp_url" type="string">
  WebSocket URL for browser connection. Pass this to Playwright's `connect_over_cdp` or any CDP client.
</ResponseField>

<ResponseField name="base_url" type="string">
  HTTPS base URL for the session. Use to access session endpoints such as `/pages`.
</ResponseField>

***

## DELETE — Terminate a Session

```bash theme={null}
DELETE https://api.browser.tinyfish.ai/{session_id}
```

Terminates the session immediately. If the session is already ended this call is a no-op and still returns `204`.

### Path Parameters

<ParamField type="string">
  The `session_id` returned when the session was created.
</ParamField>

### Response

Returns `204 No Content` with an empty body on success.

### Error Codes

| HTTP Status | Error Code                            | Cause                                                          |
| ----------- | ------------------------------------- | -------------------------------------------------------------- |
| 400         | `INVALID_INPUT`                       | `session_id` is missing or empty.                              |
| 401         | `MISSING_API_KEY` / `INVALID_API_KEY` | Missing or invalid `X-API-Key`.                                |
| 404         | `NOT_FOUND`                           | Session does not exist or belongs to a different API key.      |
| 502         | `INTERNAL_ERROR`                      | Browser infrastructure failed to terminate the session. Retry. |

***

## Debugging — Open DevTools Inspector

Poll `GET {base_url}/pages` and open the `devtoolsFrontendUrl` of the first non-blank page to inspect the live browser session.

<CodeGroup>
  ```python Python theme={null}
  async def get_inspector_url(base_url: str) -> str:
      async with httpx.AsyncClient() as client:
          for _ in range(20):
              pages = (await client.get(f"{base_url}/pages", timeout=5)).json()
              nav = next((p for p in pages if p.get("url") not in ("", "about:blank", "about:newtab")), None)
              if nav:
                  return nav["devtoolsFrontendUrl"]
              await asyncio.sleep(1)
      raise TimeoutError("navigation never completed")
  ```

  ```typescript TypeScript theme={null}
  async function getInspectorUrl(baseUrl: string): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const res = await fetch(`${baseUrl}/pages`);
      const pages: { url: string; devtoolsFrontendUrl: string }[] = await res.json();
      const nav = pages.find(p => !['', 'about:blank', 'about:newtab'].includes(p.url));
      if (nav) return nav.devtoolsFrontendUrl;
      await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error('navigation never completed');
  }
  ```
</CodeGroup>

<Note>
  The page starts at `about:blank` and navigates asynchronously — skip blank pages when polling to get the correct inspector URL.
</Note>

***

## Session Lifecycle

| Behavior                 | Details                                                                                                                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Startup navigation**   | If `url` was provided at session creation, the browser navigates there immediately. The 201 response is returned before navigation completes — the page may still be loading when you connect. |
| **Inactivity timeout**   | Sessions automatically terminate after the configured inactivity timeout. A session is considered inactive when no CDP commands are being sent.                                                |
| **Explicit termination** | Send `DELETE https://api.browser.tinyfish.ai/{session_id}` to terminate a session immediately. Returns `204 No Content` on success. Deleting an already-ended session is idempotent.           |
| **Session isolation**    | Each session is a fully isolated browser instance. No cookies, storage, or state is shared between sessions.                                                                                   |

***

## SDK Methods

<CodeGroup>
  ```python Python theme={null}
  from tinyfish import TinyFish

  client = TinyFish()
  session = client.browser.sessions.create(url="https://www.tinyfish.ai")
  print(session.session_id)
  print(session.cdp_url)
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish } from "@tiny-fish/sdk";

  const client = new TinyFish();
  const session = await client.browser.sessions.create({
    url: "https://www.tinyfish.ai",
  });
  console.log(session.session_id);
  console.log(session.cdp_url);
  ```
</CodeGroup>

***

## End-to-End Example

Create a session, connect with Playwright, take a screenshot, and extract the page title.

<CodeGroup>
  ```python Python theme={null}
  import asyncio
  from tinyfish import TinyFish
  from playwright.async_api import async_playwright

  client = TinyFish()

  async def main():
      # 1. Create a browser session
      session = client.browser.sessions.create(url="https://scrapeme.live/shop")

      # 2. Connect via Playwright CDP
      async with async_playwright() as p:
          browser = await p.chromium.connect_over_cdp(session.cdp_url)
          await asyncio.sleep(2)  # let startup navigation settle

          page = browser.contexts[0].pages[0]
          await page.wait_for_load_state("domcontentloaded")

          # 3. Interact with the page
          print(await page.title())
          await page.screenshot(path="shop.png")

      # Session auto-cleans up after 1 hour of inactivity

  asyncio.run(main())
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish } from "@tiny-fish/sdk";
  import { chromium } from "playwright";

  const client = new TinyFish();

  // 1. Create a browser session
  const session = await client.browser.sessions.create({
    url: "https://scrapeme.live/shop",
  });

  // 2. Connect via Playwright CDP
  const browser = await chromium.connectOverCDP(session.cdp_url);
  await new Promise((r) => setTimeout(r, 2000)); // let startup navigation settle

  const page = browser.contexts()[0].pages()[0];
  await page.waitForLoadState("domcontentloaded");

  // 3. Interact with the page
  console.log(await page.title());
  await page.screenshot({ path: "shop.png" });

  // Session auto-cleans up after 1 hour of inactivity
  ```
</CodeGroup>

***

## Error Reference

| HTTP Status | Error Code                            | Cause                                               | Resolution                                                                                                    |
| ----------- | ------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 400         | `INVALID_INPUT`                       | `url` field is not a valid URL.                     | Check the `details` field in the error response for specifics.                                                |
| 401         | `MISSING_API_KEY` / `INVALID_API_KEY` | Missing or invalid `X-API-Key` header.              | Verify your API key at the [dashboard](https://agent.tinyfish.ai/api-keys).                                   |
| 402         | `INSUFFICIENT_CREDITS`                | No credits or active subscription.                  | Add credits or upgrade your plan.                                                                             |
| 404         | `NOT_FOUND`                           | Browser API is not available on your plan.          | Contact support to enable access.                                                                             |
| 500         | `INTERNAL_ERROR`                      | Unexpected server error.                            | Retry after a brief delay. If persistent, check [status.agent.tinyfish.ai](https://status.agent.tinyfish.ai). |
| 502         | `INTERNAL_ERROR`                      | Browser infrastructure failed to start the session. | Retry — this is usually transient.                                                                            |

## Related

<CardGroup>
  <Card title="Browser Overview" icon="browser" href="/browser-api">
    First request, success shape, and product routing
  </Card>

  <Card title="Authentication" icon="key" href="/authentication">
    API key setup
  </Card>

  <Card title="Error Codes" icon="triangle-exclamation" href="/error-codes">
    Full list of API error codes
  </Card>

  <Card title="Key Concepts" icon="plug" href="/key-concepts/endpoints">
    Understand where Browser fits in the overall API surface
  </Card>
</CardGroup>


# CLI Commands
Source: https://docs.tinyfish.ai/cli/commands

Full reference for TinyFish CLI commands

## `tinyfish search query`

Run a web search. Returns ranked results with titles, URLs, and snippets.

```bash theme={null}
tinyfish search query "best React state management libraries"
```

### Flags

| Flag                 | Description                                               |
| -------------------- | --------------------------------------------------------- |
| `--location <value>` | Location hint for geo-targeted results (e.g. `"Vietnam"`) |
| `--language <value>` | Language hint (e.g. `"en"`)                               |
| `--pretty`           | Human-readable output                                     |

### Output

```json theme={null}
{
  "query": "best React state management libraries",
  "total_results": 10,
  "results": [
    {
      "position": 1,
      "site_name": "Reddit",
      "title": "Best State Management for React in 2026",
      "url": "https://reddit.com/r/reactjs/...",
      "snippet": "Zustand and Jotai are the most popular choices..."
    }
  ]
}
```

### Examples

<CodeGroup>
  ```bash Basic query theme={null}
  tinyfish search query "tinyfish web automation"
  ```

  ```bash Geo-targeted theme={null}
  tinyfish search query "best pho in Saigon" --location "Vietnam" --language "en"
  ```

  ```bash Human-readable theme={null}
  tinyfish search query "tinyfish web automation" --pretty
  ```
</CodeGroup>

***

## `tinyfish fetch content get`

Fetch clean, extracted content from one or more URLs. Strips ads, navigation, and boilerplate — returns just the content.

```bash theme={null}
tinyfish fetch content get "https://example.com/article"
```

<Note>
  Accepts up to 10 URLs in a single call. Multiple URLs are fetched in parallel server-side.
</Note>

### Flags

| Flag                | Description                                            |
| ------------------- | ------------------------------------------------------ |
| `--format <format>` | Output format: `markdown` (default), `html`, or `json` |
| `--links`           | Include extracted links from the page                  |
| `--image-links`     | Include extracted image URLs                           |
| `--pretty`          | Human-readable output                                  |

### Output

```json theme={null}
{
  "results": [
    {
      "url": "https://example.com/article",
      "final_url": "https://example.com/article/",
      "title": "Article Title",
      "description": "A brief description",
      "language": "en",
      "author": "Jane Doe",
      "published_date": "2026-01-15",
      "format": "markdown",
      "text": "# Article Title\n\nThe full article content in clean markdown...",
      "latency_ms": 1430.39
    }
  ],
  "errors": []
}
```

When `--links` or `--image-links` are set, each result also includes:

```json theme={null}
{
  "links": ["https://example.com/about", "https://example.com/contact"],
  "image_links": ["https://example.com/hero.png"]
}
```

### Examples

<CodeGroup>
  ```bash Single URL theme={null}
  tinyfish fetch content get --format markdown "https://example.com/article"
  ```

  ```bash Multiple URLs theme={null}
  tinyfish fetch content get "https://site-a.com" "https://site-b.com" "https://site-c.com"
  ```

  ```bash With link extraction theme={null}
  tinyfish fetch content get --links --image-links "https://example.com"
  ```

  ```bash HTML format theme={null}
  tinyfish fetch content get --format html "https://example.com"
  ```
</CodeGroup>

***

## `tinyfish agent run`

Execute a browser automation. By default the output streams as newline-delimited JSON — one object per event.

```bash theme={null}
tinyfish agent run "goal" --url example.com
```

### Flags

| Flag          | Description                                                   |
| ------------- | ------------------------------------------------------------- |
| `--url <url>` | Target URL to automate (required)                             |
| `--sync`      | Wait for the run to complete and return the full result       |
| `--async`     | Submit only — return the `run_id` immediately without waiting |
| `--pretty`    | Human-readable output instead of JSON                         |

### Output modes

<Tabs>
  <Tab title="Streaming (default)">
    One JSON object per line as events arrive. Use this when you want live progress or are piping to another tool.

    ```bash theme={null}
    tinyfish agent run "Extract the pricing" --url example.com/pricing
    ```

    ```json theme={null}
    {"type":"STARTED","run_id":"abc123","run_url":"https://agent.tinyfish.ai/runs/abc123"}
    {"type":"PROGRESS","run_id":"abc123","purpose":"Navigating to the pricing page"}
    {"type":"COMPLETE","run_id":"abc123","status":"COMPLETED","result":{"price":"$99"},"run_url":"https://agent.tinyfish.ai/runs/abc123"}
    ```

    <Note>
      Pressing **Ctrl+C** during a streaming run cancels the run server-side before exiting.
    </Note>
  </Tab>

  <Tab title="Sync (--sync)">
    Waits for the run to finish and returns a single JSON object with the full result. Use this for scripts where you only care about the final output.

    ```bash theme={null}
    tinyfish agent run "Extract the pricing" --url example.com/pricing --sync
    ```

    ```json theme={null}
    {"run_id":"abc123","run_url":"https://agent.tinyfish.ai/runs/abc123","status":"COMPLETED","result":{"price":"$99"},"num_of_steps":4}
    ```
  </Tab>

  <Tab title="Async (--async)">
    Submits the run and returns immediately with the `run_id`. Use this when you want to fire-and-forget or manage polling yourself.

    ```bash theme={null}
    tinyfish agent run "Extract the pricing" --url example.com/pricing --async
    ```

    ```json theme={null}
    {"run_id":"abc123","run_url":"https://agent.tinyfish.ai/runs/abc123","error":null}
    ```
  </Tab>
</Tabs>

***

## `tinyfish agent run list`

List recent runs.

```bash theme={null}
tinyfish agent run list
```

### Flags

| Flag                | Description                                                                   |
| ------------------- | ----------------------------------------------------------------------------- |
| `--status <status>` | Filter by status: `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, or `CANCELLED` |
| `--limit <n>`       | Number of runs to return (default `20`, max `100`)                            |
| `--cursor <cursor>` | Pagination cursor from a previous response                                    |
| `--pretty`          | Human-readable output                                                         |

### Examples

<CodeGroup>
  ```bash List all runs theme={null}
  tinyfish agent run list
  ```

  ```bash Filter by status theme={null}
  tinyfish agent run list --status COMPLETED
  ```

  ```bash Paginate theme={null}
  tinyfish agent run list --limit 50 --cursor <cursor_from_previous_response>
  ```

  ```bash Human-readable theme={null}
  tinyfish agent run list --pretty
  ```
</CodeGroup>

***

## `tinyfish agent run get <run_id>`

Get the full details of a specific run.

```bash theme={null}
tinyfish agent run get abc123
```

Returns the complete run object including status, result, and metadata.

### Flags

| Flag       | Description           |
| ---------- | --------------------- |
| `--pretty` | Human-readable output |

### Example

<CodeGroup>
  ```bash JSON output theme={null}
  tinyfish agent run get abc123
  ```

  ```bash Human-readable theme={null}
  tinyfish agent run get abc123 --pretty
  ```
</CodeGroup>

***

## `tinyfish agent run cancel <run_id>`

Cancel a run that is `PENDING` or `RUNNING`.

```bash theme={null}
tinyfish agent run cancel abc123
```

```json theme={null}
{"run_id":"abc123","status":"CANCELLED","cancelled_at":"2024-01-15T10:30:00Z","message":null}
```

### Flags

| Flag       | Description           |
| ---------- | --------------------- |
| `--pretty` | Human-readable output |

***

## `tinyfish agent batch run`

Submit a batch of runs from a CSV file. The CSV must have `url` and `goal` columns.

```bash theme={null}
tinyfish agent batch run --input runs.csv
```

### CSV format

```csv theme={null}
url,goal
https://example.com,"Extract the main heading"
https://another.com,"Get the price and availability"
```

### Flags

| Flag             | Description                 |
| ---------------- | --------------------------- |
| `--input <file>` | Path to CSV file (required) |
| `--pretty`       | Human-readable output       |

### Output

```json theme={null}
{
  "data": {
    "batch_id": "550e8400-e29b-41d4-a716-446655440000",
    "total": 2,
    "submitted": 2,
    "results_url": "https://agent.tinyfish.ai/runs"
  }
}
```

<Note>
  Batches are tracked locally in `~/.tinyfish/batches.json`. Use `batch list` and `batch get` to check progress.
</Note>

***

## `tinyfish agent batch list`

List all locally tracked batches.

```bash theme={null}
tinyfish agent batch list
```

### Flags

| Flag       | Description           |
| ---------- | --------------------- |
| `--pretty` | Human-readable output |

### Output

```json theme={null}
[
  {
    "batch_id": "550e8400-e29b-41d4-a716-446655440000",
    "run_ids": ["run-1", "run-2"],
    "total": 2,
    "submitted": 2,
    "created_at": "2026-04-10T10:30:00Z"
  }
]
```

***

## `tinyfish agent batch get <batch_id>`

Get run results for a batch, including per-run status and extracted data.

```bash theme={null}
tinyfish agent batch get 550e8400-e29b-41d4-a716-446655440000
```

### Flags

| Flag       | Description           |
| ---------- | --------------------- |
| `--pretty` | Human-readable output |

### Output

```json theme={null}
{
  "batch_id": "550e8400-e29b-41d4-a716-446655440000",
  "data": [
    {
      "run_id": "run-1",
      "status": "COMPLETED",
      "goal": "Extract the main heading",
      "num_of_steps": 5,
      "result": { "heading": "Welcome" }
    }
  ],
  "not_found": null
}
```

***

## `tinyfish agent batch cancel <batch_id>`

Cancel all runs in a batch.

```bash theme={null}
tinyfish agent batch cancel 550e8400-e29b-41d4-a716-446655440000
```

### Flags

| Flag       | Description           |
| ---------- | --------------------- |
| `--pretty` | Human-readable output |

### Output

```json theme={null}
{
  "results": [
    {
      "run_id": "run-1",
      "status": "CANCELLED",
      "cancelled_at": "2026-04-10T10:35:00Z",
      "message": null
    }
  ],
  "not_found": null
}
```

***

## `tinyfish browser session create`

Spin up a remote browser instance. Returns a CDP (Chrome DevTools Protocol) WebSocket URL for programmatic control.

```bash theme={null}
tinyfish browser session create
```

### Flags

| Flag          | Description                              |
| ------------- | ---------------------------------------- |
| `--url <url>` | Navigate to a URL after session creation |
| `--pretty`    | Human-readable output                    |

### Output

```json theme={null}
{
  "session_id": "tf-9c669a12-a0d3-456e-8126-6524c32f10fc",
  "cdp_url": "wss://ip-13-56-193-1.tetra-data.production.tinyfish.io/tf-9c669a12-a0d3-456e-8126-6524c32f10fc",
  "base_url": "https://ip-13-56-193-1.tetra-data.production.tinyfish.io/tf-9c669a12-a0d3-456e-8126-6524c32f10fc"
}
```

<Note>
  Use the `cdp_url` to connect with Playwright, Puppeteer, or any CDP-compatible client. The `base_url` can be used for HTTP-based interactions with the session.
</Note>

### Examples

<CodeGroup>
  ```bash Create a blank session theme={null}
  tinyfish browser session create
  ```

  ```bash Create and navigate to a URL theme={null}
  tinyfish browser session create --url "https://example.com"
  ```

  ```bash Human-readable theme={null}
  tinyfish browser session create --pretty
  ```
</CodeGroup>

***

## Auth commands

| Command                | Description                                               |
| ---------------------- | --------------------------------------------------------- |
| `tinyfish auth login`  | Open the API keys page and save a key interactively       |
| `tinyfish auth set`    | Read an API key from stdin and save it                    |
| `tinyfish auth status` | Check whether a key is configured and where it comes from |
| `tinyfish auth logout` | Remove the saved API key                                  |


# CLI
Source: https://docs.tinyfish.ai/cli/index

Run TinyFish automations directly from your terminal

The TinyFish CLI lets you run browser automations, check results, and manage runs from your terminal — no code required.

## Installation

```bash theme={null}
npm install -g @tiny-fish/cli
```

**Verify:**

```bash theme={null}
tinyfish --version
```

## Authentication

```bash theme={null}
tinyfish auth login
```

Opens the API keys page in your browser. Paste your key when prompted. The key is saved to `~/.tinyfish/config.json`.

**For CI/CD:**

```bash theme={null}
echo $TINYFISH_API_KEY | tinyfish auth set
```

**Check status:**

```bash theme={null}
tinyfish auth status
```

Returns JSON with `source` (`env`, `config`, or `none`), `key_preview` (first/last chars of the key, or `null`), and `authenticated` (`true`/`false`). Exit code 1 when not authenticated.

## Quick Start

```bash theme={null}
npm install -g @tiny-fish/cli
export TINYFISH_API_KEY="sk-tinyfish-..."
tinyfish agent run --url "https://example.com" "Extract product data. Return JSON."
```

## Environment variables

| Variable           | Description                                |
| ------------------ | ------------------------------------------ |
| `TINYFISH_API_KEY` | API key — takes priority over saved config |

## Output

By default all commands output JSON to stdout. Errors go to stderr as JSON. Exit code 1 on failure.

Add `--pretty` to any command for human-readable output.


# Common Patterns
Source: https://docs.tinyfish.ai/common-patterns

Ready-to-use code patterns for common TinyFish Web Agent use cases

These patterns cover the most common ways to integrate TinyFish Web Agent into your application.

## Simple Extraction

Use the synchronous endpoint for quick, one-off extractions where you need the result immediately.

```typescript theme={null}
import { TinyFish, RunStatus } from "@tiny-fish/sdk";

const client = new TinyFish();

async function extractData(url: string, dataDescription: string) {
  const run = await client.agent.run({
    url,
    goal: `Extract ${dataDescription}. Return as JSON.`,
  });

  return run.status === RunStatus.COMPLETED ? run.result : null;
}

// Usage
async function main() {
  const products = await extractData(
    "https://example.com/products",
    "all product names and prices"
  );
  console.log(products);
}

main();
```

***

## Batch Processing

For multiple URLs, use the async endpoint to submit all tasks at once, then poll for results. This avoids blocking while waiting for each task to complete.

```typescript theme={null}
import { TinyFish, RunStatus } from "@tiny-fish/sdk";

const client = new TinyFish();

async function processBatch(tasks: { url: string; goal: string }[]) {
  // Submit all tasks
  const responses = await Promise.all(
    tasks.map((task) => client.agent.queue(task))
  );

  // Poll for completion
  const maxAttempts = 150; // 5 minutes at 2s intervals
  const results = await Promise.all(
    responses.map(async (r) => {
      if (r.error) {
        throw r.error;
      }
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const run = await client.runs.get(r.run_id);
        if (
          run.status === RunStatus.COMPLETED ||
          run.status === RunStatus.FAILED ||
          run.status === RunStatus.CANCELLED
        ) {
          return run;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      throw new Error(`Run ${r.run_id} timed out after ${maxAttempts} attempts`);
    })
  );

  return results;
}

// Usage
async function main() {
  const results = await processBatch([
    { url: "https://example.com/page1", goal: "Extract product info" },
    { url: "https://example.com/page2", goal: "Extract product info" },
  ]);
  console.log(results);
}

main();
```

***

## Retry with Stealth Mode

Some sites block automated requests. Start with lite mode for speed, then automatically retry with stealth mode if you get blocked.

```typescript theme={null}
import { TinyFish, RunStatus, BrowserProfile, ProxyCountryCode } from "@tiny-fish/sdk";

const client = new TinyFish();

async function extractWithFallback(url: string, goal: string) {
  // Try standard mode first
  let result = await client.agent.run({
    url,
    goal,
    browser_profile: BrowserProfile.LITE,
  });

  if (result.status === RunStatus.FAILED && result.error?.message.includes("blocked")) {
    // Retry with stealth mode
    result = await client.agent.run({
      url,
      goal,
      browser_profile: BrowserProfile.STEALTH,
      proxy_config: { enabled: true, country_code: ProxyCountryCode.US },
    });
  }

  return result;
}
```

***

## Result Validation

A run with `COMPLETED` status means the agent finished, but the result may still describe a failure (e.g., the site showed a captcha or access-denied page). Always validate the result content.

<CodeGroup>
  ```python Python theme={null}
  def is_real_success(result):
      """COMPLETED status is necessary but not sufficient."""
      if not result:
          return False
      result_str = str(result).lower()
      failure_signals = ["captcha", "blocked", "access denied", "could not", "unable to"]
      return not any(signal in result_str for signal in failure_signals)

  # Usage
  from tinyfish import TinyFish, RunStatus

  client = TinyFish()
  run = client.agent.run(
      url="https://example.com",
      goal="Extract pricing data. Return as JSON.",
  )
  if run.status == RunStatus.COMPLETED and is_real_success(run.result):
      print("Success:", run.result)
  else:
      print("Needs retry or manual review")
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish, RunStatus } from "@tiny-fish/sdk";

  function isRealSuccess(result: unknown): boolean {
    if (!result) return false;
    let resultStr: string;
    try {
      resultStr = JSON.stringify(result).toLowerCase();
    } catch {
      resultStr = String(result).toLowerCase();
    }
    const failureSignals = ["captcha", "blocked", "access denied", "could not", "unable to"];
    return !failureSignals.some((signal) => resultStr.includes(signal));
  }

  // Usage
  async function main() {
    const client = new TinyFish();
    const run = await client.agent.run({
      url: "https://example.com",
      goal: "Extract pricing data. Return as JSON.",
    });

    if (run.status === RunStatus.COMPLETED && isRealSuccess(run.result)) {
      console.log("Success:", run.result);
    } else {
      console.log("Needs retry or manual review");
    }
  }

  main();
  ```
</CodeGroup>

***

## Rate Limit Handling

TinyFish has concurrency limits based on your plan. The SDK automatically retries `429` and `5xx` errors with exponential backoff (up to `maxRetries` attempts, default 2).

```typescript theme={null}
import { TinyFish, RateLimitError } from "@tiny-fish/sdk";

// Adjust retry behavior via client options
const client = new TinyFish({
  maxRetries: 3,  // default is 2
});

async function main() {
  try {
    const run = await client.agent.run({
      url: "https://example.com",
      goal: "Extract data",
    });
    console.log(run.result);
  } catch (e) {
    if (e instanceof RateLimitError) {
      console.log("Rate limited after all retries exhausted");
    }
    throw e;
  }
}

main();
```

***

## Authenticated Automation

Use vault credentials to automate sites that require login. Connect your password manager once via the [vault setup](/vault-setup), then pass credentials to each run.

<CodeGroup>
  ```bash cURL theme={null}
  # Use all vault credentials
  curl -X POST https://agent.tinyfish.ai/v1/automation/run \
    -H "X-API-Key: $TINYFISH_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "url": "https://www.linkedin.com",
      "goal": "Log in and extract the latest 3 posts from my feed. Return as JSON.",
      "use_vault": true
    }'

  # Scope to a specific credential
  curl -X POST https://agent.tinyfish.ai/v1/automation/run \
    -H "X-API-Key: $TINYFISH_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "url": "https://www.linkedin.com",
      "goal": "Log in and extract the latest 3 posts from my feed. Return as JSON.",
      "use_vault": true,
      "credential_item_ids": ["cred:conn-abc:Work:item-linkedin"]
    }'
  ```

  ```python Python theme={null}
  # SDK vault support coming soon — use cURL or raw HTTP for now
  import httpx

  response = httpx.post(
      "https://agent.tinyfish.ai/v1/automation/run",
      headers={"X-API-Key": TINYFISH_API_KEY},
      json={
          "url": "https://www.linkedin.com",
          "goal": "Log in and extract the latest 3 posts from my feed. Return as JSON.",
          "use_vault": True,
      },
  )
  print(response.json())
  ```
</CodeGroup>

<Tip>
  Use `credential_item_ids` to scope runs to specific credentials when you have multiple accounts on the same domain. See [Vault Credentials](/key-concepts/credentials) for details.
</Tip>

***

## Cross-API Workflows

Chain multiple TinyFish APIs together for complex workflows.

### Search + Fetch

Search for URLs, then fetch full content from the top results:

<CodeGroup>
  ```python Python theme={null}
  from tinyfish import TinyFish

  client = TinyFish()

  # Step 1: Search for relevant pages
  search_results = client.search.query("best python web frameworks 2026")

  # Step 2: Fetch content from top 3 results
  urls = [r.url for r in search_results.results[:3]]
  fetched = client.fetch.get_contents(urls=urls, format="markdown")

  for page in fetched.results:
      print(f"{page.title}: {page.text[:200]}...")
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish } from "@tiny-fish/sdk";

  const client = new TinyFish();

  // Step 1: Search for relevant pages
  const searchResults = await client.search.query({
    query: "best python web frameworks 2026",
  });

  // Step 2: Fetch content from top 3 results
  const urls = searchResults.results.slice(0, 3).map((r) => r.url);
  const fetched = await client.fetch.getContents({ urls, format: "markdown" });

  fetched.results.forEach((page) =>
    console.log(`${page.title}: ${page.text.slice(0, 200)}...`)
  );
  ```
</CodeGroup>

### Search + Agent

Search for a URL, then extract structured data via the Agent API:

<CodeGroup>
  ```python Python theme={null}
  from tinyfish import TinyFish, RunStatus

  client = TinyFish()

  # Step 1: Find a product page
  search_results = client.search.query("scrapeme pokemon shop bulbasaur")
  target_url = search_results.results[0].url

  # Step 2: Extract structured data with the Agent
  run = client.agent.run(
      url=target_url,
      goal="""Extract from this product page:
      - product_name, price (number), in_stock (boolean)
      Return as JSON.""",
  )

  if run.status == RunStatus.COMPLETED:
      print(run.result)
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish, RunStatus } from "@tiny-fish/sdk";

  const client = new TinyFish();

  // Step 1: Find a product page
  const searchResults = await client.search.query({
    query: "scrapeme pokemon shop bulbasaur",
  });
  const targetUrl = searchResults.results[0].url;

  // Step 2: Extract structured data with the Agent
  const run = await client.agent.run({
    url: targetUrl,
    goal: `Extract from this product page:
      - product_name, price (number), in_stock (boolean)
      Return as JSON.`,
  });

  if (run.status === RunStatus.COMPLETED) {
    console.log(run.result);
  }
  ```
</CodeGroup>

***

## Related

<CardGroup>
  <Card title="AI Integration Guide" icon="robot" href="/ai-integration">
    Best practices for AI agents
  </Card>

  <Card title="Examples" icon="code" href="/examples/scraping">
    More detailed examples
  </Card>
</CardGroup>


# Error Codes
Source: https://docs.tinyfish.ai/error-codes

API error codes and how to resolve them

## Error Response Format

API errors use one of two schemas depending on the HTTP status code:

```json theme={null}
// 400 Bad Request — may include validation details
{
  "error": {
    "code": "INVALID_INPUT",
    "message": "Validation failed",
    "details": [
      { "code": "too_small", "path": ["goal"], "message": "Too small: expected string to have >=1 characters" }
    ]
  }
}
```

```json theme={null}
// 401 Unauthorized and other errors — simpler schema without details
{
  "error": {
    "code": "INVALID_API_KEY",
    "message": "The provided API key is invalid"
  }
}
```

<Note>
  400 validation errors may include a `details` array with Zod validation issues. Not all 400 errors include `details`. 401 and other errors use a simpler schema without `details`.
</Note>

## Error Codes Reference

### MISSING\_API\_KEY

**HTTP Status:** 401

The `X-API-Key` header was not included in the request.

```json theme={null}
{
  "error": {
    "code": "MISSING_API_KEY",
    "message": "X-API-Key header is required"
  }
}
```

**Solution:** Add the `X-API-Key` header to your request:

```bash theme={null}
curl -H "X-API-Key: $TINYFISH_API_KEY" ...
```

***

### INVALID\_API\_KEY

**HTTP Status:** 401

The provided API key does not exist or has been revoked.

```json theme={null}
{
  "error": {
    "code": "INVALID_API_KEY",
    "message": "The provided API key is invalid"
  }
}
```

**Solutions:**

1. Verify your API key is correct (no extra whitespace)
2. Check if the key was deleted in the [API Keys dashboard](https://agent.tinyfish.ai/api-keys)
3. Generate a new key if needed

***

### INVALID\_INPUT

**HTTP Status:** 400

The request body failed validation.

```json theme={null}
{
  "error": {
    "code": "INVALID_INPUT",
    "message": "Validation failed",
    "details": [
      { "code": "invalid_string", "path": ["url"], "message": "Invalid URL" },
      { "code": "too_small", "path": ["goal"], "message": "Required field missing" }
    ]
  }
}
```

**Common Causes:**

* `url` is missing or not a valid URL (must include `https://`)
* `goal` is empty or missing
* `browser_profile` is not "lite" or "stealth"
* `proxy_config.country_code` is not a supported 2-letter code

**Solution:** Check the `details` field for specific validation errors.

***

### RATE\_LIMIT\_EXCEEDED

**HTTP Status:** 429

Too many requests in a short period.

```json theme={null}
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded. Try again in 60 seconds."
  }
}
```

Rate limits vary by API and plan. Search API: 5 requests/minute. Other APIs have higher limits. The `Retry-After` header is not currently returned — use exponential backoff (see example below).

**Solutions:**

1. Implement exponential backoff in your code
2. Space out requests (recommended: 1-2 seconds between calls)
3. Use batch endpoints for high-volume workloads
4. Contact support for higher rate limits

**Example: Exponential Backoff**

```python theme={null}
import time
import random
from tinyfish import TinyFish, RateLimitError

client = TinyFish()

def call_with_backoff(fn, max_retries=5):
    for attempt in range(max_retries):
        try:
            return fn()
        except RateLimitError:
            if attempt == max_retries - 1:
                raise
            wait = (2 ** attempt) + random.uniform(0, 1)
            time.sleep(wait)
```

***

### UNAUTHORIZED

**HTTP Status:** 401

Authentication failed for a reason other than missing/invalid key.

```json theme={null}
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication failed"
  }
}
```

**Solutions:**

1. Check your account status at [agent.tinyfish.ai/api-keys](https://agent.tinyfish.ai/api-keys)
2. Verify your API key hasn't expired
3. Try generating a new API key

***

### FORBIDDEN

**HTTP Status:** 403

Authentication succeeded, but you lack permission for this action.

```json theme={null}
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Insufficient credits or no active subscription"
  }
}
```

**Common Causes:**

* No remaining credits
* Subscription has expired
* Attempting to access a resource you don't own

**Solution:** Check your account balance and subscription status at [agent.tinyfish.ai/api-keys](https://agent.tinyfish.ai/api-keys).

***

### NOT\_FOUND

**HTTP Status:** 404

The requested resource does not exist.

```json theme={null}
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Run not found"
  }
}
```

**Common Causes:**

* Invalid `run_id` in `GET /v1/runs/:id`
* Run was deleted or never existed
* Typo in the run ID

**Solution:** Verify the run ID is correct. Run IDs are returned from `/v1/automation/run-async` or can be listed via `GET /v1/runs`.

***

### INTERNAL\_ERROR

**HTTP Status:** 500

An unexpected error occurred on the server.

```json theme={null}
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "An unexpected error occurred"
  }
}
```

**Solutions:**

1. Retry the request after a brief delay
2. If the error persists, check [status.agent.tinyfish.ai](https://status.agent.tinyfish.ai) for outages
3. Contact support with your request details and timestamp

## Run Status vs Error Codes

<Note>
  Error codes indicate **API-level failures** (authentication, validation, server errors).

  For **automation-level failures** (browser crashed, goal couldn't be achieved), check the `status` and `error` fields in the run response. See [Understanding Run Status](/faq#what-does-completed-status-mean).
</Note>

## HTTP Status Code Summary

| Status | Meaning           | Error Codes                                          |
| ------ | ----------------- | ---------------------------------------------------- |
| 400    | Bad Request       | `INVALID_INPUT`                                      |
| 401    | Unauthorized      | `MISSING_API_KEY`, `INVALID_API_KEY`, `UNAUTHORIZED` |
| 403    | Forbidden         | `FORBIDDEN`                                          |
| 404    | Not Found         | `NOT_FOUND`                                          |
| 429    | Too Many Requests | `RATE_LIMIT_EXCEEDED`                                |
| 500    | Server Error      | `INTERNAL_ERROR`                                     |

## Related

<CardGroup>
  <Card title="Authentication" icon="key" href="/authentication">
    API key setup and troubleshooting
  </Card>

  <Card title="FAQ" icon="circle-question" href="/faq">
    Common questions and issues
  </Card>
</CardGroup>


# Async Bulk Requests
Source: https://docs.tinyfish.ai/examples/bulk-requests-async

Submit multiple runs and poll for results

## Overview

The async API pattern is ideal when you want to submit multiple long-running tasks and check their status later. Instead
of waiting for each run to complete, you submit all requests and get back run IDs that you can poll for completion.

## How It Works

1. Submit requests to `/v1/automation/run-async`, which returns corresponding `run_id`s, which you will need if you want
   to check the status of a particular run.
2. Check individual runs with `GET /v1/runs/:id` to check status
3. Or fetch all runs with `GET /v1/runs` to monitor batch progress

## Basic Example

Submit multiple TinyFish Web Agent runs and poll for completion:

<CodeGroup>
  ```python Python theme={null}
  import asyncio
  from tinyfish import AsyncTinyFish, RunStatus

  async def wait_for_completion(client, run_id, poll_interval=2):
      """Poll a run until it completes"""
      while True:
          run = await client.runs.get(run_id)

          if run.status in (RunStatus.COMPLETED, RunStatus.FAILED, RunStatus.CANCELLED):
              return run

          await asyncio.sleep(poll_interval)

  async def main():
      client = AsyncTinyFish()

      # Define your batch of tasks
      tasks_to_run = [
          {
              "url": "https://scrapeme.live/shop/",
              "goal": "Extract all available products on page two with their name, price, and review rating (if available)",
          },
          {
              "url": "https://books.toscrape.com/",
              "goal": "Extract all available books on page two with their title, price, and review rating (if available)",
          },
      ]

      # Step 1: Submit all tinyfish runs and collect run_ids
      print("Submitting tinyfish runs...")
      submit_tasks = [
          client.agent.queue(url=task["url"], goal=task["goal"])
          for task in tasks_to_run
      ]
      responses = await asyncio.gather(*submit_tasks)
      run_ids = [r.run_id for r in responses]
      print(f"Submitted {len(run_ids)} runs: {run_ids}")

      # Step 2: Wait for all runs to complete
      print("Waiting for completion...")
      completion_tasks = [
          wait_for_completion(client, run_id)
          for run_id in run_ids
      ]
      results = await asyncio.gather(*completion_tasks)

      # Step 3: Process results
      for i, run in enumerate(results):
          print(f"Run {i + 1} ({run.run_id}):")
          print(f"  Status: {run.status}")
          if run.status == RunStatus.COMPLETED:
              print(f"  Result: {run.result}")

  # Run the async main function
  asyncio.run(main())
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish, RunStatus } from "@tiny-fish/sdk";

  const client = new TinyFish();

  async function waitForCompletion(runId: string, pollInterval = 2000) {
    while (true) {
      const run = await client.runs.get(runId);
      if (
        run.status === RunStatus.COMPLETED ||
        run.status === RunStatus.FAILED ||
        run.status === RunStatus.CANCELLED
      ) {
        return run;
      }
      await new Promise((r) => setTimeout(r, pollInterval));
    }
  }

  async function main() {
    // Define your batch of tasks
    const tasksToRun = [
      {
        url: "https://scrapeme.live/shop/",
        goal: "Extract all available products on page two with their name, price, and review rating (if available)",
      },
      {
        url: "https://books.toscrape.com/",
        goal: "Extract all available books on page two with their title, price, and review rating (if available)",
      },
    ];

    // Step 1: Submit all tinyfish runs and collect run_ids
    console.log("Submitting tinyfish runs...");
    const responses = await Promise.all(
      tasksToRun.map((task) => client.agent.queue(task))
    );
    const runIds = responses.map((response) => {
      if (response.error) {
        throw new Error(`Failed to queue run: ${response.error.message}`);
      }
      return response.run_id;
    });
    console.log(`Submitted ${runIds.length} runs:`, runIds);

    // Step 2: Wait for all runs to complete
    console.log("Waiting for completion...");
    const results = await Promise.all(runIds.map((id) => waitForCompletion(id)));

    // Step 3: Process results
    results.forEach((run, i) => {
      console.log(`Run ${i + 1} (${run.run_id}):`);
      console.log(`  Status: ${run.status}`);
      if (run.status === RunStatus.COMPLETED) {
        console.log(`  Result:`, run.result);
      }
    });
  }

  main();
  ```
</CodeGroup>

## Fire and Forget Pattern

Submit tasks without waiting for completion:

<CodeGroup>
  ```python Python theme={null}
  async def main():
      client = AsyncTinyFish()

      tasks_to_run = [
          {"url": "https://example.com/page1", "goal": "Extract product info"},
          {"url": "https://example.com/page2", "goal": "Extract product info"},
          {"url": "https://example.com/page3", "goal": "Extract product info"},
      ]

      # Submit all tasks
      submit_tasks = [
          client.agent.queue(url=task["url"], goal=task["goal"])
          for task in tasks_to_run
      ]
      responses = await asyncio.gather(*submit_tasks)
      run_ids = [r.run_id for r in responses]

      print(f"Submitted {len(run_ids)} runs")
      print(f"Run IDs: {run_ids}")
      print("Check status later using client.runs.get(run_id)")

  asyncio.run(main())
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish } from "@tiny-fish/sdk";

  const client = new TinyFish();

  async function main() {
    const tasksToRun = [
      { url: "https://example.com/page1", goal: "Extract product info" },
      { url: "https://example.com/page2", goal: "Extract product info" },
      { url: "https://example.com/page3", goal: "Extract product info" },
    ];

    // Submit all tasks
    const responses = await Promise.all(
      tasksToRun.map((task) => client.agent.queue(task))
    );
    const runIds = responses.map((response) => {
      if (response.error) {
        throw new Error(`Failed to queue run: ${response.error.message}`);
      }
      return response.run_id;
    });

    console.log(`Submitted ${runIds.length} runs`);
    console.log("Run IDs:", runIds);
    console.log("Check status later using client.runs.get(runId)");
  }

  main();
  ```
</CodeGroup>

## When to Use Async vs Sync

| Use Case            | API Pattern        | Why                                  |
| ------------------- | ------------------ | ------------------------------------ |
| Quick tasks (\<30s) | Sync `/run`        | Simpler code, immediate results      |
| Long-running tasks  | Async `/run-async` | Don't block, check later             |
| Large batches       | Async `/run-async` | Submit all at once, monitor progress |
| Fire and forget     | Async `/run-async` | No need to wait                      |
| Real-time feedback  | SSE `/run-sse`     | Stream progress events               |

## Best Practices

### Polling Interval

* **Short tasks (under 1 min)**: Poll every 2-3 seconds
* **Medium tasks (1-5 min)**: Poll every 5-10 seconds
* **Long tasks (over 5 min)**: Poll every 30-60 seconds

### Error Handling

Always check run status and handle failures:

```python Python theme={null}
async def process_completed_run(run):
    if run.status == RunStatus.COMPLETED:
        return run.result
    elif run.status == RunStatus.FAILED:
        print(f"Run {run.run_id} failed: {run.error}")
        return None
    elif run.status == RunStatus.CANCELLED:
        print(f"Run {run.run_id} was cancelled")
        return None
```

## API Reference

<CardGroup>
  <Card title="Run Async" icon="code" href="https://docs.tinyfish.ai/api-reference/automation/start-automation-asynchronously">
    Start TinyFish Web Agent run asynchronously
  </Card>

  <Card title="List Runs" icon="list" href="https://docs.tinyfish.ai/api-reference/automation/list-runs">
    Get all runs
  </Card>

  <Card title="Get Run by ID" icon="file" href="https://docs.tinyfish.ai/api-reference/automation/get-run-by-id">
    Check individual run status
  </Card>

  <Card title="Cancel Run" icon="xmark" href="https://docs.tinyfish.ai/api-reference/runs/cancel-run-by-id">
    Cancel a running automation
  </Card>
</CardGroup>

## Related

<CardGroup>
  <Card title="Concurrent Requests" icon="bolt" href="/examples/bulk-requests-sync">
    Sync API for immediate results
  </Card>

  <Card title="Web Scraping" icon="magnifying-glass" href="/examples/scraping">
    Extract data from pages
  </Card>
</CardGroup>


# Concurrent Requests
Source: https://docs.tinyfish.ai/examples/bulk-requests-sync

Process multiple runs in parallel for better performance

## Overview

When you need to scrape multiple pages, fill multiple forms, or process a batch of URLs, firing requests concurrently
can significantly speed up your workflow. This guide shows how to run multiple TinyFish Web Agent runs in parallel using the sync API.

## Basic Example

Fire multiple requests concurrently and gather results:

<CodeGroup>
  ```python Python theme={null}
  import asyncio
  from tinyfish import AsyncTinyFish

  async def main():
      client = AsyncTinyFish()

      # Define your batch of tasks - scraping multiple sites
      tasks_to_run = [
          {
              "url": "https://scrapeme.live/shop/",
              "goal": "Extract all available products on page two with their name, price, and review rating (if available)",
          },
          {
              "url": "https://books.toscrape.com/",
              "goal": "Extract all available books on page two with their title, price, and review rating (if available)",
          },
      ]

      # Fire all requests concurrently
      tasks = [
          client.agent.run(url=task["url"], goal=task["goal"])
          for task in tasks_to_run
      ]

      # Wait for all tasks to complete
      results = await asyncio.gather(*tasks)

      # Process results
      for i, response in enumerate(results):
          print(f"Task {i + 1} result:", response.result)

  # Run the async main function
  asyncio.run(main())
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish } from "@tiny-fish/sdk";

  const client = new TinyFish();

  async function main() {
    // Define your batch of tasks - scraping multiple sites
    const tasksToRun = [
      {
        url: "https://scrapeme.live/shop/",
        goal: "Extract all available products on page two with their name, price, and review rating (if available)",
      },
      {
        url: "https://books.toscrape.com/",
        goal: "Extract all available books on page two with their title, price, and review rating (if available)",
      },
    ];

    // Fire all requests concurrently
    const results = await Promise.all(
      tasksToRun.map((task) => client.agent.run(task))
    );

    // Process results
    results.forEach((response, i) => {
      console.log(`Task ${i + 1} result:`, response.result);
    });
  }

  main();
  ```
</CodeGroup>

<Note>
  The sync `/run` API is perfect for concurrent requests - you get clean, simple code without SSE stream handling,
  making it ideal for batch operations with `asyncio.gather()` or `Promise.all()`.
</Note>

## Batch Multiple Forms

Fill multiple contact forms concurrently:

```python Python theme={null}
async def main():
    client = AsyncTinyFish()

    companies = [
        {"name": "Acme Corp", "url": "https://acme.com/contact"},
        {"name": "TechStart", "url": "https://techstart.io/contact"},
        {"name": "BuildIt", "url": "https://buildit.com/contact"},
    ]

    tasks = [
        client.agent.run(
            url=company["url"],
            goal=f"""Fill in the contact form:
                - Name field: "John Doe"
                - Email field: "john@example.com"
                - Message field: "Interested in partnership with {company['name']}"
                Then click Submit and extract the success message.
            """,
        )
        for company in companies
    ]

    results = await asyncio.gather(*tasks)

    for company, response in zip(companies, results):
        print(f"{company['name']}: {response.result}")
```

## Gotchas and Caveats

<Warning>
  **Concurrency Limits**: Each user account has a concurrency limit for simultaneous browser sessions. When you exceed
  this limit, additional requests will be queued automatically rather than returning a 429 error.
</Warning>

### Queueing Behavior

When you hit your account's concurrency cap:

* **No 429 errors**: Unlike traditional rate-limited APIs, TinyFish won't reject your request with a 429 status code
* **Automatic queueing**: Your request will be accepted and queued until a browser session becomes available
* **Longer run times**: The total run time will include both queue wait time and execution time

**Example scenario**: If your account allows 3 concurrent sessions and you fire 10 requests simultaneously:

* Requests 1-3 start immediately
* Requests 4-10 are queued
* As each request completes, the next queued request begins
* You won't get errors, but later requests will take longer to complete

<Note>
  We're actively working on improving the queueing experience with better visibility into queue position and estimated
  wait times. This behavior will be enhanced in an upcoming release.
</Note>

### Best Practices

* **Know your limits**: Check your plan's concurrency limit in your dashboard
* **Batch sizing**: Size your concurrent batches to match your concurrency limit for optimal performance
* **Progress tracking**: Implement timing/logging to monitor which requests are queued vs executing
* **Error handling**: Always handle potential timeouts for long-running or queued requests

## Related

<CardGroup>
  <Card title="Web Scraping" icon="magnifying-glass" href="/examples/scraping">
    Extract data from pages
  </Card>

  <Card title="Form Filling" icon="file-lines" href="/examples/form-filling">
    Automate form submissions
  </Card>

  <Card title="Run API Reference" icon="code" href="https://docs.tinyfish.ai/api-reference/automation/run-browser-automation-synchronously">
    Complete API documentation
  </Card>
</CardGroup>


# Form Filling
Source: https://docs.tinyfish.ai/examples/form-filling

Automate form filling and submission

## Basic Example

Fill and submit a contact form:

<CodeGroup>
  ```python Python theme={null}
  from tinyfish import TinyFish, EventType, RunStatus

  client = TinyFish()

  with client.agent.stream(
      url="https://example.com/contact",
      goal="""Fill in the contact form:
          - Name field: "John Doe"
          - Email field: "john@example.com"
          - Message field: "I am interested in your services."
          Then click the Submit button and extract the success message.
      """,
  ) as stream:
      for event in stream:
          if event.type == EventType.COMPLETE and event.status == RunStatus.COMPLETED:
              print("Result:", event.result_json)
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish, EventType, RunStatus } from "@tiny-fish/sdk";

  async function main() {
    const client = new TinyFish();

    const stream = await client.agent.stream({
      url: "https://example.com/contact",
      goal: `Fill in the contact form:
        - Name field: "John Doe"
        - Email field: "john@example.com"
        - Message field: "I am interested in your services."
        Then click the Submit button and extract the success message.
      `,
    });

    for await (const event of stream) {
      if (event.type === EventType.COMPLETE && event.status === RunStatus.COMPLETED) {
        console.log("Result:", event.result);
      }
    }
  }

  main();
  ```

  ```bash cURL theme={null}
  curl -N -X POST https://agent.tinyfish.ai/v1/automation/run-sse \
    -H "X-API-Key: $TINYFISH_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "url": "https://example.com/contact",
      "goal": "Fill in the contact form with name John Doe and email john@example.com, then click Submit"
    }'
  ```

  ```bash CLI theme={null}
  tinyfish agent run "Fill in the contact form: Name: John Doe, Email: john@example.com, Message: I am interested in your services. Then click Submit and return the success message." \
    --url example.com/contact --pretty
  ```
</CodeGroup>

**Output:**

```json theme={null}
{
  "success": true,
  "message": "Thank you for contacting us!"
}
```

## Multi-Step Form

Handle multi-step forms in a single goal:

<CodeGroup>
  ```python Python theme={null}
  from tinyfish import TinyFish

  client = TinyFish()

  with client.agent.stream(
      url="https://example.com/signup",
      goal="""Complete the multi-step signup form:

          Step 1 (Personal Info):
          - First name: "John"
          - Last name: "Doe"
          - Email: "john@example.com"
          - Click "Next"

          Step 2 (Address):
          - Street: "123 Main St"
          - City: "San Francisco"
          - State: "CA"
          - ZIP: "94102"
          - Click "Next"

          Step 3 (Preferences):
          - Select "Email notifications" checkbox
          - Click "Submit"

          Extract the confirmation number from the success page.
      """,
  ) as stream:
      for event in stream:
          print(event)
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish } from "@tiny-fish/sdk";

  async function main() {
    const client = new TinyFish();

    const stream = await client.agent.stream({
      url: "https://example.com/signup",
      goal: `Complete the multi-step signup form:

        Step 1 (Personal Info):
        - First name: "John"
        - Last name: "Doe"
        - Email: "john@example.com"
        - Click "Next"

        Step 2 (Address):
        - Street: "123 Main St"
        - City: "San Francisco"
        - State: "CA"
        - ZIP: "94102"
        - Click "Next"

        Step 3 (Preferences):
        - Select "Email notifications" checkbox
        - Click "Submit"

        Extract the confirmation number from the success page.
      `,
    });

    for await (const event of stream) {
      console.log(event);
    }
  }

  main();
  ```

  ```bash cURL theme={null}
  curl -N -X POST https://agent.tinyfish.ai/v1/automation/run-sse \
    -H "X-API-Key: $TINYFISH_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "url": "https://example.com/signup",
      "goal": "Complete the multi-step signup form: Step 1 - First name John, Last name Doe, Email john@example.com, click Next. Step 2 - Street 123 Main St, City San Francisco, State CA, ZIP 94102, click Next. Step 3 - Select Email notifications checkbox, click Submit. Extract the confirmation number."
    }'
  ```
</CodeGroup>

## Tips

* Use stealth mode for login/signup forms
* Be explicit about field values in your goal
* Describe buttons by their text ("click 'Submit'")
* Handle multi-step forms in one goal

## Try It

<Steps>
  <Step title="Save the code">Save any example above as `form.ts`</Step>
  <Step title="Set your API key">`export TINYFISH_API_KEY="your_api_key" `</Step>
  <Step title="Run it">`npx tsx form.ts `</Step>
</Steps>

## Related

<CardGroup>
  <Card title="Web Scraping" icon="magnifying-glass" href="/examples/scraping">
    Extract data from pages
  </Card>

  <Card title="Run SSE API" icon="code" href="/api-reference">
    Complete API docs
  </Card>
</CardGroup>


# Web Scraping
Source: https://docs.tinyfish.ai/examples/scraping

Extract data from any website using natural language

## Basic Example

Extract product data from any page:

<CodeGroup>
  ```python Python theme={null}
  from tinyfish import TinyFish, EventType, RunStatus

  client = TinyFish()

  with client.agent.stream(
      url="https://scrapeme.live/shop/Bulbasaur/",
      goal="Extract the product name, price, and stock status",
  ) as stream:
      for event in stream:
          if event.type == EventType.COMPLETE and event.status == RunStatus.COMPLETED:
              print("Result:", event.result_json)
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish, EventType, RunStatus } from "@tiny-fish/sdk";

  async function main() {
    const client = new TinyFish();

    const stream = await client.agent.stream({
      url: "https://scrapeme.live/shop/Bulbasaur/",
      goal: "Extract the product name, price, and stock status",
    });

    for await (const event of stream) {
      if (event.type === EventType.COMPLETE && event.status === RunStatus.COMPLETED) {
        console.log("Result:", event.result);
      }
    }
  }

  main();
  ```

  ```bash cURL theme={null}
  curl -N -X POST https://agent.tinyfish.ai/v1/automation/run-sse \
    -H "X-API-Key: $TINYFISH_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "url": "https://scrapeme.live/shop/Bulbasaur/",
      "goal": "Extract the product name, price, and stock status"
    }'
  ```

  ```bash CLI theme={null}
  tinyfish agent run "Extract the product name, price, and stock status" \
    --url scrapeme.live/shop/Bulbasaur/ --pretty
  ```
</CodeGroup>

**Output:**

```json theme={null}
{
  "name": "Bulbasaur",
  "price": 63,
  "inStock": true
}
```

## Extract Multiple Items

Get all products from a category page:

<CodeGroup>
  ```python Python theme={null}
  from tinyfish import TinyFish

  client = TinyFish()

  with client.agent.stream(
      url="https://scrapeme.live/shop/",
      goal="Extract all products on this page. For each product return: name, price, and link",
  ) as stream:
      for event in stream:
          print(event)
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish } from "@tiny-fish/sdk";

  async function main() {
    const client = new TinyFish();

    const stream = await client.agent.stream({
      url: "https://scrapeme.live/shop/",
      goal: "Extract all products on this page. For each product return: name, price, and link",
    });

    for await (const event of stream) {
      console.log(event);
    }
  }

  main();
  ```

  ```bash cURL theme={null}
  curl -N -X POST https://agent.tinyfish.ai/v1/automation/run-sse \
    -H "X-API-Key: $TINYFISH_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "url": "https://scrapeme.live/shop/",
      "goal": "Extract all products on this page. For each product return: name, price, and link"
    }'
  ```
</CodeGroup>

**Output:**

```json theme={null}
{
  "products": [
    { "name": "Bulbasaur", "price": 63, "link": "https://..." },
    { "name": "Ivysaur", "price": 87, "link": "https://..." },
    { "name": "Venusaur", "price": 105, "link": "https://..." }
  ]
}
```

## Use Stealth Mode

For sites with bot protection:

<CodeGroup>
  ```python Python theme={null}
  from tinyfish import TinyFish, BrowserProfile

  client = TinyFish()

  with client.agent.stream(
      url="https://protected-site.com",
      goal="Extract product data",
      browser_profile=BrowserProfile.STEALTH,
  ) as stream:
      for event in stream:
          print(event)
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish, BrowserProfile } from "@tiny-fish/sdk";

  async function main() {
    const client = new TinyFish();

    const stream = await client.agent.stream({
      url: "https://protected-site.com",
      goal: "Extract product data",
      browser_profile: BrowserProfile.STEALTH,
    });

    for await (const event of stream) {
      console.log(event);
    }
  }

  main();
  ```

  ```bash cURL theme={null}
  curl -N -X POST https://agent.tinyfish.ai/v1/automation/run-sse \
    -H "X-API-Key: $TINYFISH_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "url": "https://protected-site.com",
      "goal": "Extract product data",
      "browser_profile": "stealth"
    }'
  ```
</CodeGroup>

## Use Proxy

Route through a specific country:

<CodeGroup>
  ```python Python theme={null}
  from tinyfish import TinyFish, BrowserProfile, ProxyConfig, ProxyCountryCode

  client = TinyFish()

  with client.agent.stream(
      url="https://geo-restricted-site.com",
      goal="Extract data",
      browser_profile=BrowserProfile.STEALTH,
      proxy_config=ProxyConfig(enabled=True, country_code=ProxyCountryCode.US),
  ) as stream:
      for event in stream:
          print(event)
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish, BrowserProfile, ProxyCountryCode } from "@tiny-fish/sdk";

  async function main() {
    const client = new TinyFish();

    const stream = await client.agent.stream({
      url: "https://geo-restricted-site.com",
      goal: "Extract data",
      browser_profile: BrowserProfile.STEALTH,
      proxy_config: { enabled: true, country_code: ProxyCountryCode.US },
    });

    for await (const event of stream) {
      console.log(event);
    }
  }

  main();
  ```

  ```bash cURL theme={null}
  curl -N -X POST https://agent.tinyfish.ai/v1/automation/run-sse \
    -H "X-API-Key: $TINYFISH_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "url": "https://geo-restricted-site.com",
      "goal": "Extract data",
      "browser_profile": "stealth",
      "proxy_config": {
        "enabled": true,
        "country_code": "US"
      }
    }'
  ```
</CodeGroup>

## Try It

<Steps>
  <Step title="Save the code">Save any example above as `scraper.ts`</Step>
  <Step title="Set your API key">`export TINYFISH_API_KEY="your_api_key" `</Step>
  <Step title="Run it">`npx tsx scraper.ts `</Step>
</Steps>

## Related

<CardGroup>
  <Card title="Form Filling" icon="file-lines" href="/examples/form-filling">
    Automate form submissions
  </Card>

  <Card title="Run SSE API" icon="code" href="/api-reference">
    Complete API docs
  </Card>
</CardGroup>


# Frequently Asked Questions
Source: https://docs.tinyfish.ai/faq

Common questions about TinyFish Web Agent

## General

<AccordionGroup>
  <Accordion title="What is TinyFish Web Agent?" icon="circle-info">
    TinyFish Web Agent is an AI-powered web automation API that lets you automate any website using natural language.
    Instead of writing brittle selectors, you describe what you want to do, and our AI handles the rest.
  </Accordion>

  <Accordion title="What sites can I automate?" icon="globe">
    Any publicly accessible website. For authenticated sites, include login steps in your goal. For sites with bot
    protection, use stealth mode.
  </Accordion>

  <Accordion title="How fast are automations?" icon="bolt">
    Typically 3-10 seconds for simple pages, 30-60 seconds for complex multi-step automations. Time depends on page load
    speed and task complexity.
  </Accordion>

  <Accordion title="Can I see the browser?" icon="eye">
    Yes! Every run provides a `streaming_url` where you can watch the browser execute live for 24 hours after completion.
  </Accordion>
</AccordionGroup>

## API Usage

<AccordionGroup>
  <Accordion title="What authentication method do I use?" icon="key">
    The REST API uses the `X-API-Key` header:

    ```
    X-API-Key: $TINYFISH_API_KEY
    ```

    The MCP endpoint uses OAuth 2.1 for AI assistant integrations.
  </Accordion>

  <Accordion title="Do you support proxies?" icon="route">
    Yes, configure proxy routing:

    ```typescript theme={null}
    {
      proxy_config: {
        enabled: true,
        country_code: "US"
      }
    }
    ```

    Supported countries: US, GB, CA, DE, FR, JP, AU.
  </Accordion>
</AccordionGroup>

## Technical

<AccordionGroup>
  <Accordion title="What browsers do you use?" icon="browser">
    We use Chromium-based browsers. Choose between:

    * **Lite**: Standard Chromium (fast)
    * **Stealth**: Modified Chromium with anti-detection (slower but bypasses bot protection)
  </Accordion>

  <Accordion title="What about JavaScript-heavy sites?" icon="js">
    We fully support SPAs (React, Vue, Angular). Pages are rendered and JavaScript is executed before extraction.
  </Accordion>

  <Accordion title="Can I automate authenticated content?" icon="lock">
    Yes! The recommended approach is to connect your password manager (1Password or Bitwarden) in **Settings → Vault**. Select credentials per run and TinyFish handles login securely — the AI agent never sees your actual passwords.

    See the [Connect Your Vault](/vault-setup) guide for setup and [Vault Credentials](/key-concepts/credentials) for how it works.

    If you haven't connected a vault, you can still include login steps in your goal:

    ```typescript theme={null}
    goal: `
      1. Login with username "user@example.com" and password "pass123"
      2. Navigate to dashboard
      3. Extract account balance
    `
    ```

    <Warning>Including credentials directly in goals is less secure — they appear in run logs and AI context. Use vault credentials when possible.</Warning>
  </Accordion>

  <Accordion title="Do you support pagination?" icon="arrows-left-right">
    Yes, describe pagination in your goal:

    ```typescript theme={null}
    goal: `Click "Next Page" button 5 times, extracting products from each page`
    ```
  </Accordion>
</AccordionGroup>

## Troubleshooting

<AccordionGroup>
  <Accordion title="What does COMPLETED status mean?" icon="circle-check">
    `status: "COMPLETED"` means the **infrastructure succeeded** - the browser launched, navigated, and the automation finished without crashing.

    **It does NOT mean the goal was achieved.** You must check the `result` field to determine if the goal succeeded.

    **Scenario 1: Goal achieved**

    ```json theme={null}
    {
      "status": "COMPLETED",
      "result": {
        "products": [
          { "name": "iPhone 15", "price": "$799" }
        ]
      },
      "error": null
    }
    ```

    The `result` contains the extracted data - goal succeeded.

    **Scenario 2: Infrastructure succeeded, goal failed**

    ```json theme={null}
    {
      "status": "COMPLETED",
      "result": {
        "status": "failure",
        "reason": "Could not find any products on the page",
        "product_price": null
      },
      "error": null
    }
    ```

    Status is COMPLETED (browser worked), but `result.status` is "failure" indicating the goal wasn't achieved.

    **Scenario 3: Infrastructure failed**

    ```json theme={null}
    {
      "status": "FAILED",
      "result": null,
      "error": {
        "message": "Browser crashed during execution"
      }
    }
    ```

    The automation couldn't complete due to infrastructure issues.

    **Best Practice:** Always validate `result` content, not just `status`:

    ```typescript theme={null}
    if (run.status === "COMPLETED" && run.result) {
      // Check if result indicates goal failure
      if (run.result.status === "failure" || run.result.error) {
        console.log("Goal not achieved:", run.result.reason || run.result.error);
      } else {
        console.log("Data extracted:", run.result);
      }
    } else if (run.status === "FAILED") {
      console.log("Automation failed:", run.error?.message);
    }
    ```
  </Accordion>

  <Accordion title="Why is my automation failing?" icon="bug">
    Common causes:

    1. **Timeout** - Site is slow or down
       * Solution: Retry or use stealth mode
    2. **Access Denied** - Anti-bot protection
       * Solution: Use stealth mode + proxy
    3. **Element Not Found** - Goal is too specific
       * Solution: Make goal more flexible (describe visually)
    4. **Invalid URL** - URL is malformed
       * Solution: Ensure URL includes `https://`
  </Accordion>

  <Accordion title="Site is blocking me. What do I do?" icon="shield">
    ```typescript theme={null}
    // Use stealth mode
    browser_profile: "stealth"

    // Add proxy
    proxy_config: {
      enabled: true,
      country_code: "US"
    }

    // Reduce speed (add delays in goal)
    goal: "Wait 3 seconds, then click button"
    ```
  </Accordion>
</AccordionGroup>

## Best Practices

<AccordionGroup>
  <Accordion title="What makes a good goal?" icon="bullseye">
    **Good** (specific, actionable):

    ```typescript theme={null}
    goal: "Extract product name, price, and stock status from the product details section"
    ```

    **Bad** (vague):

    ```typescript theme={null}
    goal: "Get data"
    ```
  </Accordion>

  <Accordion title="When should I use stealth mode?" icon="user-secret">
    Use stealth when:

    * Site shows CAPTCHA
    * Getting "Access Denied" errors
    * Site uses Cloudflare or anti-bot protection

    Otherwise use lite mode (faster).
  </Accordion>
</AccordionGroup>

## Getting Help

<CardGroup>
  <Card title="Email Support" icon="envelope" href="mailto:support@tinyfish.io">
    [support@tinyfish.io](mailto:support@tinyfish.io)
  </Card>

  <Card title="Discord Community" icon="discord" href="https://discord.gg/tinyfish">
    Join our community
  </Card>
</CardGroup>

## Related

<CardGroup>
  <Card title="Quick Start" icon="rocket" href="/quick-start">
    Get started in 5 minutes
  </Card>

  <Card title="API Reference" icon="code" href="/api-reference">
    Complete endpoint docs
  </Card>
</CardGroup>


# Fetch Examples
Source: https://docs.tinyfish.ai/fetch-api/examples

Real-world examples for the Fetch API

## Fetch a Single Page

Extract content from any URL as clean Markdown:

<CodeGroup>
  ```python Python theme={null}
  from tinyfish import TinyFish

  client = TinyFish()
  result = client.fetch.get_contents(
      urls=["https://example.com"],
      format="markdown",
  )

  page = result.results[0]
  print(f"Title: {page.title}")
  print(page.text)
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish } from "@tiny-fish/sdk";

  const client = new TinyFish();
  const result = await client.fetch.getContents({
    urls: ["https://example.com"],
    format: "markdown",
  });

  const page = result.results[0];
  console.log(`Title: ${page.title}`);
  console.log(page.text);
  ```

  ```bash cURL theme={null}
  curl -s -X POST https://api.fetch.tinyfish.ai \
    -H "X-API-Key: $TINYFISH_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"urls": ["https://example.com"], "format": "markdown"}'
  ```
</CodeGroup>

**Output:**

```json theme={null}
{
  "results": [
    {
      "url": "https://example.com",
      "final_url": "https://example.com/",
      "language": "en",
      "text": "This domain is for use in documentation examples without needing permission...",
      "format": "markdown"
    }
  ],
  "errors": []
}
```

## Batch Fetch

Fetch up to 10 URLs in a single request. Failed URLs appear in `errors[]` without affecting the rest:

<CodeGroup>
  ```python Python theme={null}
  from tinyfish import TinyFish

  client = TinyFish()
  result = client.fetch.get_contents(
      urls=[
          "https://example.com",
          "https://httpbin.org/html",
          "https://nonexistent.invalid",
      ],
      format="markdown",
  )

  for page in result.results:
      print(f"OK: {page.url} → {page.text[:80]}")

  for err in result.errors:
      print(f"FAIL: {err.url} → {err.error}")
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish } from "@tiny-fish/sdk";

  const client = new TinyFish();
  const result = await client.fetch.getContents({
    urls: [
      "https://example.com",
      "https://httpbin.org/html",
      "https://nonexistent.invalid",
    ],
    format: "markdown",
  });

  for (const page of result.results) {
    console.log(`OK: ${page.url} → ${page.text.slice(0, 80)}`);
  }

  for (const err of result.errors) {
    console.log(`FAIL: ${err.url} → ${err.error}`);
  }
  ```

  ```bash cURL theme={null}
  curl -s -X POST https://api.fetch.tinyfish.ai \
    -H "X-API-Key: $TINYFISH_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "urls": [
        "https://example.com",
        "https://httpbin.org/html",
        "https://nonexistent.invalid"
      ],
      "format": "markdown"
    }'
  ```
</CodeGroup>

## Extract Links

Get all hyperlinks and image URLs from a page:

<CodeGroup>
  ```python Python theme={null}
  from tinyfish import TinyFish

  client = TinyFish()
  result = client.fetch.get_contents(
      urls=["https://www.tinyfish.ai/"],
      format="markdown",
      links=True,
      image_links=True,
  )

  page = result.results[0]
  print(f"Found {len(page.links)} links and {len(page.image_links)} images")

  for link in page.links[:5]:
      print(f"  → {link}")
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish } from "@tiny-fish/sdk";

  const client = new TinyFish();
  const result = await client.fetch.getContents({
    urls: ["https://www.tinyfish.ai/"],
    format: "markdown",
    links: true,
    image_links: true,
  });

  const page = result.results[0];
  console.log(`Found ${page.links.length} links and ${page.image_links.length} images`);

  for (const link of page.links.slice(0, 5)) {
    console.log(`  → ${link}`);
  }
  ```

  ```bash cURL theme={null}
  curl -s -X POST https://api.fetch.tinyfish.ai \
    -H "X-API-Key: $TINYFISH_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "urls": ["https://www.tinyfish.ai/"],
      "format": "markdown",
      "links": true,
      "image_links": true
    }'
  ```
</CodeGroup>

## Fetch as HTML

Get semantic HTML instead of Markdown — useful for preserving structure:

<CodeGroup>
  ```python Python theme={null}
  from tinyfish import TinyFish

  client = TinyFish()
  result = client.fetch.get_contents(
      urls=["https://httpbin.org/html"],
      format="html",
  )

  page = result.results[0]
  print(page.text[:300])
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish } from "@tiny-fish/sdk";

  const client = new TinyFish();
  const result = await client.fetch.getContents({
    urls: ["https://httpbin.org/html"],
    format: "html",
  });

  const page = result.results[0];
  console.log(page.text.slice(0, 300));
  ```

  ```bash cURL theme={null}
  curl -s -X POST https://api.fetch.tinyfish.ai \
    -H "X-API-Key: $TINYFISH_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"urls": ["https://httpbin.org/html"], "format": "html"}'
  ```
</CodeGroup>

***

## Related

<CardGroup>
  <Card title="Fetch Reference" icon="bolt" href="/fetch-api/reference">
    Full parameter, response, and content type docs
  </Card>

  <Card title="Search Examples" icon="magnifying-glass" href="/search-api/examples">
    Web search with geo-targeting
  </Card>
</CardGroup>


# Fetch API
Source: https://docs.tinyfish.ai/fetch-api/index

Render any URL and extract clean text — no external APIs required

<Note>
  Fetch does not use credits.
</Note>

The TinyFish Fetch API renders web pages using a real browser (including JavaScript-heavy sites) and returns clean extracted text in your preferred format. Submit a URL, get back structured content.

```bash theme={null}
POST https://api.fetch.tinyfish.ai
```

`api.fetch.tinyfish.ai` is the public Fetch API endpoint.

## Before You Start

<Steps>
  <Step title="Get your API key">
    Visit [agent.tinyfish.ai/api-keys](https://agent.tinyfish.ai/api-keys) and create a key. Store it in your environment:

    ```bash theme={null}
    export TINYFISH_API_KEY="your_api_key_here"
    ```
  </Step>
</Steps>

All requests require the `X-API-Key` header. See [Authentication](/authentication) for the full setup and troubleshooting guide.

## Your First Request

<CodeGroup>
  ```python Python theme={null}
  from tinyfish import TinyFish

  client = TinyFish()
  result = client.fetch.get_contents(urls=["https://www.tinyfish.ai/"])
  print(result.results[0].title)
  print(result.results[0].text)
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish } from "@tiny-fish/sdk";

  const client = new TinyFish();
  const result = await client.fetch.getContents({
    urls: ["https://www.tinyfish.ai/"],
  });
  console.log(result.results[0].title);
  console.log(result.results[0].text);
  ```

  ```bash cURL theme={null}
  curl -X POST https://api.fetch.tinyfish.ai \
    -H "X-API-Key: $TINYFISH_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"urls": ["https://www.tinyfish.ai/"]}'
  ```
</CodeGroup>

## What Success Looks Like

```json theme={null}
{
  "results": [
    {
      "url": "https://www.tinyfish.ai/",
      "final_url": "https://www.tinyfish.ai/",
      "title": "TinyFish | Enterprise Web Agent Infrastructure",
      "description": "TinyFish provides enterprise infrastructure for AI web agents.",
      "language": "en",
      "text": "# TinyFish | Enterprise Web Agent Infrastructure\n\nTinyFish provides enterprise infrastructure for AI web agents...\n"
    }
  ],
  "errors": []
}
```

## When to Use Fetch vs the Other APIs

* Use **Fetch** when you already know the URL and need clean extracted page content.
* Use **Search** when you need help finding the right URLs first.
* Use **Agent** when TinyFish should perform a multi-step workflow on the site.
* Use **Browser** when you need direct browser control from your own code.

***

## Fetching Multiple URLs

Submit up to 10 URLs in a single request. Each URL is processed independently — one failure doesn't affect the others.

<CodeGroup>
  ```python Python theme={null}
  from tinyfish import TinyFish

  client = TinyFish()
  result = client.fetch.get_contents(
      urls=[
          "https://www.tinyfish.ai/",
          "https://en.wikipedia.org/wiki/Web_scraping",
          "https://docs.python.org/3/tutorial/index.html",
      ]
  )

  for page in result.results:
      print(page.url, "→", page.title)

  for error in result.errors:
      print("Failed:", error.url, "–", error.error)
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish } from "@tiny-fish/sdk";

  const client = new TinyFish();
  const result = await client.fetch.getContents({
    urls: [
      "https://www.tinyfish.ai/",
      "https://en.wikipedia.org/wiki/Web_scraping",
      "https://docs.python.org/3/tutorial/index.html",
    ],
  });

  result.results.forEach((r) => console.log(r.url, "→", r.title));
  result.errors.forEach((e) => console.log("Failed:", e.url, "–", e.error));
  ```

  ```bash cURL theme={null}
  curl -X POST https://api.fetch.tinyfish.ai \
    -H "X-API-Key: $TINYFISH_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "urls": [
        "https://www.tinyfish.ai/",
        "https://en.wikipedia.org/wiki/Web_scraping",
        "https://docs.python.org/3/tutorial/index.html"
      ]
    }'
  ```
</CodeGroup>

<Note>
  Per-URL failures (timeouts, DNS errors, anti-bot blocks) appear in `errors[]` alongside a `200` response — they do not cause the entire request to fail.
</Note>

***

## Output Formats

Control the format of the `text` field with the `format` parameter. When omitted, the default is `markdown`.

<Tabs>
  <Tab title="html">
    Semantic HTML.

    ```json theme={null}
    {
      "format": "html",
      "text": "<h1>Async Fn in Traits Are Now Available</h1>
    <p>Starting with Rust 1.75, you can use <code>async fn</code> directly inside traits.</p>
    <h2>What Changed</h2>
    <ul>
    <li>Works in all stable traits</li>
    <li>No heap allocation for simple cases</li>
    </ul>"
    }
    ```
  </Tab>

  <Tab title="markdown">
    Clean Markdown. Ideal for LLM consumption and readable storage.

    ```json theme={null}
    {
      "format": "markdown",
      "text": "# Async Fn in Traits Are Now Available

    Starting with Rust 1.75, you can use `async fn` directly inside traits.

    ## What Changed

    Previously, writing async functions in traits required the `async-trait` crate...

    - Works in all stable traits
    - No heap allocation for simple cases
    - Compatible with `Send` bounds"
    }
    ```
  </Tab>

  <Tab title="json">
    Structured document tree. Useful for programmatic content processing.

    ```json theme={null}
    {
      "format": "json",
      "text": {
        "type": "document",
        "children": [
          { "type": "heading", "level": 1, "text": "Async Fn in Traits Are Now Available" },
          { "type": "paragraph", "text": "Starting with Rust 1.75, you can use async fn directly inside traits." },
          { "type": "heading", "level": 2, "text": "What Changed" },
          { "type": "list", "ordered": false, "items": ["Works in all stable traits", "No heap allocation for simple cases"] }
        ]
      }
    }
    ```
  </Tab>
</Tabs>

***

## Proxies

To route fetch requests through a specific country, pass a `proxy_config` object with a `country_code`.

```json theme={null}
{
  "urls": ["https://example.com"],
  "proxy_config": {
    "country_code": "US"
  }
}
```

This is useful for accessing geo-restricted content or testing region-specific page variations. See [Proxies](/key-concepts/proxies) for supported country codes and details.

***

## Supported Content Types

The Fetch API handles more than just HTML. See the [full content types table](/fetch-api/reference#supported-content-types) in the reference — highlights: PDF text extraction works, JSON endpoints return raw JSON, but binary files (images, video) return an error.

***

## Read Next

<CardGroup>
  <Card title="API Reference" icon="code" href="/fetch-api/reference">
    Full request and response schema
  </Card>

  <Card title="Authentication" icon="key" href="/authentication">
    API key setup
  </Card>

  <Card title="Proxies" icon="globe" href="/key-concepts/proxies">
    Route requests through specific countries
  </Card>

  <Card title="For coding agents" icon="robot" href="/for-coding-agents">
    One page that routes an agent to the right TinyFish API
  </Card>
</CardGroup>


# Fetch API Reference
Source: https://docs.tinyfish.ai/fetch-api/reference

Complete reference for the Fetch API endpoint

## Endpoint

```
POST https://api.fetch.tinyfish.ai
```

All requests require an `X-API-Key` header. See [Authentication](/authentication).

***

## Request

```json theme={null}
{
  "urls": ["https://example.com"],
  "format": "html",
  "links": false,
  "image_links": false
}
```

### Parameters

<ParamField type="string[]">
  URLs to fetch and extract. Maximum 10 URLs per request.

  All URLs must use `http` or `https`. Private IP addresses, localhost, and cloud metadata endpoints are rejected.
</ParamField>

<ParamField type="string">
  Output format for the `text` field in each result. One of:

  * `html` — semantic HTML
  * `markdown` — clean Markdown, recommended for LLMs (default)
  * `json` — structured document tree
</ParamField>

<ParamField type="boolean">
  When `true`, include all `<a href>` URLs found on the page in the `links` field.
</ParamField>

<ParamField type="boolean">
  When `true`, include all `<img src>` URLs found on the page in the `image_links` field.
</ParamField>

***

## Response

```json theme={null}
{
  "results": [...],
  "errors": [...]
}
```

### `results[]`

One entry per successfully fetched URL.

<ResponseField name="url" type="string">
  The original requested URL.
</ResponseField>

<ResponseField name="final_url" type="string">
  The URL after any redirects. May differ from `url`.
</ResponseField>

<ResponseField name="title" type="string | null">
  Page title, preferring `og:title` over `<title>`. `null` if not found.
</ResponseField>

<ResponseField name="description" type="string | null">
  Meta description, preferring `og:description` over `<meta name="description">`. `null` if not found.
</ResponseField>

<ResponseField name="language" type="string | null">
  Detected page language (e.g. `"en"`). `null` if undetectable.
</ResponseField>

<ResponseField name="author" type="string | null">
  Author from meta tags. `null` if not found.
</ResponseField>

<ResponseField name="published_date" type="string | null">
  Publication date, if detectable. `null` if not found.
</ResponseField>

<ResponseField name="text" type="string | object">
  Extracted page content. Format depends on the `format` request parameter:

  * `string` when `format` is `"html"` or `"markdown"`
  * `object` (document tree) when `format` is `"json"`
</ResponseField>

<ResponseField name="links" type="string[]">
  All `<a href>` URLs on the page, resolved to absolute URLs. Only present when `links: true` was requested.
</ResponseField>

<ResponseField name="image_links" type="string[]">
  All `<img src>` URLs on the page, resolved to absolute URLs. Only present when `image_links: true` was requested.
</ResponseField>

<ResponseField name="latency_ms" type="number | null">
  Time to fetch and extract this URL, in milliseconds. `null` if unavailable.
</ResponseField>

<ResponseField name="format" type="string">
  Output format used for the `text` field. Echoes the request `format` parameter (`"markdown"`, `"html"`, or `"json"`).
</ResponseField>

<Note>
  Fields that could not be extracted (`title`, `description`, `language`, `author`, `published_date`) are omitted from the response when `null` rather than returned explicitly as `null`.
</Note>

### `errors[]`

One entry per URL that could not be fetched. Always present, may be empty. Per-URL failures do not affect the rest of the batch.

<ResponseField name="url" type="string">
  The URL that failed.
</ResponseField>

<ResponseField name="error" type="string">
  Structured error code identifying the failure type. One of: `target_http_error`, `page_not_found`, `target_unreachable`, `timeout`, `bot_blocked`, `empty_content`, `invalid_url`, `invalid_redirect_url`, `proxy_error`.
</ResponseField>

<ResponseField name="status" type="number (optional)">
  Upstream HTTP status code. Present when `error` is `target_http_error` or `page_not_found`.
</ResponseField>

## SDK Methods

<CodeGroup>
  ```python Python theme={null}
  from tinyfish import TinyFish

  client = TinyFish()
  result = client.fetch.get_contents(
      urls=["https://www.tinyfish.ai/"],
      format="markdown",
  )
  for page in result.results:
      print(page.title, "→", page.text[:100])
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish } from "@tiny-fish/sdk";

  const client = new TinyFish();
  const result = await client.fetch.getContents({
    urls: ["https://www.tinyfish.ai/"],
    format: "markdown",
  });
  result.results.forEach((page) => console.log(page.title, "→", page.text.slice(0, 100)));
  ```
</CodeGroup>

***

## Error Codes

HTTP-level errors apply to the entire request.

| Status | Meaning                                                                          |
| ------ | -------------------------------------------------------------------------------- |
| `400`  | Invalid request — missing `urls`, too many URLs (max 10), or bad parameter value |
| `401`  | Missing or invalid API key                                                       |
| `429`  | Rate limit exceeded                                                              |
| `500`  | Internal server error                                                            |

Per-URL errors appear in `errors[]` alongside a `200` response. The `error` field is one of these codes:

| Error code             | `status` field                       | Meaning                                                                 |
| ---------------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| `target_http_error`    | HTTP status code (e.g. `403`, `500`) | Target server returned a non-2xx HTTP response other than 404/410       |
| `page_not_found`       | `404` or `410`                       | Target URL does not exist (HTTP 404 Not Found or 410 Gone)              |
| `target_unreachable`   | —                                    | Connection refused, TLS failure, DNS failure, or other network error    |
| `timeout`              | —                                    | Page did not finish loading within the request deadline                 |
| `bot_blocked`          | —                                    | Site returned a bot-protection challenge (Cloudflare, Incapsula)        |
| `empty_content`        | —                                    | Browser returned HTML but no extractable text found                     |
| `invalid_url`          | —                                    | URL rejected before fetch (private IP, invalid scheme, disallowed host) |
| `invalid_redirect_url` | —                                    | Redirect target rejected before fetch (private IP or disallowed host)   |
| `proxy_error`          | —                                    | Proxy tunnel failed — site may be reachable directly                    |

<Note>
  Per-URL fetch failures are **not** HTTP errors. They appear as entries in `errors[]` alongside a `200` response.
</Note>

<Note>
  Each URL has a **110-second backend timeout**. If the page doesn't respond within 110 seconds, that URL returns a `timeout` error in `errors[]` while the rest of the batch continues. Requests are also subject to a **120-second CDN ceiling** for the full batch. Set your client-side timeout to at least **150 seconds** to receive CDN timeout errors cleanly.
</Note>

***

## Supported Content Types

| Content Type      | Behavior                                                           |
| ----------------- | ------------------------------------------------------------------ |
| HTML              | Full text extraction with formatting                               |
| PDF               | Text content extracted                                             |
| JSON              | Raw JSON returned as text                                          |
| Plain text        | Full text returned                                                 |
| Images (PNG, JPG) | Not supported — returns an error indicating no extractable content |

***

## Usage Endpoint

Retrieve a paginated history of your fetch operations.

```
GET https://api.fetch.tinyfish.ai/usage
```

All requests require an `X-API-Key` header. See [Authentication](/authentication).

### Query Parameters

<ParamField type="string (ISO 8601)">
  Filter results created after this timestamp. Example: `2026-01-01T00:00:00Z`
</ParamField>

<ParamField type="string (ISO 8601)">
  Filter results created before this timestamp. Example: `2026-02-01T00:00:00Z`
</ParamField>

<ParamField type="string">
  Filter by result status. One of: `completed`, `failed`.
</ParamField>

<ParamField type="integer">
  Maximum number of items per page. Range: 1-1000.
</ParamField>

<ParamField type="integer">
  Page number for pagination.
</ParamField>

### Response

```json theme={null}
{
  "items": [...],
  "total": 42,
  "limit": 100,
  "page": 1,
  "total_pages": 1,
  "has_more": false
}
```

### `items[]`

<ResponseField name="id" type="string">
  Unique identifier for the fetch result.
</ResponseField>

<ResponseField name="url" type="string">
  The original requested URL.
</ResponseField>

<ResponseField name="final_url" type="string">
  The URL after any redirects.
</ResponseField>

<ResponseField name="title" type="string | null">
  Page title, if detected.
</ResponseField>

<ResponseField name="description" type="string | null">
  Meta description, if detected.
</ResponseField>

<ResponseField name="language" type="string | null">
  Detected page language (e.g. `"en"`).
</ResponseField>

<ResponseField name="author" type="string | null">
  Page author, if detected.
</ResponseField>

<ResponseField name="published_date" type="string | null">
  Published date, if detected.
</ResponseField>

<ResponseField name="format" type="string">
  The format used for extraction: `markdown`, `html`, or `json`.
</ResponseField>

<ResponseField name="status" type="string">
  Result status: `completed` or `failed`.
</ResponseField>

<ResponseField name="request_origin" type="string">
  Where the request originated: `api`, `cli`, `python-sdk`, `js-sdk`, `mcp`, etc.
</ResponseField>

<ResponseField name="request_id" type="string | null">
  The request ID that grouped this URL with others in a batch.
</ResponseField>

<ResponseField name="text_length" type="integer | null">
  Length of the extracted text content in characters. The full text is not included in usage responses.
</ResponseField>

<ResponseField name="links_count" type="integer">
  Number of links found on the page.
</ResponseField>

<ResponseField name="image_links_count" type="integer">
  Number of image links found on the page.
</ResponseField>

<ResponseField name="latency_ms" type="number | null">
  Time taken to fetch and extract the page, in milliseconds.
</ResponseField>

<ResponseField name="created_at" type="string (ISO 8601)">
  Timestamp when the fetch was executed.
</ResponseField>

<ResponseField name="error" type="string | null">
  Error message if the fetch failed. `null` for successful fetches.
</ResponseField>

### Error Codes

| Status | Meaning                                          |
| ------ | ------------------------------------------------ |
| `400`  | Invalid query parameters                         |
| `401`  | Missing or invalid API key                       |
| `403`  | Fetch API access is not enabled for this account |
| `500`  | Internal server error                            |

***

## Rate Limits

Limits apply per API key, measured in URLs per minute across all requests.

| Plan          | URLs / minute |
| ------------- | ------------- |
| Free          | 150           |
| Pay As You Go | 150           |
| Starter       | 300           |
| Pro           | 600           |

When the limit is exceeded, the API returns `HTTP 429`.

***

## Billing

Fetch does not use credits.

***

## Related

<CardGroup>
  <Card title="Fetch Overview" icon="bolt" href="/fetch-api">
    First request, response shape, and product routing
  </Card>

  <Card title="Authentication" icon="key" href="/authentication">
    API key setup and troubleshooting
  </Card>

  <Card title="Error Codes" icon="triangle-exclamation" href="/error-codes">
    Full list of API error codes
  </Card>
</CardGroup>


# For Coding Agents
Source: https://docs.tinyfish.ai/for-coding-agents

Single-page TinyFish context for Claude, Codex, Cursor, and other coding agents

This page is the shortest high-signal context dump for coding agents integrating TinyFish. **Always use the official SDKs** — they handle authentication, SSE streaming, retries, and typed responses so you don't have to.

<Note>
  For complete API reference in a single file, use [llms-full.txt](https://docs.tinyfish.ai/llms-full.txt) (218KB, includes all code examples). Note that `llms.txt` is just an index — agents should use `llms-full.txt` for full context.
</Note>

## MCP Server (Recommended for AI Assistants)

If you're running inside an MCP-compatible host (Claude Code, Claude Desktop, Cursor, Windsurf), connect via MCP instead of the REST API — no API key management needed, OAuth handles auth automatically.

```bash theme={null}
npx -y install-mcp@latest https://agent.tinyfish.ai/mcp --client claude-code
```

See the [MCP Integration guide](/mcp-integration) for all supported clients and available tools.

## Install the SDK

<CodeGroup>
  ```bash Python theme={null}
  pip install tinyfish
  ```

  ```bash TypeScript theme={null}
  npm install @tiny-fish/sdk
  ```
</CodeGroup>

| API              | Typical Latency    | Suggested Timeout |
| ---------------- | ------------------ | ----------------- |
| Agent (sync)     | 15-60s             | 120s              |
| Agent (SSE)      | 15-60s (streaming) | N/A (SSE)         |
| Search           | 1-3s               | 10s               |
| Fetch            | 1-20s              | 150s              |
| Browser (create) | 10-30s             | 60s               |

*Fetch: backend timeout is 110s per URL; requests are also subject to a 120s CDN ceiling. Set client timeout to 150s to receive timeout errors cleanly.*

## Authentication

Set your API key (get one from [agent.tinyfish.ai/api-keys](https://agent.tinyfish.ai/api-keys)):

```bash theme={null}
export TINYFISH_API_KEY="your_api_key_here"
```

Both SDKs read `TINYFISH_API_KEY` from the environment automatically. See [Authentication](/authentication) for more details.

## Choose the Right TinyFish API

| API     | Use it when                                                         | Docs                                    |
| ------- | ------------------------------------------------------------------- | --------------------------------------- |
| Agent   | You want TinyFish to execute a goal on a real website               | [Agent reference](/agent-api/reference) |
| Search  | You want ranked web results for a query                             | [Search overview](/search-api)          |
| Fetch   | You want extracted page content from one or more URLs               | [Fetch overview](/fetch-api)            |
| Browser | You want a remote browser session for direct Playwright/CDP control | [Browser overview](/browser-api)        |

### Quick Decision Tree

* **Need data from a URL?** -- Agent API (goal-based extraction) or Fetch API (raw page content)
* **Need search results?** -- Search API
* **Need browser control?** -- Browser API (direct Playwright/CDP access)

## SDK Examples

### Agent — Streaming (Recommended)

<CodeGroup>
  ```python Python theme={null}
  from tinyfish import TinyFish, CompleteEvent

  client = TinyFish()

  with client.agent.stream(
      url="https://scrapeme.live/shop",
      goal="Extract the first 2 product names and prices. Return as JSON.",
  ) as stream:
      for event in stream:
          if isinstance(event, CompleteEvent):
              print(event.result_json)
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish } from "@tiny-fish/sdk";

  const client = new TinyFish();

  const stream = await client.agent.stream({
    url: "https://scrapeme.live/shop",
    goal: "Extract the first 2 product names and prices. Return as JSON.",
  });

  for await (const event of stream) {
    if (event.type === "COMPLETE") {
      console.log(event.result);
    }
  }
  ```
</CodeGroup>

### Agent — Synchronous

<CodeGroup>
  ```python Python theme={null}
  from tinyfish import TinyFish, RunStatus

  client = TinyFish()

  result = client.agent.run(
      url="https://scrapeme.live/shop",
      goal="Extract the first 2 product names and prices. Return as JSON.",
  )
  if result.status == RunStatus.COMPLETED:
      print(result.result)
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish, RunStatus } from "@tiny-fish/sdk";

  const client = new TinyFish();

  const run = await client.agent.run({
    url: "https://scrapeme.live/shop",
    goal: "Extract the first 2 product names and prices. Return as JSON.",
  });

  if (run.status === RunStatus.COMPLETED) {
    console.log(run.result);
  }
  ```
</CodeGroup>

### Search

<CodeGroup>
  ```python Python theme={null}
  result = client.search.query("web automation tools", location="US", language="en")
  print(result)
  ```

  ```typescript TypeScript theme={null}
  const result = await client.search.query({
    query: "web automation tools",
    location: "US",
    language: "en",
  });
  console.log(result);
  ```
</CodeGroup>

### Fetch

<CodeGroup>
  ```python Python theme={null}
  result = client.fetch.get_contents(urls=["https://www.tinyfish.ai/"])
  print(result)
  ```

  ```typescript TypeScript theme={null}
  const result = await client.fetch.getContents({
    urls: ["https://www.tinyfish.ai/"],
  });
  console.log(result);
  ```
</CodeGroup>

### Anti-Detection Mode

For sites with bot protection, add stealth mode and a proxy:

<CodeGroup>
  ```python Python theme={null}
  from tinyfish import TinyFish, BrowserProfile, ProxyConfig, ProxyCountryCode

  client = TinyFish()

  result = client.agent.run(
      url="https://protected-site.com",
      goal="Extract pricing data. Return as JSON.",
      browser_profile=BrowserProfile.STEALTH,
      proxy_config=ProxyConfig(enabled=True, country_code=ProxyCountryCode.US),
  )
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish, BrowserProfile, ProxyCountryCode } from "@tiny-fish/sdk";

  const client = new TinyFish();

  const run = await client.agent.run({
    url: "https://protected-site.com",
    goal: "Extract pricing data. Return as JSON.",
    browser_profile: BrowserProfile.STEALTH,
    proxy_config: {
      enabled: true,
      country_code: ProxyCountryCode.US,
    },
  });
  ```
</CodeGroup>

## Expected Latency

| API              | Typical Latency    | Suggested Timeout |
| ---------------- | ------------------ | ----------------- |
| Agent (sync)     | 15-60s             | 120s              |
| Agent (SSE)      | 15-60s (streaming) | N/A (SSE)         |
| Search           | 1-3s               | 10s               |
| Fetch            | up to 30s per URL  | 120s              |
| Browser (create) | 10-30s             | 60s               |

## Prompting

Goal quality determines success rate. Vague goals like "get the data" fail; crafted goals with explicit fields, output format, and edge-case handling succeed consistently.

<Tip>
  See the full [Prompting Guide](/prompting-guide) for tested patterns, templates, and examples.
</Tip>

## Common Gotchas

1. **Browser API session creation takes 10-30s** -- set `timeout=60` on your HTTP client.
2. **TypeScript needs `"type": "module"`** in `package.json` for top-level `await`, or wrap code in `async function main() { ... }; main()`.
3. **`COMPLETED` status does not mean the goal succeeded** -- always check `result_json` for failure signals like "captcha", "blocked", or "access denied".
4. **Fetch API has a 110s per-URL backend timeout** — requests are also subject to a 120s CDN ceiling for the full batch. Set your client timeout to at least 150s.

<Accordion title="Raw API Endpoints (cURL)">
  If you can't use the SDKs, here are the raw endpoints. All use the `X-API-Key` header for authentication.

  ### Agent

  ```bash theme={null}
  curl -N -X POST https://agent.tinyfish.ai/v1/automation/run-sse \
    -H "X-API-Key: $TINYFISH_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "url": "https://scrapeme.live/shop",
      "goal": "Extract the first 2 product names and prices. Return JSON."
    }'
  ```

  ### Search

  ```bash theme={null}
  curl "https://api.search.tinyfish.ai?query=web+automation+tools&location=US&language=en" \
    -H "X-API-Key: $TINYFISH_API_KEY"
  ```

  ### Fetch

  ```bash theme={null}
  curl -X POST https://api.fetch.tinyfish.ai \
    -H "X-API-Key: $TINYFISH_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"urls": ["https://www.tinyfish.ai/"]}'
  ```

  ### Browser

  ```bash theme={null}
  curl -X POST https://api.browser.tinyfish.ai \
    -H "X-API-Key: $TINYFISH_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"url": "https://www.tinyfish.ai"}'
  ```
</Accordion>

## What to Read Next

<CardGroup>
  <Card title="Agent reference" icon="sparkles" href="/agent-api/reference">
    Goal-based automation, endpoint choice, runs, profiles, and proxies
  </Card>

  <Card title="Authentication" icon="key" href="/authentication">
    API key setup and troubleshooting
  </Card>

  <Card title="Search overview" icon="magnifying-glass" href="/search-api">
    Search query parameters and result shape
  </Card>

  <Card title="Fetch overview" icon="bolt" href="/fetch-api">
    Fetch multiple URLs and choose output formats
  </Card>

  <Card title="Browser overview" icon="browser" href="/browser-api">
    Create a remote browser session and connect via CDP
  </Card>

  <Card title="Examples" icon="code" href="/examples/scraping">
    Copy-paste examples for common workflows
  </Card>

  <Card title="llms-full.txt" icon="file-lines" href="https://docs.tinyfish.ai/llms-full.txt">
    Complete API reference in a single file (218KB)
  </Card>
</CardGroup>


# TinyFish Developer Documentation
Source: https://docs.tinyfish.ai/index

Choose the right TinyFish API, authenticate quickly, and start integrating faster

TinyFish gives you four public API surfaces: Agent, Search, Fetch, and Browser. This docs site is organized to help you pick the right one quickly, authenticate once, and move straight to the examples or reference you need.

Free Search and Fetch. Credits are used only by Agent and Browser.

## Start Here

<CardGroup>
  <Card title="Quick Start" icon="rocket" href="/quick-start">
    Run your first integration in minutes
  </Card>

  <Card title="Authentication" icon="key" href="/authentication">
    Set up API keys and MCP auth
  </Card>

  <Card title="For Coding Agents" icon="robot" href="/for-coding-agents">
    Single-page context for Claude, Codex, and Cursor
  </Card>

  <Card title="Error Codes" icon="triangle-exclamation" href="/error-codes">
    Debug auth, rate limits, and run failures
  </Card>
</CardGroup>

## Choose the Right API

<CardGroup>
  <Card title="Agent API" icon="sparkles" href="/agent-api">
    Use natural-language goals to automate workflows on real sites
  </Card>

  <Card title="Search API" icon="magnifying-glass" href="/search-api">
    Get structured ranked web results for a query
  </Card>

  <Card title="Fetch API" icon="bolt" href="/fetch-api">
    Render URLs in a real browser and extract clean page content
  </Card>

  <Card title="Browser API" icon="browser" href="/browser-api">
    Create a remote browser session for direct Playwright/CDP control
  </Card>
</CardGroup>

## Canonical Endpoints

| Product | Canonical endpoint                            |
| ------- | --------------------------------------------- |
| Agent   | `https://agent.tinyfish.ai/v1/automation/...` |
| Search  | `GET https://api.search.tinyfish.ai`          |
| Fetch   | `POST https://api.fetch.tinyfish.ai`          |
| Browser | `POST https://api.browser.tinyfish.ai`        |

## Learn the Basics

<CardGroup>
  <Card title="Agent Endpoints" icon="plug" href="/key-concepts/endpoints">
    Pick `/run`, `/run-async`, or `/run-sse`
  </Card>

  <Card title="Runs" icon="play" href="/key-concepts/runs">
    Understand lifecycle, polling, and statuses
  </Card>

  <Card title="Goals" icon="bullseye" href="/key-concepts/goals">
    Write instructions that produce reliable results
  </Card>

  <Card title="Browser Profiles" icon="shield" href="/key-concepts/browser-profiles">
    Choose lite vs stealth
  </Card>

  <Card title="Proxies" icon="globe" href="/key-concepts/proxies">
    Route runs through supported countries
  </Card>

  <Card title="MCP Integration" icon="robot" href="/mcp-integration">
    Connect TinyFish to Claude and other assistants
  </Card>
</CardGroup>


# Dify
Source: https://docs.tinyfish.ai/integrations/dify

Use TinyFish Web Agent as a tool in Dify AI workflows and agents

## Overview

The TinyFish Web Agent plugin for [Dify](https://dify.ai) lets you add AI-powered web automation to any Dify workflow or agent. Navigate websites, extract structured data, fill forms, and complete multi-step browser tasks — all using natural language.

## Setup

<Steps>
  <Step title="Install the plugin">
    On the Dify platform, go to the [Plugin Marketplace](https://docs.dify.ai/plugins/quick-start/install-plugins#marketplace) and install the **TinyFish Web Agent** tool.
  </Step>

  <Step title="Get your API key">
    Visit the [TinyFish Dashboard](https://agent.tinyfish.ai/api-keys) and generate an API key.
  </Step>

  <Step title="Authorize the plugin">
    In Dify, go to **Plugins > TinyFish Web Agent > To Authorize** and enter your API key.
  </Step>
</Steps>

## Available Tools

| Tool                       | Description                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Run Synchronously**      | Execute browser automation and wait for the result in a single response.                              |
| **Run Asynchronously**     | Start browser automation and return a `run_id` immediately. Use with **Get Run** to poll for results. |
| **Run with SSE Streaming** | Execute browser automation with real-time progress updates via Server-Sent Events.                    |
| **List Runs**              | List previous automation runs, with optional status filtering and pagination.                         |
| **Get Run**                | Get detailed information about a specific automation run by its ID.                                   |

## Using in Workflows

1. Add TinyFish Web Agent's **Run Asynchronously** tool to your pipeline.
2. Configure input variables (URL and goal) in the tool's UI.
3. Run the pipeline to extract data from any web page.

## Using with Agents

1. Add all TinyFish Web Agent tools to your Agent app.
2. Prompt the Agent to perform web automations using natural language. The Agent will choose the appropriate tool automatically.

**Example prompts:**

* `"Extract the blog post titles and authors from https://example.com/blog"`
* `"Go to https://example.com/pricing and extract all plan names and prices"`
* `"List my recent automation runs that have completed"`

## API Tool Config (Manual Setup)

If you need to configure TinyFish as a custom API tool in Dify instead of using the plugin, use this endpoint and auth pattern:

```json theme={null}
{
  "url": "https://agent.tinyfish.ai/v1/automation/run",
  "method": "POST",
  "headers": {
    "X-API-Key": "<your_tinyfish_api_key>"
  },
  "body": {
    "url": "{url}",
    "goal": "{goal}"
  }
}
```

In Dify's custom tool configuration, set the authentication type to **API Key** with the header name `X-API-Key`.

## Resources

* [Dify Plugin Marketplace](https://docs.dify.ai/plugins/quick-start/install-plugins#marketplace)
* [TinyFish Web Agent API Docs](/quick-start)
* [GitHub: tinyfish-web-agent-integrations](https://github.com/tinyfish-io/tinyfish-web-agent-integrations)


# n8n
Source: https://docs.tinyfish.ai/integrations/n8n

Use TinyFish Web Agent as a node in n8n automation workflows

## Overview

The TinyFish Web Agent node for [n8n](https://n8n.io) lets you add AI-powered web automation to any n8n workflow. Browse any website using an AI-powered remote browser to extract structured data, fill forms, navigate multi-step workflows, or interact with JavaScript-rendered pages.

## Quick Start

### Prerequisites

* n8n instance (self-hosted or cloud)
* TinyFish Web Agent API key ([get one here](https://agent.tinyfish.ai/api-keys))
* Google account (for the Google Sheets part of the tutorial)

### Setting Up the TinyFish Node

<Steps>
  <Step title="Install the community node">
    In n8n, go to **Settings > Community Nodes**. Search for `n8n-nodes-tinyfish` and click **Install**.
  </Step>

  <Step title="Add TinyFish Web Agent to your workflow">
    In any workflow, click the **+** button to open the node panel. Search for **TinyFish Web Agent** and click it to add it to your canvas.

    <img alt="n8n node panel showing the TinyFish Web Agent node" />
  </Step>

  <Step title="Create your TinyFish credentials">
    Click **Credentials > New Credential** and select **TinyFish Web Agent API**. Paste your [API key](https://agent.tinyfish.ai/api-keys) and click **Save**.

    <img alt="TinyFish Web Agent credentials in n8n" />
  </Step>
</Steps>

## Your First Workflow with TinyFish

In this tutorial, we'll build a workflow that scrapes the top stories from Hacker News (news.ycombinator.com) and writes them to a Google Sheet — no code required. The final workflow looks like this:

<img alt="Complete n8n workflow: Trigger → TinyFish Web Agent → Split Out → Google Sheets" />

### Scraping Hacker News to Google Sheets

#### Step 1: Add a Manual Trigger

1. Create a new workflow in n8n.
2. Add a **Manual Trigger** node ("When clicking 'Execute workflow'").

This lets you run the workflow on demand. You can swap this for a **Schedule Trigger** later to run it automatically (e.g., every hour).

#### Step 2: Configure TinyFish Web Agent

1. Add a **TinyFish Web Agent** node after the trigger.
2. Select your TinyFish credentials.
3. Set **Operation** to **Run (Sync)**.
4. Set **URL** to `https://news.ycombinator.com`.
5. Set **Goal** to:

```
Extract the top 10 stories. For each return a JSON object with exactly
these keys: title, url, points, comment_count. Return the result as a
JSON object with a single key "stories" containing the array.
```

<img alt="TinyFish Web Agent node configuration with Hacker News URL and goal" />

<Tip>
  Always specify the exact JSON keys you want in your goal. This ensures the output is consistent and easy to map to downstream nodes.
</Tip>

#### Step 3: Split the Results

TinyFish returns a single JSON object containing the `stories` array. To write each story as a separate row in Google Sheets, we need to split it into individual items.

1. Add a **Split Out** node after TinyFish Web Agent.
2. Set **Fields To Split Out** to `result.stories`.
3. Set **Include** to **No Other Fields**.

<img alt="Split Out node configured to split result.stories" />

#### Step 4: Write to Google Sheets

1. Add a **Google Sheets** node after Split Out.
2. Connect your **Google Sheets account** credentials.
3. Set **Resource** to **Sheet Within Document**.
4. Set **Operation** to **Append Row**.
5. Select your target **Document** and **Sheet**.
6. Set **Mapping Column Mode** to **Map Each Column Manually**.
7. Map the columns:

| Sheet Column  | Value                       |
| ------------- | --------------------------- |
| Title         | `{{ $json.title }}`         |
| URL           | `{{ $json.url }}`           |
| Points        | `{{ $json.points }}`        |
| Comment Count | `{{ $json.comment_count }}` |

<img alt="Google Sheets node with column mappings for title, url, points, and comment_count" />

#### Step 5: Run It

1. Click **Execute Workflow** to test.
2. Check your Google Sheet — you should see 10 rows of Hacker News stories with titles, URLs, points, and comment counts.

<Note>
  The first run may take 30–60 seconds as TinyFish navigates and extracts from the live page. Subsequent workflow executions will be similarly timed since each run performs a fresh browser session.
</Note>

### Next Steps

* Swap the Manual Trigger for a **Schedule Trigger** to run on a recurring schedule
* Add a **Filter** node to only capture stories above a certain point threshold
* Use **Run (SSE Streaming)** instead of Run (Sync) for longer-running extractions
* Try scraping other sites — TinyFish works on any website, including bot-protected pages

## HTTP Request Node (Alternative)

If you prefer not to install the community node, you can use n8n's built-in **HTTP Request** node with this configuration:

```json theme={null}
{
  "url": "https://agent.tinyfish.ai/v1/automation/run",
  "method": "POST",
  "headers": {
    "X-API-Key": "{{$credentials.tinyfishApiKey}}",
    "Content-Type": "application/json"
  },
  "body": {
    "url": "{{$json.targetUrl}}",
    "goal": "{{$json.goal}}"
  }
}
```

Set up a **Header Auth** credential with name `X-API-Key` and your TinyFish API key, then reference it in the HTTP Request node.

## Resources

* [n8n Community Nodes Docs](https://docs.n8n.io/integrations/community-nodes/)
* [TinyFish Web Agent API Docs](/quick-start)
* [TinyFish Integrations GitHub](https://github.com/tinyfish-io/tinyfish-web-agent-integrations)


# Browser Profiles
Source: https://docs.tinyfish.ai/key-concepts/browser-profiles

Configure browser behavior for different sites

Browser profiles let you configure how TinyFish Web Agent's browser behaves for different sites.

## The Two Profiles

| Profile   | Description                          |
| --------- | ------------------------------------ |
| `lite`    | Standard Chromium browser            |
| `stealth` | Modified browser with anti-detection |

***

## Lite (Default)

Use for standard websites without bot protection.

```typescript theme={null}
{
  url: "https://example.com",
  goal: "Extract product data",
  browser_profile: "lite"
}
```

Lite is the default. If you don't specify a profile, TinyFish Web Agent uses lite.

***

## Stealth

Use for sites with Cloudflare, DataDome, CAPTCHAs, or other bot protection.

```typescript theme={null}
{
  url: "https://protected-site.com",
  goal: "Extract product data",
  browser_profile: "stealth"
}
```

Stealth mode includes anti-fingerprinting techniques that help bypass detection systems.

***

## When to Use Each

<Tabs>
  <Tab title="Use Lite">
    * Standard websites
    * Internal tools and dashboards
    * Sites you control
    * When speed matters
  </Tab>

  <Tab title="Use Stealth">
    * Sites showing CAPTCHAs
    * Getting "Access Denied" errors
    * Sites behind Cloudflare or similar
    * E-commerce sites with bot protection
  </Tab>
</Tabs>

***

## Limitations

Stealth mode helps bypass detection but has limits:

| Limitation        | Notes                                                  |
| ----------------- | ------------------------------------------------------ |
| CAPTCHAs          | Cannot solve reCAPTCHA or similar challenges           |
| Infinite scroll   | May not scroll to load all content automatically       |
| Login persistence | Each run starts fresh, no session cookies carried over |

***

## Combining with Proxies

For maximum anti-detection, combine stealth mode with a proxy:

```typescript theme={null}
{
  url: "https://protected-site.com",
  goal: "Extract product data",
  browser_profile: "stealth",
  proxy_config: {
    enabled: true,
    country_code: "US"
  }
}
```

Learn more about proxies in the [Proxies](/key-concepts/proxies) page.

***

## Related

<CardGroup>
  <Card title="Proxies" icon="globe" href="/key-concepts/proxies">
    Geographic routing for requests
  </Card>

  <Card title="Endpoints" icon="plug" href="/key-concepts/endpoints">
    Choose how to call the API
  </Card>

  <Card title="Anti-Bot Guide" icon="shield" href="/anti-bot-guide">
    Diagnose and bypass bot detection on protected websites
  </Card>
</CardGroup>


# Vault Credentials
Source: https://docs.tinyfish.ai/key-concepts/credentials

How TinyFish uses your password manager credentials to log into websites during runs

When your vault is connected, you select which credentials TinyFish uses for each run. The AI agent handles navigation and identifies login forms. TinyFish fills in the actual credentials securely, without the agent ever seeing your passwords.

***

## Using the Playground

<Steps>
  <Step title="Open the vault selector">
    Click the lock icon in the playground toolbar.

    <img alt="Playground toolbar with vault lock icon in gray state" />
  </Step>

  <Step title="Select credentials">
    Check the credentials you want to use for the run. Items are grouped by provider and vault name, and you can use **Select all** or **Deselect all**.

    <img alt="Vault access popover with credentials grouped by provider and checkboxes" />
  </Step>

  <Step title="Run your automation">
    Write your goal, then click **Run**. TinyFish handles login during the run when a matching site requires it.

    <img alt="Playground with vault icon showing credential count badge and goal filled in" />
  </Step>
</Steps>

<Note>
  Your credential selections persist across sessions.
</Note>

***

## Using the API

<CodeGroup>
  ```python Python theme={null}
  # Vault credentials support in the Python SDK is coming soon.
  # For now, use the cURL example below with:
  # POST https://agent.tinyfish.ai/v1/automation/run
  ```

  ```typescript TypeScript theme={null}
  // Vault credentials support in the TypeScript SDK is coming soon.
  // For now, use the cURL example below with:
  // POST https://agent.tinyfish.ai/v1/automation/run
  ```

  ```bash cURL theme={null}
  # Use all vault credentials for the run
  curl -X POST https://agent.tinyfish.ai/v1/automation/run \
    -H "X-API-Key: $TINYFISH_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "url": "https://www.linkedin.com",
      "goal": "Log in and capture the latest 3 posts from the feed",
      "use_vault": true
    }'

  # Scope the run to specific credentials only
  curl -X POST https://agent.tinyfish.ai/v1/automation/run \
    -H "X-API-Key: $TINYFISH_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "url": "https://www.linkedin.com",
      "goal": "Log in and capture the latest 3 posts from the feed",
      "use_vault": true,
      "credential_item_ids": [
        "cred:conn-abc:Work:item-123",
        "cred:conn-def:Personal:item-456"
      ]
    }'
  ```

  ```bash CLI theme={null}
  # Vault credentials support in the CLI is coming soon.
  ```
</CodeGroup>

***

## Parameters

| Parameter             | Type      | Required | Default          | Description                                                                                                                  |
| --------------------- | --------- | -------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `use_vault`           | boolean   | No       | `false`          | Enable vault credentials for this run                                                                                        |
| `credential_item_ids` | string\[] | No       | All synced items | Scope to specific credential URIs from [`GET /v1/vault/items`](/vault-setup#managing-your-vault). Requires `use_vault: true` |

***

## Domain Matching

Credentials are matched by domain.

For example, a credential with `linkedin.com` in its URL will be available when the agent navigates to `www.linkedin.com` or `login.linkedin.com`.

Credentials are not available on unrelated domains.

If you have multiple credentials for the same domain, TinyFish uses the ones you selected for that run.

***

## Security

### What the AI agent sees

Labels and field names only. Never actual values. The agent tells TinyFish where to type, and TinyFish handles what to type.

### What we don't do

Credentials never appear in agent prompts, run logs, screenshots, or streaming output. We do not rely on visual obfuscation as a security measure.

### Credential lifecycle

Credentials are resolved at the browser automation layer, not the AI planning layer. Values exist in memory only for the duration of the input action, then are discarded.

### Per-run access

Each run only gets the credentials you explicitly selected. The default is no vault access with `use_vault: false`.

### Encryption

Vault provider tokens are encrypted at rest and never stored in plaintext. You can revoke access by disconnecting the vault or rotating the token.

***

## Limitations

| Limitation      | Notes                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| MFA / TOTP      | Supported for time-based codes if the vault item has a TOTP field. Hardware keys and push notifications are not supported |
| Anti-bot        | Some sites block automated login even with correct credentials. Use stealth mode and a proxy                              |
| Account lockout | Failed attempts count against normal lockout policies                                                                     |
| OAuth / SSO     | Redirect-based flows may not work for all providers                                                                       |

<Tip>
  For sites with bot protection, combine vault credentials with [Browser Profiles](/key-concepts/browser-profiles) and [Proxies](/key-concepts/proxies).
</Tip>

***

## Troubleshooting

<AccordionGroup>
  <Accordion title="credential_item_ids requires use_vault to be true" icon="triangle-exclamation">
    Add `use_vault: true` to the request body.
  </Accordion>

  <Accordion title="Credentials not being used during run" icon="circle-question">
    Verify the credential domain matches the target site.
  </Accordion>

  <Accordion title="use_vault is true but no vault connected" icon="plug-circle-xmark">
    Connect a vault first in **Settings → Vault**.
  </Accordion>

  <Accordion title="Wrong credential used" icon="key">
    Use `credential_item_ids` to scope the run to the exact credential you want.
  </Accordion>

  <Accordion title="Login failed — site shows CAPTCHA" icon="shield">
    Add `browser_profile: "stealth"` and `proxy_config: { enabled: true }`.
  </Accordion>

  <Accordion title="Vault icon not in playground toolbar" icon="lock">
    Connect a vault first in **Settings → Vault**.
  </Accordion>
</AccordionGroup>

***

## FAQ

<AccordionGroup>
  <Accordion title="Can TinyFish read all my passwords?" icon="eye">
    No. Values are only accessed at the moment of typing, and the AI agent never sees them.
  </Accordion>

  <Accordion title="Do credentials appear in run recordings?" icon="camera">
    No. Credentials are not captured in screenshots, streaming output, or logs.
  </Accordion>

  <Accordion title="What if I change a password?" icon="rotate">
    Click **Sync** in **Settings → Vault**. The next run uses the updated credential.
  </Accordion>

  <Accordion title="What happens if login fails?" icon="triangle-exclamation">
    TinyFish retries with available credentials for that domain. After multiple failures, the run continues without login.
  </Accordion>

  <Accordion title="What if I update my vault mid-run?" icon="clock">
    Runs use the credential state from when they started. Sync before starting a new run.
  </Accordion>
</AccordionGroup>

***

## Related

<CardGroup>
  <Card title="Connect Your Vault" icon="vault" href="/vault-setup">
    Set up 1Password or Bitwarden
  </Card>

  <Card title="Runs" icon="play" href="/key-concepts/runs">
    Parameters, lifecycle, and result handling
  </Card>

  <Card title="Browser Profiles" icon="window" href="/key-concepts/browser-profiles">
    Standard and stealth browser behavior
  </Card>
</CardGroup>


# Agent Endpoints
Source: https://docs.tinyfish.ai/key-concepts/endpoints

Choose the right TinyFish Agent endpoint based on sync, async, or streaming needs

TinyFish Web Agent offers three ways to run automations. Each endpoint serves a different need. Pick the one that matches how you want to handle the request and response.

## The Three Endpoints

| Endpoint     | Pattern          | Best For                             |
| ------------ | ---------------- | ------------------------------------ |
| `/run`       | Synchronous      | Quick tasks, simple integrations     |
| `/run-async` | Start then check | Long tasks, batch processing         |
| `/run-sse`   | Live updates     | Real-time progress, user-facing apps |

***

## Synchronous: `/run`

**Pattern:** Send request → Wait → Get result

The simplest approach. You call the API, it blocks until the automation completes, then returns the result.

```typescript theme={null}
import { TinyFish } from "@tiny-fish/sdk";

const client = new TinyFish();

const run = await client.agent.run({
  url: "https://example.com",
  goal: "Extract the page title",
});

console.log(run.result); // Your data
```

<Warning>
  Runs created via `/run` **cannot be cancelled**. The request blocks until the automation completes, so there is no window to issue a cancellation. If you need the ability to cancel runs, use `/run-async` or `/run-sse` instead.
</Warning>

<Tabs>
  <Tab title="When to use">
    * Tasks that complete in under 30 seconds
    * Simple scripts and one-off automations
    * When you don't need progress updates
  </Tab>

  <Tab title="When to avoid">
    * Long-running tasks (risk of timeout)
    * User-facing apps (no progress feedback)
    * Batch processing (blocks other requests)
    * When you need the ability to cancel a run
  </Tab>
</Tabs>

***

## Asynchronous: `/run-async`

**Pattern:** Send request → Get run ID → Poll for result

The request returns immediately with a `run_id`. You then poll a separate endpoint to check status and get the result when ready.

**1. Start the automation**

```typescript theme={null}
import { TinyFish } from "@tiny-fish/sdk";

const client = new TinyFish();

const queued = await client.agent.queue({
  url: "https://example.com",
  goal: "Extract all product data",
});

if (queued.error) {
  throw new Error(`Failed to queue run: ${queued.error.message}`);
}

const runId = queued.run_id;
```

**2. Poll for the result**

```typescript theme={null}
const run = await client.runs.get(runId);
// run.status: PENDING, RUNNING, COMPLETED, FAILED, or CANCELLED
// run.result: Your data (when COMPLETED)
```

**3. Cancel a run (optional)**

If you need to stop a run before it completes, send a POST to the cancel endpoint:

```typescript theme={null}
await fetch(`https://agent.tinyfish.ai/v1/runs/${runId}/cancel`, {
  method: "POST",
  headers: { "X-API-Key": process.env.TINYFISH_API_KEY },
});
```

<Info>
  Learn more about run statuses and lifecycle in [Runs](/key-concepts/runs).
</Info>

<Tabs>
  <Tab title="When to use">
    * Long-running automations (30+ seconds)
    * Batch processing multiple URLs
    * Fire-and-forget workflows
    * When you need to track runs separately
  </Tab>

  <Tab title="When to avoid">
    * When you need real-time progress updates
    * Simple, quick extractions (adds complexity)
  </Tab>
</Tabs>

***

## Streaming: `/run-sse`

**Pattern:** Send request → Receive event stream → Process events as they arrive

Uses [Server-Sent Events (SSE)](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) to push updates to you in real-time. You'll receive events for each action the browser takes, plus a streaming URL you can embed in an iframe to watch the automation live.

**1. Start the automation and read events**

```typescript theme={null}
import { TinyFish, EventType } from "@tiny-fish/sdk";

const client = new TinyFish();

const stream = await client.agent.stream({
  url: "https://example.com",
  goal: "Extract all product data",
});

for await (const event of stream) {
  console.log(event.type, event);
}
```

### Event Types

| Event           | Description                                         |
| --------------- | --------------------------------------------------- |
| `STARTED`       | Automation has begun, includes `run_id`             |
| `STREAMING_URL` | URL to watch the browser live (valid 24hrs)         |
| `PROGRESS`      | Browser action taken (click, type, scroll, etc.)    |
| `HEARTBEAT`     | Connection keep-alive (no action needed)            |
| `COMPLETE`      | Automation finished, includes `status` and `result` |

### Cancelling an SSE Run

You can cancel a streaming run using the `run_id` from the `STARTED` event:

```typescript theme={null}
await fetch(`https://agent.tinyfish.ai/v1/runs/${run_id}/cancel`, {
  method: "POST",
  headers: { "X-API-Key": process.env.TINYFISH_API_KEY },
});
```

### Handling Events

Use this pattern to process each event type as the automation progresses.

```typescript theme={null}
import { TinyFish, EventType, RunStatus } from "@tiny-fish/sdk";

const client = new TinyFish();

const stream = await client.agent.stream(
  { url: "https://example.com", goal: "Extract all product data" },
  {
    onStarted: (e) => console.log(`Run started: ${e.run_id}`),
    onStreamingUrl: (e) => console.log(`Watch live: ${e.streaming_url}`),
    onProgress: (e) => console.log(`Action: ${e.purpose}`),
    onComplete: (e) => {
      if (e.status === RunStatus.COMPLETED) {
        console.log("Result:", e.result);
      } else {
        console.error(e.error?.message || "Automation failed");
      }
    },
  },
);

for await (const event of stream) {
  // Callbacks fire automatically during iteration
}
```

<Tabs>
  <Tab title="When to use">
    * User-facing apps (show progress)
    * When you want to watch the browser live
    * Debugging and development
    * Long tasks where you want visibility
  </Tab>

  <Tab title="When to avoid">
    * Batch processing (complexity overhead)
    * Backend jobs that don't need progress
  </Tab>
</Tabs>

***

## Quick Decision Guide

<Steps>
  <Step title="Need real-time progress updates?">
    **Yes** → Use `/run-sse`
  </Step>

  <Step title="Task takes longer than 30 seconds?">
    **Yes** → Use `/run-async` + polling
  </Step>

  <Step title="Submitting multiple tasks at once?">
    **Yes** → Use `/run-async` (parallel submission)
  </Step>

  <Step title="Simple, quick task?">
    Use `/run` (synchronous)
  </Step>
</Steps>

***

## Comparison Table

| Feature          | `/run`       | `/run-async`     | `/run-sse`   |
| ---------------- | ------------ | ---------------- | ------------ |
| Response type    | Final result | Run ID           | Event stream |
| Progress updates | No           | No (poll status) | Yes          |
| Streaming URL    | In response  | Poll to get      | In events    |
| Cancellable      | No           | Yes              | Yes          |
| Best for         | Quick tasks  | Batch/long tasks | Real-time UI |
| Complexity       | Low          | Medium           | Medium       |

***

## Related

<CardGroup>
  <Card title="Runs" icon="play" href="/key-concepts/runs">
    Understand the automation lifecycle
  </Card>

  <Card title="API Reference" icon="code" href="/api-reference">
    Full endpoint specifications
  </Card>
</CardGroup>


# The Goal Parameter
Source: https://docs.tinyfish.ai/key-concepts/goals

Natural language instructions that tell TinyFish Web Agent what to do

A goal is the `goal` parameter you pass to the API: a plain English description of what you want TinyFish Web Agent to accomplish. Instead of writing code to click buttons or parse HTML, you describe the task and TinyFish Web Agent figures out how to do it.

## The Mental Model

Think of TinyFish Web Agent as a capable assistant sitting in front of a browser. It can see what's on the screen, click, type, scroll, and navigate, but it needs clear instructions.

**What it can do:**

* See exactly what you would see on the screen
* Click, type, scroll, and navigate
* Wait for dynamic content to load
* Follow instructions precisely
* Return structured data
* Navigate multi-page PDFs and extract content
* Remember information across workflow steps
* Parse natural language into form fields

**What it cannot do:**

* Read your mind about what you meant
* Guess what to do when something unexpected happens
* Know your business context unless you tell it
* Decide on output format without explicit instructions

Your job is to remove ambiguity. The more explicit your goal, the higher your success rate.

***

## Quick Examples

**Data extraction:**

```
Extract product name, price, and stock status. Return as JSON.
```

**Form filling:**

```
Fill the contact form with name "John Doe" and email "john@example.com", then click Submit.
```

**Multi-step workflow:**

```
1. Login with email "user@example.com" and password "pass123"
2. Navigate to the dashboard
3. Extract account balance
```

***

## Learn More

Learn how to write goals that succeed on the first try with our Goal Prompting Guide.

<Card title="Goal Prompting Guide" icon="bullseye" href="/prompting-guide">
  The anatomy of a great goal, task-specific patterns, and production-ready examples.
</Card>

***

## Related

<CardGroup>
  <Card title="Runs" icon="play" href="/key-concepts/runs">
    What happens after you send a goal
  </Card>

  <Card title="Endpoints" icon="plug" href="/key-concepts/endpoints">
    Choose how to call the API
  </Card>
</CardGroup>


# Proxies
Source: https://docs.tinyfish.ai/key-concepts/proxies

Route requests through specific geographic locations

Proxies let you route TinyFish Web Agent's browser requests through specific countries. Use them to access geo-restricted content or avoid regional blocks.

## How to Use

Add `proxy_config` to your request:

```typescript theme={null}
{
  url: "https://example.com",
  goal: "Extract product data",
  proxy_config: {
    enabled: true,
    country_code: "US"
  }
}
```

***

## Supported Countries

| Code | Country        |
| ---- | -------------- |
| `US` | United States  |
| `GB` | United Kingdom |
| `CA` | Canada         |
| `DE` | Germany        |
| `FR` | France         |
| `JP` | Japan          |
| `AU` | Australia      |

***

## When to Use Proxies

* Accessing geo-restricted content
* Avoiding regional IP blocks
* Testing localized content
* Combining with stealth mode for protected sites

***

## Combining with Stealth Mode

For sites with bot protection and geo-restrictions, use both:

```typescript theme={null}
{
  url: "https://protected-site.com",
  goal: "Extract product data",
  browser_profile: "stealth",
  proxy_config: {
    enabled: true,
    country_code: "US"
  }
}
```

Learn more about browser profiles in the [Browser Profiles](/key-concepts/browser-profiles) page.

***

## Related

<CardGroup>
  <Card title="Browser Profiles" icon="window" href="/key-concepts/browser-profiles">
    Standard vs stealth browser modes
  </Card>

  <Card title="Endpoints" icon="plug" href="/key-concepts/endpoints">
    Choose how to call the API
  </Card>

  <Card title="Anti-Bot Guide" icon="shield" href="/anti-bot-guide">
    Diagnose and bypass bot detection on protected websites
  </Card>
</CardGroup>


# Runs
Source: https://docs.tinyfish.ai/key-concepts/runs

The lifecycle of a TinyFish Web Agent automation

A run is a single execution of an automation. When you call any TinyFish Web Agent endpoint, you create a run that moves through a lifecycle from start to finish.

## Run Lifecycle

Every run moves through these statuses:

| Status      | Meaning                          |
| ----------- | -------------------------------- |
| `PENDING`   | Queued, waiting to start         |
| `RUNNING`   | Browser is executing your goal   |
| `COMPLETED` | Finished (check result for data) |
| `FAILED`    | Infrastructure error occurred    |
| `CANCELLED` | Manually stopped                 |

<Info>
  Cancellation is only supported for runs created via `/run-async` or `/run-sse`. Runs created via the synchronous `/run` endpoint cannot be cancelled because the request blocks until completion.
</Info>

***

## The Run Object

When you fetch a run, you get back the following object:

```json theme={null}
{
  "run_id": "abc123",
  "status": "COMPLETED",
  "result": { ... },
  "error": null,
  "streaming_url": "https://tf-abc123.fra0-tinyfish.unikraft.app/stream/0"
}
```

| Field           | Description                                                                           |
| --------------- | ------------------------------------------------------------------------------------- |
| `run_id`        | Unique identifier for this run                                                        |
| `status`        | Current lifecycle status                                                              |
| `result`        | Your extracted data (when COMPLETED)                                                  |
| `error`         | Error details (when FAILED)                                                           |
| `streaming_url` | URL to watch the browser live                                                         |
| `video_url`     | URL to the run recording, if available. `null` when no recording exists for this run. |

Runs can also use [vault credentials](/key-concepts/credentials) for authenticated automation. Pass `use_vault: true` and optionally `credential_item_ids` when creating a run to let TinyFish log into sites using your connected password manager.

***

## Searching and Filtering Runs

`GET /v1/runs` supports filtering, text search, sorting, and pagination to help you find specific runs.

### Query Parameters

| Parameter        | Type            | Description                                                                |
| ---------------- | --------------- | -------------------------------------------------------------------------- |
| `status`         | string          | Filter by status: `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED` |
| `goal`           | string          | Search runs by goal text (case-insensitive partial match)                  |
| `created_after`  | ISO 8601        | Only return runs created after this timestamp                              |
| `created_before` | ISO 8601        | Only return runs created before this timestamp                             |
| `sort_direction` | `asc` \| `desc` | Sort order by creation date (default: `desc`)                              |
| `cursor`         | string          | Pagination cursor from a previous response                                 |
| `limit`          | number          | Results per page, 1–100 (default: 20)                                      |

### Examples

**Search by goal text:**

```bash theme={null}
curl "https://agent.tinyfish.ai/v1/runs?goal=linkedin" \
  -H "X-API-Key: YOUR_API_KEY"
```

**Filter by status and date range:**

```bash theme={null}
curl "https://agent.tinyfish.ai/v1/runs?status=COMPLETED&created_after=2026-01-01T00:00:00Z&created_before=2026-02-01T00:00:00Z" \
  -H "X-API-Key: YOUR_API_KEY"
```

**Oldest first with pagination:**

```bash theme={null}
curl "https://agent.tinyfish.ai/v1/runs?sort_direction=asc&limit=10" \
  -H "X-API-Key: YOUR_API_KEY"
```

### Response Shape

`GET /v1/runs` returns a `data` array of run objects and a `pagination` object:

```json theme={null}
{
  "data": [
    {
      "run_id": "run_abc123",
      "status": "COMPLETED",
      "goal": "Extract the page title",
      "created_at": "2026-01-01T00:00:00Z",
      "started_at": "2026-01-01T00:00:01Z",
      "finished_at": "2026-01-01T00:00:30Z"
    }
  ],
  "pagination": {
    "total": 42,
    "next_cursor": null,
    "has_more": false
  }
}
```

### Cursor Pagination

When there are more results, the pagination object includes `next_cursor`:

```json theme={null}
{
  "data": [ ... ],
  "pagination": {
    "total": 142,
    "next_cursor": "eyJpZCI6...",
    "has_more": true
  }
}
```

Pass `next_cursor` as the `cursor` parameter to fetch the next page.

***

## Watching Runs Live

Every run includes a `streaming_url` where you can watch the browser execute in real-time. This is useful for debugging, demos, or showing users what's happening behind the scenes.

Embed the URL in an iframe to display the live browser view in your app:

```html theme={null}
<iframe
  src="https://tf-abc123.fra0-tinyfish.unikraft.app/stream/0"
  width="800"
  height="600"
/>
```

The streaming URL is available while the run is active. After the run completes, use `video_url` from the run object to access the recording.

***

## Retrieving Steps and Screenshots

<Warning>
  `?screenshots=base64` is available to unblock current integrations but is temporary — it will be deprecated soon in favor of URL-based access. Avoid building long-term workflows that depend on this format.
</Warning>

`GET /v1/runs/{id}` always returns a `steps` array. Pass `?screenshots=base64` to attach a screenshot to each step (\~50–100 KB each — use only for audit trails or visual debugging).

```bash theme={null}
curl "https://agent.tinyfish.ai/v1/runs/abc123?screenshots=base64" \
  -H "X-API-Key: YOUR_API_KEY"
```

The response includes a `steps` array. Without `screenshots`, the `screenshot` field is `null`:

```json theme={null}
{
  "run_id": "abc123",
  "status": "COMPLETED",
  "result": { ... },
  "steps": [
    {
      "id": "09de224d-fb2b-45b7-b067-585726194a2e",
      "timestamp": "2026-03-23T10:00:01Z",
      "status": "COMPLETED",
      "action": "Navigate to https://example.com",
      "screenshot": null,
      "duration": "1.2s"
    },
    {
      "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "timestamp": "2026-03-23T10:00:03Z",
      "status": "COMPLETED",
      "action": "Click the 'Sign In' button",
      "screenshot": "data:image/jpeg;base64,/9j/4AAQSkZJRgAB...",
      "duration": "0.8s"
    }
  ]
}
```

***

## Understanding COMPLETED Status

<Warning>
  `COMPLETED` means the infrastructure worked, not that your goal succeeded.
</Warning>

Always check the `result` field:

**Goal succeeded:**

```json theme={null}
{
  "status": "COMPLETED",
  "result": {
    "products": [
      { "name": "Widget", "price": 29.99 }
    ]
  }
}
```

**Infrastructure worked, goal failed:**

The browser worked fine, but TinyFish Web Agent couldn't achieve your goal.

```json theme={null}
{
  "status": "COMPLETED",
  "result": {
    "status": "failure",
    "reason": "Could not find any products on the page"
  }
}
```

***

## Handling Run Results

Use this pattern to handle both infrastructure failures and goal failures in your code.

```typescript theme={null}
import { TinyFish, RunStatus } from "@tiny-fish/sdk";
import type { Run } from "@tiny-fish/sdk";

const client = new TinyFish();

// Fetch a run by ID, then handle the result
const run = await client.runs.get(runId);
const result = await handleRunResult(run);

async function handleRunResult(run: Run) {
  switch (run.status) {
    case RunStatus.COMPLETED:
      if (!run.result) {
        return { success: false, error: "No result returned" };
      }

      // Check for goal-level failure in result
      if (run.result.status === "failure" || run.result.error) {
        return {
          success: false,
          error: run.result.reason || run.result.error || "Goal not achieved",
        };
      }

      return { success: true, data: run.result };

    case RunStatus.FAILED:
      return {
        success: false,
        error: run.error?.message || "Automation failed",
        retryable: true,
      };

    case RunStatus.CANCELLED:
      return { success: false, error: "Run was cancelled" };

    default:
      return { success: false, error: `Unexpected status: ${run.status}` };
  }
}
```

***

## Cancelling Runs

You can cancel a run that is `PENDING` or `RUNNING` by sending a POST request to `/v1/runs/{id}/cancel`. This works for runs created via `/run-async` or `/run-sse` only.

```typescript theme={null}
const response = await fetch(`https://agent.tinyfish.ai/v1/runs/${run_id}/cancel`, {
  method: "POST",
  headers: {
    "X-API-Key": process.env.TINYFISH_API_KEY,
  },
});

const result = await response.json();
// result.status: CANCELLED, COMPLETED, or FAILED
// result.cancelled_at: timestamp if cancelled
// result.message: additional context (e.g. "Run already cancelled")
```

The cancel endpoint is **idempotent** — calling it on an already-cancelled or completed run returns the current state without error.

| Scenario          | Response `status` | `cancelled_at` | `message`                 |
| ----------------- | ----------------- | -------------- | ------------------------- |
| Run cancelled     | `CANCELLED`       | Timestamp      | `null`                    |
| Already cancelled | `CANCELLED`       | Timestamp      | `"Run already cancelled"` |
| Already completed | `COMPLETED`       | `null`         | `"Run already finished"`  |

<Warning>
  Only runs created via the API (`/run-async` or `/run-sse`) can be cancelled using this endpoint. Runs created through the dashboard UI or via the synchronous `/run` endpoint cannot be cancelled.
</Warning>

***

## Related

<CardGroup>
  <Card title="Endpoints" icon="plug" href="/key-concepts/endpoints">
    Choose sync, async, or streaming
  </Card>

  <Card title="Error Codes" icon="triangle-exclamation" href="/error-codes">
    Handle errors gracefully
  </Card>

  <Card title="Vault Credentials" icon="lock" href="/key-concepts/credentials">
    Use password manager credentials in runs
  </Card>
</CardGroup>


# Live Browser Preview
Source: https://docs.tinyfish.ai/live-preview

Embed a real-time browser view in your app using the streaming URL

Every TinyFish automation provides a `streaming_url`, a live feed of the browser as it runs. Drop it in an iframe to show users what's happening in real time.

You'll see our little fish swimming through the web for you, navigating pages, clicking buttons, and extracting data while you watch.

<img alt="TinyFish live browser preview showing the fish navigating a webpage" />

## Getting the Streaming URL

When you use the [SSE endpoint](/key-concepts/endpoints#streaming-run-sse), one of the events you'll receive is `STREAMING_URL`:

```json theme={null}
{
  "type": "STREAMING_URL",
  "run_id": "abc123",
  "streaming_url": "https://tf-abc123.fra0-tinyfish.unikraft.app/stream/0"
}
```

<Warning>
  The streaming URL may become unavailable after the run completes. To preserve run recordings, capture the stream content during execution.
</Warning>

## Embedding It

Once you have the URL, embed it in an iframe:

```html theme={null}
<iframe
  id="preview"
  src="YOUR_STREAMING_URL"
  width="100%"
  height="600"
  style="border: 1px solid #e5e7eb; border-radius: 8px;"
></iframe>
```

For a responsive container that maintains a 16:9 aspect ratio:

```html theme={null}
<div style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden;">
  <iframe
    src="YOUR_STREAMING_URL"
    style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: none; border-radius: 8px;"
  ></iframe>
</div>
```

## Full Example

Start an automation, listen for the `STREAMING_URL` event in the SSE stream, and set it as the iframe source to display the live browser.

<CodeGroup>
  ```typescript TypeScript theme={null}
  import { TinyFish, EventType } from "@tiny-fish/sdk";

  const client = new TinyFish();

  const stream = await client.agent.stream(
    {
      url: "https://example.com/products",
      goal: "Extract all product names and prices",
    },
    {
      onStreamingUrl: (event) => {
        // Set iframe src to show the live browser
        const iframe = document.getElementById("preview");
        if (iframe) {
          iframe.setAttribute("src", event.streaming_url);
        }
      },
    },
  );

  for await (const event of stream) {
    if (event.type === EventType.COMPLETE) {
      console.log("Result:", event.result);
    }
  }
  ```

  ```python Python theme={null}
  from tinyfish import TinyFish, StreamingUrlEvent

  client = TinyFish()

  with client.agent.stream(
      url="https://example.com/products",
      goal="Extract all product names and prices",
  ) as stream:
      for event in stream:
          if isinstance(event, StreamingUrlEvent):
              # Use this URL in an iframe to show the live browser
              print("Embed this:", event.streaming_url)
              break
  ```
</CodeGroup>

## Tips

* **Keep your API key server-side.** Call the SSE endpoint from your backend and pass the `streaming_url` to the frontend. The streaming URL itself is safe to expose to the browser.
* **Show a loading state.** The streaming URL arrives a few seconds after the automation starts, so show a spinner or placeholder until then.
* **The iframe is read-only.** Users can watch but can't interact with the browser session.


# MCP Integration
Source: https://docs.tinyfish.ai/mcp-integration/index

Integrate TinyFish Web Agent with your AI assistant

Connect TinyFish to Claude, Cursor, or any MCP-compatible AI assistant. Once connected, your assistant can search the web, browse websites, and extract data on your behalf.

## Quick Install

<Tabs>
  <Tab title="Claude Code">
    ```bash theme={null}
    npx -y install-mcp@latest https://agent.tinyfish.ai/mcp --client claude-code
    ```
  </Tab>

  <Tab title="Claude Desktop">
    ```bash theme={null}
    npx -y install-mcp@latest https://agent.tinyfish.ai/mcp --client claude
    ```
  </Tab>

  <Tab title="Cursor">
    ```bash theme={null}
    npx -y install-mcp@latest https://agent.tinyfish.ai/mcp --client cursor
    ```
  </Tab>

  <Tab title="Windsurf">
    ```bash theme={null}
    npx -y install-mcp@latest https://agent.tinyfish.ai/mcp --client windsurf
    ```
  </Tab>
</Tabs>

<Accordion title="Manual configuration" icon="gear">
  <Tabs>
    <Tab title="Claude Code">
      ```bash theme={null}
      claude mcp add --transport http tinyfish https://agent.tinyfish.ai/mcp
      ```
    </Tab>

    <Tab title="Claude Desktop">
      Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

      ```json theme={null}
      {
        "mcpServers": {
          "tinyfish": {
            "url": "https://agent.tinyfish.ai/mcp"
          }
        }
      }
      ```

      Restart Claude Desktop. You'll be prompted to authenticate via OAuth.
    </Tab>

    <Tab title="Cursor">
      Add to your Cursor MCP settings:

      ```json theme={null}
      {
        "mcpServers": {
          "tinyfish": {
            "url": "https://agent.tinyfish.ai/mcp"
          }
        }
      }
      ```
    </Tab>

    <Tab title="Windsurf">
      Add to `~/.codeium/windsurf/mcp_config.json` (macOS/Linux) or `%USERPROFILE%\.codeium\windsurf\mcp_config.json` (Windows):

      ```json theme={null}
      {
        "mcpServers": {
          "tinyfish": {
            "serverUrl": "https://agent.tinyfish.ai/mcp"
          }
        }
      }
      ```
    </Tab>
  </Tabs>
</Accordion>

## Available Tools

### Web Automation

* **`run_web_automation`** — Execute multi-step web automation given a URL and natural language goal. Streams progress in real-time. Use this for tasks that require clicking, navigating, filling forms, or interacting with a website.
* **`run_web_automation_async`** — Same as `run_web_automation` but returns a `run_id` immediately without waiting. Use for long-running tasks where you don't need real-time progress. Poll with `get_run`.
* **`get_run`** — Retrieve details of a specific automation run by ID. Returns status, result, and error info.
* **`list_runs`** — List your automation runs with optional filtering by status and pagination.
* **`cancel_run`** — Cancel a running or pending automation run by ID. Idempotent — already-terminal runs return their current status.

### Batch Automation

* **`batch_create`** — Start multiple web automations simultaneously (up to 8). Each run opens its own browser session. Returns all run IDs immediately.
* **`batch_status`** — Check the status of multiple runs at once (up to 8). Poll every 30–60 seconds until `all_terminal` is true.
* **`batch_cancel`** — Cancel multiple running or pending runs by their IDs (up to 8). Idempotent.

### Web Search

* **`search`** — Search the web and get structured results with titles, snippets, and URLs. Use this to find information or discover URLs before automating a specific site.
* **`get_search_usage`** — List past search usage records with filtering by date range and status.

### Content Extraction

* **`fetch_content`** — Render web pages in a real browser and extract clean, structured content. Preferred over `run_web_automation` when you only need to read page content. Supports up to 10 URLs per request.
* **`list_fetch_usage`** — List past fetch requests with filtering by date range and status. Returns metadata only.

### Browser Sessions

* **`create_browser_session`** — Create a remote, stealth Chrome browser session and get CDP connection details. Use for direct programmatic browser control with Playwright, Puppeteer, or Selenium.
* **`list_browser_sessions`** — List your browser sessions with optional filtering by session ID, time range, and status.

## Example Usage

```
"Go to https://example.com and extract the product prices"

"Search for the best Italian restaurants in San Francisco"

"Scrape the pricing pages from these 5 competitor websites at the same time"

"Fetch https://docs.stripe.com/api/charges and summarize the API parameters"

"Create a browser session on https://example.com so I can control it with Playwright"
```

## Credit Costs

| Tool                     | Rate                         |
| ------------------------ | ---------------------------- |
| `run_web_automation`     | 1 credit per run step        |
| `search`                 | 1 credit = 2 searches        |
| `fetch_content`          | 1 credit = 15 fetches        |
| `create_browser_session` | 1 credit = 4 browser-minutes |

## Authentication

TinyFish MCP uses OAuth 2.1 for secure authentication. The first time you connect, your browser will open to complete the OAuth flow.

### Before You Start

Make sure you are signed in to both of these in your **default browser** before triggering the OAuth flow:

1. [claude.ai](https://claude.ai) — your Claude/Anthropic account
2. [agent.tinyfish.ai](https://agent.tinyfish.ai) — your TinyFish account

### Authentication Flow

When you first configure the TinyFish MCP server, Claude Desktop will open your default browser to complete OAuth. Since you're already signed in to both services, the flow will redirect automatically and complete without manual input.

<Note>You need a TinyFish account with an active subscription or credits. [Sign up here](https://agent.tinyfish.ai/api-keys).</Note>

## Troubleshooting

<AccordionGroup>
  <Accordion title="Tool not showing up" icon="circle-question">
    1. Restart your AI client after adding the config
    2. Check that the config JSON is valid
    3. Ensure you're authenticated (OAuth prompt should appear)
  </Accordion>

  <Accordion title="Authentication failing" icon="lock">
    **Before starting the OAuth flow**, make sure you are already signed in to both services in your default browser:

    1. Open your default browser and sign in to [claude.ai](https://claude.ai)
    2. In the same browser, sign in to [agent.tinyfish.ai](https://agent.tinyfish.ai)
    3. Then restart Claude Desktop and trigger the OAuth flow again

    The OAuth redirect will open in your default browser. If you're not already signed in there, the flow will fail or get stuck.

    **Still not working?**

    * **Clear cookies** - Clear browser cookies for both claude.ai and agent.tinyfish.ai, then retry
    * **Check TinyFish account** - Verify your account is active at [agent.tinyfish.ai/api-keys](https://agent.tinyfish.ai/api-keys)
  </Accordion>

  <Accordion title="Server disconnected (Windows)" icon="windows">
    On Windows, if you see "Server disconnected" errors:

    1. **Close Claude Desktop completely** - Check Task Manager and end any Claude processes
    2. **Use the direct URL method** - The recommended setup using `"url": "https://agent.tinyfish.ai/mcp"` in your config avoids these issues entirely (see Quick Install above)
    3. **Complete OAuth quickly** - When the browser opens, complete the sign-in promptly to avoid timeout issues
  </Accordion>

  <Accordion title="Automation timing out" icon="clock">
    Complex automations may take 30-60 seconds. For sites with bot protection, the assistant should use `browser_profile: "stealth"`.
  </Accordion>
</AccordionGroup>

## Related

<CardGroup>
  <Card title="Quick Start" icon="rocket" href="/quick-start">
    Get started with the REST API
  </Card>

  <Card title="API Reference" icon="code" href="/api-reference">
    Full endpoint documentation
  </Card>
</CardGroup>


# Goal Prompting Guide
Source: https://docs.tinyfish.ai/prompting-guide

Write goals that make TinyFish Web Agent work like magic

This guide teaches you how to write goals that succeed on the first try. The examples are tested against real production traffic. The patterns work. Copy them, modify them, use them.

<Info>
  **Quantified impact:** In testing, specific goals completed **4.9x faster** and returned **16x less unnecessary data** compared to vague goals for the same task.
</Info>

## The Mental Model

Think of TinyFish Web Agent as a capable but literal-minded assistant sitting in front of a browser.

**What it can do:**

* See exactly what you would see on the screen
* Click, type, scroll, and navigate
* Wait for dynamic content to load
* Follow instructions precisely
* Return structured data
* Navigate multi-page PDFs and extract content
* Remember information across workflow steps
* Parse natural language into form fields

**What it cannot do:**

* Read your mind about what you meant
* Guess what to do when something unexpected happens
* Know your business context unless you tell it
* Decide on output format without explicit instructions

Your job is to remove ambiguity. The more explicit your goal, the higher your success rate.

## Match Goal Style to Task Type

Different tasks benefit from different goal-writing approaches:

| Task Type                | Recommended Style      | Key Principle                                    |
| ------------------------ | ---------------------- | ------------------------------------------------ |
| Price/product extraction | Specific, constrained  | List exact fields, exclude extras                |
| Form filling             | Natural language       | Describe the person/entity, let agent map fields |
| Multi-step workflows     | Numbered steps         | Enable cross-step memory references              |
| Batch execution          | Minimal, strict schema | Only essential fields for consistency            |

## The Anatomy of a Great Goal

Every effective goal has up to seven components. Simple tasks may need only two or three. Complex extractions benefit from all seven.

| Component  | Purpose               | Example                                    |
| ---------- | --------------------- | ------------------------------------------ |
| Objective  | What to achieve       | "Extract pricing information"              |
| Target     | Where to focus        | "from the pricing table"                   |
| Fields     | What data to extract  | "product name, price, availability"        |
| Schema     | Output structure      | "Return as JSON with keys: name, price"    |
| Steps      | Sequence of actions   | "Close the cookie banner first"            |
| Guardrails | What NOT to do        | "Do not click purchase buttons"            |
| Edge cases | Handle the unexpected | "If price shows 'Contact Us', set to null" |

## The Transformation Pattern

Here's how the same task looks at three quality levels:

<Tabs>
  <Tab title="Vague (fails)">
    ```
    Get the pricing from this page
    ```

    The agent doesn't know what "pricing" means to you. Annual vs monthly? Features included? What format?
  </Tab>

  <Tab title="Better (might work)">
    ```
    Extract the product name, price, and stock status. Return as JSON.
    ```

    Clearer, but still ambiguous. What if there are multiple prices? What JSON structure?
  </Tab>

  <Tab title="Production-ready">
    ```
    Extract the following from this product page:
    - Product name (full title as displayed)
    - Current price (number only, no currency symbol)
    - Original price if on sale, otherwise null
    - Currency code
    - In stock (true/false)

    If a cookie banner appears, close it first.
    Do not click any Add to Cart or purchase buttons.
    If price shows "Contact for price", set current_price to null.

    Return as JSON with this structure:
    {
      "product_name": "string",
      "current_price": number or null,
      "original_price": number or null,
      "currency": "string",
      "in_stock": boolean
    }
    ```

    This tells the agent exactly what to do at every decision point.
  </Tab>
</Tabs>

## Task-Specific Examples

<Tabs>
  <Tab title="Data Extraction">
    For extraction, be specific and constrained to prevent over-fetching:

    ```
    Extract ONLY the following from the pricing table:
    - plan_name: string
    - monthly_price: number (no currency symbol)
    - annual_price: number (no currency symbol)
    - feature_count: integer

    Do not extract feature descriptions or marketing copy.
    Return as JSON array.
    ```
  </Tab>

  <Tab title="Form Filling">
    For forms, use natural language—the agent handles field mapping:

    ```
    Fill out the contact form with this information:

    John Smith is a software engineer at Acme Corp in San Francisco.
    His email is john.smith@acme.com and phone is 415-555-0123.
    He's interested in the Enterprise plan and wants a demo next week.

    Submit the form when complete.
    ```

    The agent maps "software engineer" to job title, "Acme Corp" to company, etc.
  </Tab>

  <Tab title="Multi-Step Workflow">
    For workflows, use numbered steps to enable cross-step memory:

    ```
    Complete this account verification workflow:

    1. Navigate to the login page and click "Forgot Password"
    2. Enter the email address: test@example.com
    3. Note the confirmation message shown (save this for later)
    4. Check the email inbox at the provided URL for the code
    5. Return to the original site and enter the code from step 4
    6. Confirm the new password form appears

    Return the confirmation message from step 3 and success/failure status.
    ```
  </Tab>
</Tabs>

## Single Runs vs. Batch Execution

Understanding when you're running a single task versus scaling to many is critical for goal design.

### Single Runs (Playground & Individual API Calls)

**When you use this:**

* Testing and validating goals in the Playground
* One-off extractions or automations
* Prototyping before scaling

**Goal design principles:**

* Focus on completeness—you want rich results from this one run
* Include detailed edge case handling since you can iterate
* Add verbose output instructions for debugging

### Batch Execution (Projects & Concurrent API Calls)

**When you use this:**

* Processing hundreds or thousands of URLs
* Scheduled monitoring jobs
* Building datasets at scale

**Goal design principles:**

* Optimize for consistency—every run should return identical structure
* Minimize fields to only what you need
* Use strict schemas for reliable downstream processing

| Aspect            | Single Run               | Batch Execution                 |
| ----------------- | ------------------------ | ------------------------------- |
| Field count       | More fields, richer data | Minimal fields, only essentials |
| Error handling    | Verbose, for debugging   | Structured, for automation      |
| Schema strictness | Flexible                 | Exact match required            |
| Edge cases        | Detailed instructions    | Fail-fast with error flags      |
| Goal length       | Longer, comprehensive    | Shorter, focused                |

## Schema Enforcement for Batch Runs

When running the same goal repeatedly, schema consistency is critical. Without explicit enforcement, the agent may return slightly different field names across runs.

**Best practice:** Provide an example schema with exact field names AND sample values.

```
Return JSON matching this exact structure:
{
  "product_name": "Example Product Title",
  "current_price": 29.99,
  "currency": "USD",
  "in_stock": true
}
```

Why sample values matter:

* Field names alone can be ambiguous (`price` vs `"price": "29.99"` vs `"price": 29.99`)
* Sample values clarify expected types (number vs string, boolean vs "yes/no")
* The agent mirrors the pattern it sees

<Warning>
  **Anti-pattern:** `Return as JSON with product name, price, and availability.`

  This might return `{"name": "..."}` one time and `{"product_name": "..."}` another.
</Warning>

## Goal Writing Tips

<AccordionGroup>
  <Accordion title="Specify output format" icon="code">
    Tell TinyFish Web Agent how to structure the response:

    ```
    Extract product data. Return as JSON with this structure:
    {
      "products": [
        { "name": string, "price": string, "rating": number }
      ]
    }
    ```
  </Accordion>

  <Accordion title="Handle edge cases" icon="code-branch">
    Anticipate what might go wrong:

    ```
    Extract the price from the product page.
    If the product is out of stock, return { "price": null, "outOfStock": true }.
    If no price is found, return { "price": null, "error": "Price not found" }.
    ```
  </Accordion>

  <Accordion title="Use numbered steps for sequences" icon="list-ol">
    For multi-step workflows, number the steps:

    ```
    1. Click "Login"
    2. Enter username "demo@example.com"
    3. Enter password "demo123"
    4. Click "Submit"
    5. Wait for dashboard to load
    6. Extract the account balance shown in the header
    ```
  </Accordion>

  <Accordion title="Trigger cross-step memory explicitly" icon="brain">
    When data from one step is needed later, tell the agent to remember it:

    ```
    IMPORTANT: On Step 6, a verification code will be displayed.
    You MUST remember this code and enter it exactly on Step 7.
    ```

    Other phrases that work:

    * "Remember these values—you'll need them for verification"
    * "Note the confirmation number displayed"
    * "Save this for later"
  </Accordion>

  <Accordion title="Describe elements visually" icon="eye">
    When element IDs aren't known, describe visually:

    ```
    Click the blue "Add to Cart" button below the price
    ```

    Instead of:

    ```
    Click the button with id="add-to-cart-btn"
    ```
  </Accordion>

  <Accordion title="Set explicit boundaries" icon="ruler">
    Limit scope to avoid over-extraction:

    ```
    Extract the FIRST 10 products only from the current page.
    Do not click pagination or load more items.
    ```
  </Accordion>

  <Accordion title="Include termination conditions" icon="stop">
    Tell the agent when to stop:

    ```
    Stop when ANY of these is true:
    - You have extracted 20 items
    - No more "Load More" button exists
    - You have processed 5 pages
    - The page shows a login prompt
    ```
  </Accordion>

  <Accordion title="Use explicit fallbacks" icon="arrows-split-up-and-left">
    When a page might have multiple layouts:

    ```
    Extract the product price from this page.

    Primary approach: Look for the price in the main product details section.
    If not found: Check the "Buy Box" sidebar on the right.
    If still not found: Look for a "See price in cart" button.

    Return:
    {
      "price": number or null,
      "price_location": "main" or "sidebar" or "cart_required" or "not_found"
    }
    ```
  </Accordion>
</AccordionGroup>

## The Intern Test

Ask yourself: If I handed this goal to a smart but literal-minded intern who has never seen this website, would they:

* Know exactly where to look first?
* Know when to stop?
* Know what to do if something unexpected happens?
* Know the exact format I want the answer in?

If any answer is "they would have to guess," add more detail.

## Ready-to-Use Templates

Copy and modify these templates for your use cases.

<AccordionGroup>
  <Accordion title="Template A: Product Extraction" icon="box">
    ```
    Extract the following from this product page:
    - Product name (full title)
    - Current price (number only, no currency symbol)
    - Original price if on sale, otherwise null
    - Currency code
    - Availability status
    - Shipping information if shown

    If a cookie or consent banner appears, close it.
    Wait for the price to fully load before extracting.

    Return as JSON.
    ```
  </Accordion>

  <Accordion title="Template B: Listing Extraction" icon="list">
    ```
    Extract the first [N] listings from this page.

    For each listing, extract:
    - [Primary identifier: name, title, etc.]
    - [Key attributes: location, price, size, etc.]
    - [Secondary attributes as needed]
    - Listing URL

    If there is a "Load More" button, click it once before extracting.
    Scroll down to ensure all visible listings are loaded.

    Return as a JSON array.
    ```
  </Accordion>

  <Accordion title="Template C: Company Research" icon="building">
    ```
    Extract the following from this company/profile page:
    - Name
    - Description or tagline
    - Industry or category
    - Size or scale indicators
    - Location
    - Website or contact info if shown
    - Any key metrics displayed

    Return as JSON.
    ```
  </Accordion>

  <Accordion title="Template D: Multi-Page Navigation" icon="forward">
    ```
    Extract [data type] from this page.

    For each item, extract:
    - [Field definitions]

    After extracting from the current page:
    1. Look for a "Next" button or pagination link
    2. If found and you have fewer than [N] items, click it
    3. Wait for the new page to load
    4. Continue extracting

    Stop when you have [N] items or no more pages exist.

    Return all results as a single JSON array.
    ```
  </Accordion>

  <Accordion title="Template E: Search and Filter" icon="magnifying-glass">
    ```
    On this page:

    1. Find the search box
    2. Enter "[search query]"
    3. Click search or press Enter
    4. Wait for results to load
    5. Extract the first [N] results

    For each result, extract:
    - [Field definitions]

    Return as a JSON array.
    ```
  </Accordion>

  <Accordion title="Template F: PDF Extraction" icon="file-pdf">
    ```
    Extract the following from this PDF document:

    1. Navigate through all pages of the PDF
    2. For each page, extract:
       - [Specific content: tables, headings, paragraphs]
       - Page number

    If the PDF has a table of contents, use it to locate [specific section].
    Scroll through the entire document to ensure all pages are processed.

    Return as JSON with structure:
    {
      "document_title": "string",
      "total_pages": number,
      "extracted_content": [
        { "page": number, "content": "string or structured data" }
      ]
    }
    ```
  </Accordion>

  <Accordion title="Template G: Form with Verification" icon="square-check">
    ```
    Complete this form workflow:

    1. Navigate to the form at [URL or describe location]
    2. Fill in the form with this information:
       [Natural language description of the data]
    3. Click Submit/Continue
    4. On the confirmation page, note the reference number or confirmation message
    5. If a verification step appears:
       - Note what verification is required
       - Complete it if possible
    6. Return to confirm final success state

    Return:
    {
      "form_submitted": boolean,
      "confirmation_reference": "string or null",
      "verification_required": "string description or null",
      "final_status": "success" or "pending_verification" or "failed"
    }
    ```
  </Accordion>

  <Accordion title="Template H: Extraction with Fallbacks" icon="arrows-split-up-and-left">
    ```
    Extract [data] from this page.

    Primary location: [main expected location]
    Fallback 1: [alternative location if primary missing]
    Fallback 2: [second alternative]

    For each item found, extract:
    - [Field definitions]
    - source_location: where the data was found

    If no data found in any location, return:
    {
      "success": false,
      "error": "data_not_found",
      "locations_checked": ["primary", "fallback1", "fallback2"]
    }
    ```
  </Accordion>
</AccordionGroup>

## Troubleshooting

Common issues and how to fix them:

| Issue           | Likely Cause                       | Solution                                               |
| --------------- | ---------------------------------- | ------------------------------------------------------ |
| Empty results   | JavaScript didn't finish rendering | Add "Wait for \[specific element] to fully load"       |
| Missing fields  | Data hidden until interaction      | Add "Click \[button] to expand" or "Scroll down first" |
| Wrong data      | Goal was ambiguous                 | Be more specific about which section to extract from   |
| Partial results | Pagination not handled             | Add explicit "click Next" instructions with a limit    |
| Blocked         | Site has bot protection            | Try `browser_profile: "stealth"` with proxy            |
| Slow completion | Goal too vague                     | Add specific field constraints, reduce scope           |
| Timeout         | Task too complex                   | Break into smaller runs or add termination conditions  |

<Note>
  Runs have a 10-minute timeout. Design goals to complete their core task well within that limit. For complex multi-step workflows, break them into smaller runs.
</Note>

## Observed Behaviors

TinyFish Web Agent handles common natural language variations automatically:

| Input            | Interpreted As     |
| ---------------- | ------------------ |
| "March 15, 1985" | 1985-03-15         |
| "tech"           | Technology         |
| "mornings"       | Morning (9am-12pm) |
| "TX"             | Texas              |

<Note>
  Letter-based phone numbers like `555-WORK-123` may be converted to keypad digits (`555-967-5123`).
</Note>

## Known Limitations

| Limitation        | Notes                                                 |
| ----------------- | ----------------------------------------------------- |
| CAPTCHAs          | Cannot solve reCAPTCHA or similar challenges          |
| Infinite scroll   | May not scroll to load all content automatically      |
| Login persistence | Each run starts fresh—no session cookies carried over |

## Related

<CardGroup>
  <Card title="AI Integration Guide" icon="robot" href="/ai-integration">
    Integrate TinyFish Web Agent with your LLM
  </Card>

  <Card title="API Reference" icon="code" href="/api-reference">
    Complete endpoint documentation
  </Card>

  <Card title="Examples" icon="flask" href="/examples/scraping">
    Real-world code examples
  </Card>

  <Card title="FAQ" icon="circle-question" href="/faq">
    Common questions answered
  </Card>
</CardGroup>


# Quick Start
Source: https://docs.tinyfish.ai/quick-start

Get your first web automation running in under 5 minutes

<Steps>
  <Step title="Create a TinyFish account">
    Sign up for a new TinyFish account [here](https://agent.tinyfish.ai/sign-up).
  </Step>

  <Step title="Get your API key">
    1. Go to the [API Keys page](https://agent.tinyfish.ai/api-keys)
    2. Click "Create API Key"
    3. Copy and store your key securely in your shell environment

    <Warning>API keys are shown only once. Store them securely and never commit them to version control.</Warning>

    ```bash theme={null}
    export TINYFISH_API_KEY=sk-tinyfish-*****
    ```
  </Step>

  <Step title="Write code for your first workflow">
    We'll write the minimal code to navigate to a website and extract product data using natural language.

    <CodeGroup>
      ```python Python theme={null}
      # first_automation.py
      from tinyfish import TinyFish, CompleteEvent

      client = TinyFish()  # Reads TINYFISH_API_KEY from environment

      # Stream the automation and print the structured result
      with client.agent.stream(
          url="https://scrapeme.live/shop",  # Target website to automate
          goal="Extract the first 2 product names and prices. Return as JSON.",
      ) as stream:
          for event in stream:
              if isinstance(event, CompleteEvent):
                  print(event.result_json)
      ```

      ```typescript TypeScript theme={null}
      // first-automation.ts
      import { TinyFish } from "@tiny-fish/sdk";

      async function main() {
        const client = new TinyFish();  // Reads TINYFISH_API_KEY from environment

        const stream = await client.agent.stream({
          url: "https://scrapeme.live/shop",  // Target website to automate
          goal: "Extract the first 2 product names and prices",  // Natural language instruction
        });

        for await (const event of stream) {
          if (event.type === "COMPLETE") {
            console.log(event.result);
          }
        }
      }

      main();
      ```

      ```bash cURL theme={null}
      curl -N -X POST https://agent.tinyfish.ai/v1/automation/run-sse \
        -H "X-API-Key: $TINYFISH_API_KEY" \
        -H "Content-Type: application/json" \
        -d '{
          "url": "https://scrapeme.live/shop",
          "goal": "Extract the first 2 product names and prices"
        }'
      ```

      ```bash CLI theme={null}
      tinyfish agent run "Extract the first 2 product names and prices" \
        --url https://scrapeme.live/shop --pretty
      ```
    </CodeGroup>

    <Tip>
      See our [Prompting Guide](/prompting-guide) to get structured JSON responses instead of plain text.
    </Tip>
  </Step>

  <Step title="Run your first workflow">
    Run the code with the following command:

    <CodeGroup>
      ```bash Python theme={null}
      python first_automation.py
      ```

      ```bash TypeScript theme={null}
      npx tsx first-automation.ts
      ```

      ```bash CLI theme={null}
      tinyfish agent run "Extract the first 2 product names and prices" --url https://scrapeme.live/shop --pretty
      ```
    </CodeGroup>
  </Step>

  <Step title="Verify output">
    You should see SSE events streaming in your terminal:

    ```bash theme={null}
    {'type': 'STARTED', 'run_id': 'abc123'}
    {'type': 'STREAMING_URL', 'run_id': 'abc123', 'streaming_url': 'https://tf-abc123.fra0-tinyfish.unikraft.app/stream/0'}
    {'type': 'PROGRESS', 'run_id': 'abc123', 'purpose': 'Visit the page to extract product information'}
    {'type': 'PROGRESS', 'run_id': 'abc123', 'purpose': 'Check for product information on the page'}
    {'type': 'COMPLETE', 'run_id': 'abc123', 'status': 'COMPLETED', 'result': {
      "products": [
        { "name": "Bulbasaur", "price": "$63.00" },
        { "name": "Ivysaur", "price": "$87.00" },
      ]
    }}
    ```

    With `--pretty`, the CLI output looks like:

    ```
    ▶ Run started
    • Visit the page to extract product information
    • Check for product information on the page
    ✓ Completed

    {"products": [{"name": "Bulbasaur", "price": "$63.00"}, {"name": "Ivysaur", "price": "$87.00"}]}

    View run: https://agent.tinyfish.ai/runs/abc123
    ```
  </Step>
</Steps>

## Next Steps

<CardGroup>
  <Card title="Agent API Reference" icon="code" href="/agent-api/reference">
    Streaming, async runs, and endpoint selection
  </Card>

  <Card title="Examples" icon="lightbulb" href="/examples/scraping">
    Copy-paste ready code
  </Card>
</CardGroup>


# Search Examples
Source: https://docs.tinyfish.ai/search-api/examples

Real-world examples for the Search API

## Basic Search

Search the web and get structured results:

<CodeGroup>
  ```python Python theme={null}
  from tinyfish import TinyFish

  client = TinyFish()
  response = client.search.query(query="web automation tools", location="US")

  for r in response.results:
      print(f"{r.position}. {r.title}")
      print(f"   {r.url}\n")
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish } from "@tiny-fish/sdk";

  const client = new TinyFish();
  const response = await client.search.query({
    query: "web automation tools",
    location: "US",
  });

  for (const r of response.results) {
    console.log(`${r.position}. ${r.title}`);
    console.log(`   ${r.url}\n`);
  }
  ```

  ```bash cURL theme={null}
  curl -s "https://api.search.tinyfish.ai?query=web+automation+tools&location=US" \
    -H "X-API-Key: $TINYFISH_API_KEY"
  ```
</CodeGroup>

**Output:**

```json theme={null}
{
  "query": "web automation tools",
  "results": [
    {
      "position": 1,
      "site_name": "www.firecrawl.dev",
      "title": "Top 9 Browser Automation Tools for Web Testing and Scraping in ...",
      "snippet": "This guide covers 9 of the best tools across testing, scraping, and workflow automation...",
      "url": "https://www.firecrawl.dev/blog/browser-automation-tools-comparison"
    },
    {
      "position": 2,
      "site_name": "www.skyvern.com",
      "title": "Best Free Open Source Browser Automation Tools in 2025 - Skyvern",
      "snippet": "Developed by Microsoft, Playwright is the next generation of web automation tools...",
      "url": "https://www.skyvern.com/blog/best-free-open-source-browser-automation-tools-in-2025/"
    }
  ],
  "total_results": 10
}
```

## Include or Exclude Sites

Use search operators in the `query` string to control which domains appear in
the results. Use `site:` to limit results to a domain, and repeat `-site:` to
exclude domains.

<CodeGroup>
  ```python Python theme={null}
  from tinyfish import TinyFish

  client = TinyFish()
  response = client.search.query(
      query="python tutorial site:docs.python.org",
      location="US",
  )

  for r in response.results:
      print(f"{r.position}. {r.title} ({r.site_name})")
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish } from "@tiny-fish/sdk";

  const client = new TinyFish();
  const response = await client.search.query({
    query: "python tutorial site:docs.python.org",
    location: "US",
  });

  for (const r of response.results) {
    console.log(`${r.position}. ${r.title} (${r.site_name})`);
  }
  ```

  ```bash cURL theme={null}
  curl -G "https://api.search.tinyfish.ai" \
    --data-urlencode "query=python tutorial site:docs.python.org" \
    --data-urlencode "location=US" \
    -H "X-API-Key: $TINYFISH_API_KEY"
  ```
</CodeGroup>

To exclude specific sites, add `-site:` terms to the query:

```bash cURL theme={null}
curl -G "https://api.search.tinyfish.ai" \
  --data-urlencode "query=recipe ideas -site:facebook.com -site:youtube.com" \
  --data-urlencode "location=US" \
  -H "X-API-Key: $TINYFISH_API_KEY"
```

## Geo-Targeted Search

Get results localized to a specific country and language:

<CodeGroup>
  ```python Python theme={null}
  from tinyfish import TinyFish

  client = TinyFish()

  # Search in French — location auto-resolves to FR
  response = client.search.query(query="meilleurs restaurants", language="fr")

  for r in response.results:
      print(f"{r.position}. {r.title} ({r.site_name})")
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish } from "@tiny-fish/sdk";

  const client = new TinyFish();

  // Search in French — location auto-resolves to FR
  const response = await client.search.query({
    query: "meilleurs restaurants",
    language: "fr",
  });

  for (const r of response.results) {
    console.log(`${r.position}. ${r.title} (${r.site_name})`);
  }
  ```

  ```bash cURL theme={null}
  curl -s "https://api.search.tinyfish.ai?query=meilleurs+restaurants&language=fr" \
    -H "X-API-Key: $TINYFISH_API_KEY"
  ```
</CodeGroup>

<Note>
  When only `language` is provided, `location` auto-resolves to the most common pairing (e.g. `fr` → `FR`, `ja` → `JP`). See the [Reference](/search-api/reference) for details.
</Note>

## Search + Fetch Pipeline

Combine Search with Fetch to get full page content from top results:

<CodeGroup>
  ```python Python theme={null}
  from tinyfish import TinyFish

  client = TinyFish()

  # Step 1: Search
  results = client.search.query(query="TinyFish web agent", location="US")
  top_urls = [r.url for r in results.results[:3]]

  # Step 2: Fetch full content
  pages = client.fetch.get_contents(urls=top_urls, format="markdown")
  for page in pages.results:
      print(f"## {page.title}")
      print(page.text[:200], "\n")
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish } from "@tiny-fish/sdk";

  const client = new TinyFish();

  // Step 1: Search
  const results = await client.search.query({
    query: "TinyFish web agent",
    location: "US",
  });
  const topUrls = results.results.slice(0, 3).map((r) => r.url);

  // Step 2: Fetch full content
  const pages = await client.fetch.getContents({
    urls: topUrls,
    format: "markdown",
  });
  for (const page of pages.results) {
    console.log(`## ${page.title}`);
    console.log(page.text.slice(0, 200), "\n");
  }
  ```
</CodeGroup>

***

## Related

<CardGroup>
  <Card title="Search Reference" icon="magnifying-glass" href="/search-api/reference">
    Full parameter and response docs
  </Card>

  <Card title="Fetch Examples" icon="bolt" href="/fetch-api/examples">
    Extract page content from URLs
  </Card>
</CardGroup>


# Search API
Source: https://docs.tinyfish.ai/search-api/index

Search the web and get structured results via API

<Note>
  Search does not use credits.
</Note>

The TinyFish Search API lets you run web searches and get back structured results — titles, snippets, and URLs — ready for LLM consumption or programmatic use.

```bash theme={null}
GET https://api.search.tinyfish.ai
```

`api.search.tinyfish.ai` is the public Search API endpoint.

## Before You Start

<Steps>
  <Step title="Get your API key">
    Visit [agent.tinyfish.ai/api-keys](https://agent.tinyfish.ai/api-keys) and create a key. Store it in your environment:

    ```bash theme={null}
    export TINYFISH_API_KEY="your_api_key_here"
    ```
  </Step>
</Steps>

All requests require the `X-API-Key` header. See [Authentication](/authentication) for the full setup and troubleshooting guide.

## Your First Request

<CodeGroup>
  ```python Python theme={null}
  from tinyfish import TinyFish

  client = TinyFish()
  response = client.search.query(query="web automation tools")
  for r in response.results:
      print(r.title, "→", r.url)
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish } from "@tiny-fish/sdk";

  const client = new TinyFish();
  const response = await client.search.query({ query: "web automation tools" });
  response.results.forEach((r) => console.log(r.title, "→", r.url));
  ```

  ```bash cURL theme={null}
  curl "https://api.search.tinyfish.ai?query=web+automation+tools" \
    -H "X-API-Key: $TINYFISH_API_KEY"
  ```
</CodeGroup>

## What Success Looks Like

```json theme={null}
{
  "query": "web automation tools",
  "results": [
    {
      "position": 1,
      "site_name": "tinyfish.ai",
      "title": "TinyFish — AI Web Automation Platform",
      "snippet": "Automate any website with natural language instructions...",
      "url": "https://tinyfish.ai"
    },
    {
      "position": 2,
      "site_name": "github.com",
      "title": "Top Web Automation Tools in 2026",
      "snippet": "A curated list of browser automation frameworks...",
      "url": "https://github.com/example/web-automation-tools"
    }
  ],
  "total_results": 10
}
```

## When to Use Search vs the Other APIs

* Use **Search** when you need ranked search engine results, snippets, and URLs.
* Use **Fetch** when you already have the URLs and want extracted page content.
* Use **Agent** when you want TinyFish to browse and execute a workflow on the site.
* Use **Browser** when you need direct browser control from your own code.

***

## Geo-Targeted Results

Use the `location` and `language` parameters to get results tailored to a specific region.

<CodeGroup>
  ```python Python theme={null}
  from tinyfish import TinyFish

  client = TinyFish()
  response = client.search.query(
      query="best restaurants",
      location="FR",
      language="fr",
  )
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish } from "@tiny-fish/sdk";

  const client = new TinyFish();
  const response = await client.search.query({
    query: "best restaurants",
    location: "FR",
    language: "fr",
  });
  ```

  ```bash cURL theme={null}
  curl "https://api.search.tinyfish.ai?query=best+restaurants&location=FR&language=fr" \
    -H "X-API-Key: $TINYFISH_API_KEY"
  ```
</CodeGroup>

***

## Read Next

<CardGroup>
  <Card title="API Reference" icon="code" href="/search-api/reference">
    Full request and response schema
  </Card>

  <Card title="Authentication" icon="key" href="/authentication">
    API key setup
  </Card>

  <Card title="For coding agents" icon="robot" href="/for-coding-agents">
    One page that routes an agent to the right TinyFish API
  </Card>
</CardGroup>


# Search API Reference
Source: https://docs.tinyfish.ai/search-api/reference

Complete reference for the Search API endpoint

## Endpoint

```
GET https://api.search.tinyfish.ai
```

All requests require an `X-API-Key` header. See [Authentication](/authentication).

***

## Request

```
GET https://api.search.tinyfish.ai?query=web+automation+tools&location=US&language=en
```

### Parameters

<ParamField type="string">
  The search query string. Use search operators inside this string to scope results to
  specific sites or exclude sites. For example, `python tutorial site:docs.python.org`
  returns results from Python's docs, while `recipe ideas -site:facebook.com -site:youtube.com`
  excludes Facebook and YouTube results.
</ParamField>

<ParamField type="string">
  Country code for geo-targeted results (e.g. `US`, `GB`, `FR`, `DE`). When omitted, auto-resolves based on `language` (e.g. `fr` → `FR`). Defaults to `US` if both `location` and `language` are omitted.
</ParamField>

<ParamField type="string">
  Language code for result language (e.g. `en`, `fr`, `de`). When omitted, auto-resolves based on `location` (e.g. `FR` → `fr`). Defaults to `en` if both `location` and `language` are omitted.
</ParamField>

<ParamField type="number">
  Page number for pagination, starting from `0` (e.g. `2` to retrieve the third page of results). Maximum value is `10`.
</ParamField>

<Note>
  **Location & language auto-resolution:** If only one of `location` or `language` is provided, the other is automatically resolved to the most predominant pairing. For example, setting `location=BR` without `language` resolves to `language=pt`. Setting `language=ja` without `location` resolves to `location=JP`. If neither is set, they default to `US` and `en`.
</Note>

***

## Response

```json theme={null}
{
  "query": "web automation tools",
  "results": [...],
  "total_results": 10
}
```

### Top-level fields

<ResponseField name="query" type="string">
  The search query that was executed.
</ResponseField>

<ResponseField name="results" type="object[]">
  Array of search results.
</ResponseField>

<ResponseField name="total_results" type="number">
  Total number of results returned.
</ResponseField>

<ResponseField name="page" type="number">
  The current page number, starting from `0`.
</ResponseField>

### `results[]`

<ResponseField name="position" type="number">
  Position in search results (1-indexed).
</ResponseField>

<ResponseField name="site_name" type="string">
  Domain name of the result.
</ResponseField>

<ResponseField name="title" type="string">
  Page title.
</ResponseField>

<ResponseField name="snippet" type="string">
  Text snippet from the result.
</ResponseField>

<ResponseField name="url" type="string">
  URL of the result.
</ResponseField>

## SDK Methods

<CodeGroup>
  ```python Python theme={null}
  from tinyfish import TinyFish

  client = TinyFish()
  response = client.search.query(query="web automation tools", location="United States")
  for r in response.results:
      print(r.title, "→", r.url)
  ```

  ```typescript TypeScript theme={null}
  import { TinyFish } from "@tiny-fish/sdk";

  const client = new TinyFish();
  const response = await client.search.query({
    query: "web automation tools",
    location: "United States",
  });
  response.results.forEach((r) => console.log(r.title, "→", r.url));
  ```
</CodeGroup>

***

## Error Codes

| Status | Meaning                                                            |
| ------ | ------------------------------------------------------------------ |
| `400`  | Invalid request — missing `query` parameter or bad parameter value |
| `401`  | Missing or invalid API key                                         |
| `402`  | Payment required — active subscription required                    |
| `403`  | Search API access is not enabled for this account                  |
| `404`  | Search API is not available                                        |
| `429`  | Rate limit exceeded                                                |
| `500`  | Internal server error                                              |
| `503`  | Search service unavailable — retry with backoff                    |

## Rate Limits

Limits apply per API key, measured in requests per minute across all requests.

| Plan          | Requests / minute |
| ------------- | ----------------- |
| Free          | 30                |
| Pay As You Go | 30                |
| Starter       | 60                |
| Pro           | 120               |

When the limit is exceeded, the API returns `HTTP 429`.

***

## Billing

Search does not use credits.

***

## Related

<CardGroup>
  <Card title="Search Overview" icon="magnifying-glass" href="/search-api">
    First request, success shape, and product routing
  </Card>

  <Card title="Authentication" icon="key" href="/authentication">
    API key setup and troubleshooting
  </Card>

  <Card title="Error Codes" icon="triangle-exclamation" href="/error-codes">
    Full list of API error codes
  </Card>
</CardGroup>


# Build with AI
Source: https://docs.tinyfish.ai/using-with-ai

Give your AI coding assistant context on TinyFish Web Agent

Set up TinyFish Web Agent in minutes using your AI coding assistant. Just copy the prompt below, drop it into Claude, Cursor, or ChatGPT, and start building your web agent.

## Three Ways to Get Started

<CardGroup>
  <Card title="Automation MCP" icon="robot" href="#automation-mcp-server">
    Let your AI assistant run web automations directly
  </Card>

  <Card title="Docs MCP" icon="book" href="#docs-mcp-server">
    Give your AI assistant searchable access to TinyFish docs
  </Card>

  <Card title="Integration Prompt" icon="clipboard" href="#integration-prompt">
    Paste into any AI assistant to generate custom integration code
  </Card>
</CardGroup>

## Automation MCP Server

Connect TinyFish as a tool in your AI assistant so it can browse websites, extract data, and complete multi-step automations on your behalf. Supports Claude Code, Claude Desktop, Cursor, and Windsurf.

See the [MCP Integration guide](/mcp-integration) for setup instructions, available tools, and troubleshooting.

***

## Docs MCP Server

Give your AI assistant searchable access to TinyFish documentation so it can look up API references, code examples, and guides while helping you build integrations.

### Quick Install

<Tabs>
  <Tab title="Claude Code">
    ```bash theme={null}
    npx -y install-mcp@latest https://docs.tinyfish.ai/mcp --client claude-code
    ```

    Restart Claude Code for the MCP to load.
  </Tab>

  <Tab title="Cursor">
    ```bash theme={null}
    npx -y install-mcp@latest https://docs.tinyfish.ai/mcp --client cursor
    ```
  </Tab>

  <Tab title="Windsurf">
    ```bash theme={null}
    npx -y install-mcp@latest https://docs.tinyfish.ai/mcp --client windsurf
    ```
  </Tab>

  <Tab title="Claude Desktop">
    ```bash theme={null}
    npx -y install-mcp@latest https://docs.tinyfish.ai/mcp --client claude
    ```
  </Tab>
</Tabs>

<Accordion title="Manual configuration" icon="gear">
  <Tabs>
    <Tab title="Claude Code">
      ```bash theme={null}
      claude mcp add --transport http tinyfish-docs https://docs.tinyfish.ai/mcp
      ```
    </Tab>

    <Tab title="Cursor">
      Add to your Cursor MCP settings:

      ```json theme={null}
      {
        "mcpServers": {
          "tinyfish-docs": {
            "url": "https://docs.tinyfish.ai/mcp"
          }
        }
      }
      ```
    </Tab>

    <Tab title="Windsurf">
      Add to `~/.codeium/windsurf/mcp_config.json` (macOS/Linux) or `%USERPROFILE%\.codeium\windsurf\mcp_config.json` (Windows):

      ```json theme={null}
      {
        "mcpServers": {
          "tinyfish-docs": {
            "serverUrl": "https://docs.tinyfish.ai/mcp"
          }
        }
      }
      ```
    </Tab>

    <Tab title="Claude Desktop">
      Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

      ```json theme={null}
      {
        "mcpServers": {
          "tinyfish-docs": {
            "url": "https://docs.tinyfish.ai/mcp"
          }
        }
      }
      ```
    </Tab>
  </Tabs>
</Accordion>

***

## Integration Prompt

Use this prompt to have your AI assistant generate TinyFish Web Agent integration code tailored to your project.

<Note>
  Copy the entire code block and paste it into Claude, ChatGPT, Cursor, or any AI coding assistant.
</Note>

<Accordion title="Expand to copy prompt" icon="clipboard">
  ````
  I need help integrating TinyFish Web Agent into my project. TinyFish Web Agent is a web automation API that uses natural language to control browsers - no CSS selectors or XPath needed.

  **TinyFish Web Agent capabilities:**
  - Navigate to websites and perform actions (clicks, form fills, scrolling)
  - Extract structured data from any page as JSON
  - Handle multi-step workflows with a single API call
  - Work on authenticated and bot-protected sites

  Please ask me these questions first:

  1. What am I building?
     - Data extraction / scraping
     - Form automation
     - Web monitoring
     - AI agent with web browsing
     - Something else

  2. Which endpoint should I use?
     - Synchronous (/run) - wait for result, simple code
     - Async (/run-async) - start task, poll for result later
     - Streaming (/run-sse) - real-time progress updates

  3. What's my tech stack?
     - TypeScript / JavaScript
     - Python
     - Other

  4. Will I need anti-detection?
     - No - standard websites
     - Yes - sites with Cloudflare, CAPTCHAs, or bot protection

  Then generate code using these patterns:

  ---

  **Environment Setup**

  ```bash
  # Get your API key at https://agent.tinyfish.ai/api-keys
  # Add to .env file:
  TINYFISH_API_KEY=sk-tinyfish-*****
  ```

  ---

  **TypeScript - Streaming (Recommended)**

  ```typescript
  import { TinyFish, EventType, RunStatus } from "@tiny-fish/sdk";

  const client = new TinyFish();  // Reads TINYFISH_API_KEY from environment

  async function runAutomation(url: string, goal: string) {
    const stream = await client.agent.stream({ url, goal });

    for await (const event of stream) {
      if (event.type === EventType.PROGRESS) {
        console.log(`Action: ${event.purpose}`);
      } else if (event.type === EventType.COMPLETE) {
        if (event.status === RunStatus.COMPLETED) {
          return event.result;
        }
        throw new Error(event.error?.message || "Automation failed");
      }
    }
  }

  // Example usage
  const products = await runAutomation(
    "https://example.com/products",
    "Extract all product names and prices as JSON"
  );
  ```

  ---

  **TypeScript - Synchronous**

  ```typescript
  import { TinyFish, RunStatus } from "@tiny-fish/sdk";

  const client = new TinyFish();  // Reads TINYFISH_API_KEY from environment

  async function runAutomation(url: string, goal: string) {
    const run = await client.agent.run({ url, goal });
    if (run.status === RunStatus.COMPLETED) return run.result;
    throw new Error(run.error?.message || "Automation failed");
  }
  ```

  ---

  **Python - Streaming**

  ```python
  from tinyfish import TinyFish, EventType, RunStatus

  client = TinyFish()  # Reads TINYFISH_API_KEY from environment

  def run_automation(url: str, goal: str):
      with client.agent.stream(url=url, goal=goal) as stream:
          for event in stream:
              if event.type == EventType.PROGRESS:
                  print(f"Action: {event.purpose}")
              elif event.type == EventType.COMPLETE:
                  if event.status == RunStatus.COMPLETED:
                      return event.result_json
                  raise Exception(event.error)

  # Example usage
  products = run_automation(
      "https://example.com/products",
      "Extract all product names and prices as JSON"
  )
  ```

  ---

  **Python - Synchronous**

  ```python
  from tinyfish import TinyFish, RunStatus

  client = TinyFish()  # Reads TINYFISH_API_KEY from environment

  def run_automation(url: str, goal: str):
      result = client.agent.run(url=url, goal=goal)
      if result.status == RunStatus.COMPLETED:
          return result.result
      raise Exception(result.error)
  ```

  ---

  **Anti-Detection Mode**

  For sites with bot protection, add stealth mode and proxy:

  ```typescript
  import { BrowserProfile, ProxyCountryCode } from "@tiny-fish/sdk";

  const run = await client.agent.run({
    url: "https://protected-site.com",
    goal: "Extract pricing data",
    browser_profile: BrowserProfile.STEALTH,
    proxy_config: {
      enabled: true,
      country_code: ProxyCountryCode.US,  // Also: GB, CA, DE, FR, JP, AU
    },
  });
  ```

  ---

  **Writing Good Goals**

  Be specific about what you want:

  ```
  // Good - specific output format
  "Extract product name, price, and availability. Return as JSON array."

  // Good - multi-step with numbered actions
  "1. Click 'Load More' 3 times  2. Extract all product cards  3. Return as JSON"

  // Bad - too vague
  "Get the data"
  ```

  ---

  **Quick Test**

  ```bash
  curl -N -X POST https://agent.tinyfish.ai/v1/automation/run-sse \
    -H "X-API-Key: $TINYFISH_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "url": "https://scrapeme.live/shop",
      "goal": "Extract the first 3 product names and prices"
    }'
  ```

  ---

  After asking the questions, generate the appropriate code for my use case. Reference https://docs.tinyfish.ai for additional details.
  ````
</Accordion>

***

## When to Use TinyFish Web Agent

TinyFish Web Agent excels at tasks that require a real browser with full JavaScript execution.

| Use Case                        | Example                                              |
| ------------------------------- | ---------------------------------------------------- |
| **Multi-step workflows**        | Login → navigate to dashboard → extract account data |
| **JavaScript-rendered content** | SPAs, infinite scroll, lazy-loaded content           |
| **Interactive elements**        | Click dropdowns, dismiss modals, paginate results    |
| **Authenticated sessions**      | Access content behind login walls                    |
| **Bot-protected sites**         | Cloudflare, DataDome protected pages                 |

***

## Writing Goals for AI Agents

When your AI generates goals for TinyFish Web Agent, follow these patterns for reliable results.

### Specify Output Schema

```
Extract product data and return as JSON matching this structure:
{
  "product_name": "string",
  "price": number or null,
  "in_stock": boolean
}
```

### Include Termination Conditions

```
Stop when ANY of these is true:
- You have extracted 20 items
- No more "Load More" button exists
- You have processed 5 pages
- The page shows a login prompt
```

### Handle Edge Cases

```
If price shows "Contact Us" or "Request Quote":
  Set price to null
  Set price_type to "contact_required"

If a CAPTCHA appears:
  Stop immediately
  Return partial results with an error flag
```

### Request Structured Errors

```
If extraction fails, return:
{
  "success": false,
  "error_type": "timeout" or "blocked" or "not_found",
  "error_message": "Description of what went wrong",
  "partial_results": [any data captured before failure]
}
```

***

## Parsing Results

When your AI receives results from TinyFish Web Agent, handle both success and failure cases.

### Success Response

```json theme={null}
{
  "status": "COMPLETED",
  "result": {
    "products": [
      { "name": "Widget", "price": 29.99, "in_stock": true }
    ]
  }
}
```

### Goal Failure

The browser worked, but the goal wasn't achieved. Try a different approach or inform the user.

```json theme={null}
{
  "status": "COMPLETED",
  "result": {
    "success": false,
    "error_type": "not_found",
    "error_message": "No products found on this page"
  }
}
```

### Infrastructure Failure

The browser itself failed. Retry with stealth mode or a proxy.

```json theme={null}
{
  "status": "FAILED",
  "error": {
    "message": "Navigation timeout"
  }
}
```

***

## Next Steps

<CardGroup>
  <Card title="Quick Start" icon="rocket" href="/quick-start">
    Manual step-by-step setup
  </Card>

  <Card title="Prompting Guide" icon="bullseye" href="/prompting-guide">
    Write goals that work on the first try
  </Card>

  <Card title="MCP Integration" icon="robot" href="/mcp-integration">
    Connect with Claude and Cursor
  </Card>

  <Card title="API Reference" icon="code" href="/api-reference">
    Full endpoint documentation
  </Card>
</CardGroup>


# Connect Your Vault
Source: https://docs.tinyfish.ai/vault-setup

Connect your password manager so TinyFish can securely log into websites during automations

TinyFish can log into websites on your behalf using credentials from your existing password manager. Connect your vault once, then select which credentials to use for each run.

<Note>
  Vault credentials are currently supported in the Playground and REST API. Python SDK, TypeScript SDK, and CLI support is coming soon.
</Note>

## How It Works

Connect your password manager account, TinyFish syncs your vault items, and then you select specific credentials for each run. Each run only gets the credentials you explicitly choose, so no run has access to your full vault.

<img alt="Vault settings page with Connect a password manager button" />

## Connect Your Provider

<Note>More providers coming soon.</Note>

<Tabs>
  <Tab title="Dashboard">
    In TinyFish, go to **Settings > Vault** and click **Connect a password manager**.

    <img alt="Provider selection dialog showing 1Password and Bitwarden options" />

    <AccordionGroup>
      <Accordion title="1Password" icon="key">
        Paste your Service Account Token (starts with `ops_`), then click **Connect**.

        <img alt="1Password credentials form with Service Account Token field" />

        Your items sync automatically. Confirm they appear grouped by vault name.

        <img alt="Vault settings with connected 1Password showing credentials grouped by vault" />

        <Tip>
          Need a token? Create a service account with read access to your vault. See the [1Password service account docs](https://developer.1password.com/docs/service-accounts/).
        </Tip>
      </Accordion>

      <Accordion title="Bitwarden" icon="shield-halved">
        Enter your `Client ID`, `Client Secret`, and `Master Password`, then click **Connect**.

        Use the format `user.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` for the Client ID.

        <img alt="Bitwarden credentials form with Client ID, Client Secret, and Master Password fields" />

        If you use a self-hosted instance, toggle **Self-hosted server** and enter your server URL.

        <img alt="Vault settings with connected Bitwarden showing synced credentials" />

        <Tip>
          Find your API key in Bitwarden under `Settings` > `Security` > `Keys` > `View API Key`. See the [Bitwarden personal API key guide](https://bitwarden.com/help/personal-api-key/).
        </Tip>

        <Note>
          The first sync may take up to 15 seconds. Subsequent syncs are faster.
        </Note>
      </Accordion>
    </AccordionGroup>
  </Tab>

  <Tab title="API">
    Connect a provider programmatically with `POST /v1/vault/connections`. Credentials are validated immediately — if they're invalid, the request fails with a `400`.

    <CodeGroup>
      ```bash 1Password theme={null}
      curl -X POST https://agent.tinyfish.ai/v1/vault/connections \
        -H "X-API-Key: $TINYFISH_API_KEY" \
        -H "Content-Type: application/json" \
        -d '{
          "provider": "1password",
          "token": "ops_your_service_account_token"
        }'
      ```

      ```bash Bitwarden theme={null}
      curl -X POST https://agent.tinyfish.ai/v1/vault/connections \
        -H "X-API-Key: $TINYFISH_API_KEY" \
        -H "Content-Type: application/json" \
        -d '{
          "provider": "bitwarden",
          "clientId": "user.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
          "clientSecret": "your_client_secret",
          "masterPassword": "your_master_password"
        }'
      ```

      ```bash Bitwarden (self-hosted) theme={null}
      curl -X POST https://agent.tinyfish.ai/v1/vault/connections \
        -H "X-API-Key: $TINYFISH_API_KEY" \
        -H "Content-Type: application/json" \
        -d '{
          "provider": "bitwarden",
          "clientId": "user.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
          "clientSecret": "your_client_secret",
          "masterPassword": "your_master_password",
          "serverUrl": "https://bitwarden.example.com"
        }'
      ```
    </CodeGroup>

    A successful response includes the `connectionId` and the initial list of synced items:

    ```json theme={null}
    {
      "connectionId": "a1b2c3d4-5678-90ab-cdef-1234567890ab",
      "connected": true,
      "provider": "1password",
      "items": [
        {
          "item_id": "cred:a1b2c3d4-5678-90ab-cdef-1234567890ab:Personal:item-xyz",
          "label": "Amazon Login",
          "vault_name": "Personal",
          "websites": ["https://amazon.com"],
          "has_totp": false,
          "connectionId": "a1b2c3d4-5678-90ab-cdef-1234567890ab"
        }
      ]
    }
    ```

    If the connection already exists for the same provider, it is replaced — not duplicated.
  </Tab>
</Tabs>

## Managing Your Vault

<Tabs>
  <Tab title="Dashboard">
    ### Sync

    Click `Sync` to fetch the latest items from your connected provider.

    ### Disconnect

    Click `Disconnect` and confirm to remove the provider. All cached credentials are removed immediately, but runs already in progress are not affected. You can reconnect at any time.
  </Tab>

  <Tab title="API">
    ### List connections

    ```bash theme={null}
    curl https://agent.tinyfish.ai/v1/vault/connections \
      -H "X-API-Key: $TINYFISH_API_KEY"
    ```

    ```json theme={null}
    {
      "connections": [
        {
          "id": "a1b2c3d4-5678-90ab-cdef-1234567890ab",
          "provider": "1password",
          "connectionStatus": "active",
          "lastValidatedAt": "2026-04-10 12:00:00"
        }
      ]
    }
    ```

    ### List vault items

    Retrieve the credential items available for runs. These are read from the local cache, so the response is fast.

    ```bash theme={null}
    curl https://agent.tinyfish.ai/v1/vault/items \
      -H "X-API-Key: $TINYFISH_API_KEY"
    ```

    ```json theme={null}
    {
      "items": [
        {
          "itemId": "cred:a1b2c3d4-5678-90ab-cdef-1234567890ab:Personal:item-xyz",
          "connectionId": "a1b2c3d4-5678-90ab-cdef-1234567890ab",
          "label": "Amazon Login",
          "vaultName": "Personal",
          "domains": ["amazon.com"],
          "fieldMetadata": [
            { "fieldId": "username", "label": "username", "type": "STRING" },
            { "fieldId": "password", "label": "password", "type": "STRING" }
          ],
          "hasTotp": false
        }
      ]
    }
    ```

    The `itemId` is the value you pass as `credential_item_ids` when [starting a run](/key-concepts/credentials#using-the-api).

    <Note>
      Items without website URLs in your password manager will still sync, but they won't have any `domains` and can't be matched to a site during a run.
    </Note>

    ### Sync items

    Pull the latest state from your connected providers. Use this before starting a run if you've recently changed passwords.

    ```bash theme={null}
    curl -X POST https://agent.tinyfish.ai/v1/vault/items/sync \
      -H "X-API-Key: $TINYFISH_API_KEY"
    ```

    ```json theme={null}
    {
      "items": [ ... ],
      "sync_summary": {
        "added": 3,
        "updated": 1,
        "removed": 0
      }
    }
    ```

    ### Disconnect a provider

    Removes the connection and all cached credentials. Runs already in progress are not affected.

    ```bash theme={null}
    curl -X DELETE https://agent.tinyfish.ai/v1/vault/connections/a1b2c3d4-5678-90ab-cdef-1234567890ab \
      -H "X-API-Key: $TINYFISH_API_KEY"
    ```

    ```json theme={null}
    {
      "disconnected": true,
      "connectionId": "a1b2c3d4-5678-90ab-cdef-1234567890ab"
    }
    ```
  </Tab>
</Tabs>

## Using the Vault API

### Quick start

Connect a provider, retrieve item IDs, and start a run with specific credentials:

```bash theme={null}
# 1. Connect your vault (one-time setup)
curl -X POST https://agent.tinyfish.ai/v1/vault/connections \
  -H "X-API-Key: $TINYFISH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "provider": "1password", "token": "ops_your_token" }'
# → returns connectionId and initial items

# 2. List available credentials (reads from cache — fast)
curl -s https://agent.tinyfish.ai/v1/vault/items \
  -H "X-API-Key: $TINYFISH_API_KEY"
# → grab the itemId for the credential you need

# 3. Start a run with that credential
curl -X POST https://agent.tinyfish.ai/v1/automation/run \
  -H "X-API-Key: $TINYFISH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.linkedin.com",
    "goal": "Log in and capture the latest 3 posts from the feed",
    "use_vault": true,
    "credential_item_ids": [
      "cred:a1b2c3d4-5678-90ab-cdef-1234567890ab:Work:item-linkedin"
    ]
  }'
```

### Matching credentials to URLs

Filter items by the `domains` field to find the right credential for your target site:

```bash theme={null}
curl -s https://agent.tinyfish.ai/v1/vault/items \
  -H "X-API-Key: $TINYFISH_API_KEY" \
  | jq '.items[] | select(.domains[] | contains("linkedin.com")) | .itemId'
```

Scoping to specific `credential_item_ids` is more reliable than `use_vault: true` alone — it prevents the agent from picking the wrong login when you have multiple accounts on the same domain.

### When to sync

`GET /v1/vault/items` reads from a local cache and is fast. You don't need to sync before every run.

Call `POST /v1/vault/items/sync` when:

* You've recently changed a password in your vault
* You've added new credentials you want to use
* A run failed to log in and you suspect stale credentials

For most pipelines, syncing once at startup or on a daily schedule is sufficient.

### Handling expired connections

Provider tokens can expire. When they do, `POST /v1/vault/items/sync` returns a `401`. Your pipeline should:

1. Catch the `401` from sync
2. Re-connect with `POST /v1/vault/connections` using a fresh token
3. Retry the sync

1Password service account tokens don't expire unless revoked. Bitwarden tokens may expire based on your server configuration.

## Troubleshooting

<AccordionGroup>
  <Accordion title="Connection failed — invalid credentials" icon="xmark">
    For 1Password, verify the token starts with `ops_` and has read access to the vault you want to sync.

    For Bitwarden, verify that the `Client ID` and `Client Secret` match the same API key.

    The API returns a `400` with `"Invalid vault token"` when credentials fail validation.
  </Accordion>

  <Accordion title="Vault items not appearing after sync" icon="circle-question">
    Vault items must have website URLs in your password manager to sync into TinyFish.

    Credentials without URLs are not synced.
  </Accordion>

  <Accordion title="Self-hosted Bitwarden not connecting" icon="server">
    Ensure the server URL includes `https://` and that the server is accessible from TinyFish.
  </Accordion>

  <Accordion title="Token expired or reconnect required" icon="rotate">
    Provider tokens can expire. Disconnect the provider, then reconnect using a fresh token or updated credentials.

    `POST /v1/vault/items/sync` returns a `401` when all connections require reconnect and no items can be returned.
  </Accordion>

  <Accordion title="First sync is slow" icon="clock">
    The first Bitwarden sync can take up to 15 seconds while the connection initializes. Subsequent syncs are faster.
  </Accordion>

  <Accordion title="All providers already connected" icon="link">
    You can connect a maximum of 2 providers at the same time.
  </Accordion>

  <Accordion title="API returns 404 on vault items" icon="circle-exclamation">
    No vault connections exist yet. Connect a provider first with `POST /v1/vault/connections`.
  </Accordion>

  <Accordion title="API returns 503" icon="server">
    The vault integration is unavailable or the backing vault service returned an error.
  </Accordion>
</AccordionGroup>

## Related

<CardGroup>
  <Card title="Vault Credentials" icon="key" href="/key-concepts/credentials">
    Learn how credentials are selected and used in runs
  </Card>

  <Card title="Authentication" icon="lock" href="/authentication">
    Understand TinyFish authentication methods
  </Card>
</CardGroup>


# Webhooks
Source: https://docs.tinyfish.ai/webhooks

Get notified when runs complete, fail, or are cancelled

Webhooks let you receive an HTTP callback when a run reaches a terminal state, so you don't need to poll for results.

## How It Works

1. Pass a `webhook_url` when you create a run
2. When the run finishes (`COMPLETED`, `FAILED`, or `CANCELLED`), TinyFish sends a `POST` request to your URL
3. The payload contains the full run data — the same shape as `GET /v1/runs/{id}`

<Info>
  Webhook delivery is non-blocking. If your endpoint is down, the run still succeeds — you can always fetch the result via the API.
</Info>

***

## Configuration

Add `webhook_url` to any run creation endpoint. The URL must use HTTPS.

```bash theme={null}
curl -X POST "https://agent.tinyfish.ai/v1/automation/run-async" \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "goal": "Extract the page title",
    "webhook_url": "https://your-server.com/webhooks/tinyfish"
  }'
```

Webhooks are supported on all run endpoints: `/run`, `/run-async`, `/run-sse`, and `/run-batch`.

***

## Payload

Your endpoint receives a `POST` request with `Content-Type: application/json`:

```json theme={null}
{
  "event": "run.completed",
  "run_id": "4562765d-156e-4c47-b217-55b3ec4a9720",
  "status": "COMPLETED",
  "data": {
    "run_id": "4562765d-156e-4c47-b217-55b3ec4a9720",
    "status": "COMPLETED",
    "goal": "Extract the page title",
    "created_at": "2026-03-25T10:30:00Z",
    "started_at": "2026-03-25T10:30:05Z",
    "finished_at": "2026-03-25T10:30:45Z",
    "num_of_steps": 3,
    "result": { "title": "Example Domain" },
    "error": null,
    "streaming_url": "https://tf-abc123.fra0-tinyfish.unikraft.app/stream/0",
    "browser_config": {
      "proxy_enabled": false,
      "proxy_country_code": null
    },
    "steps": [
      {
        "id": "09de224d-fb2b-45b7-b067-585726194a2e",
        "timestamp": "2026-03-25T10:30:05Z",
        "status": "COMPLETED",
        "action": "Navigate to https://example.com",
        "screenshot": null,
        "duration": "1.2s"
      }
    ]
  }
}
```

### Minimal Example

A simplified view of the webhook payload with just the key fields:

```json theme={null}
{
  "event": "run.completed",
  "run_id": "run_abc123",
  "status": "COMPLETED",
  "data": {
    "started_at": "2026-01-15T10:30:00Z",
    "finished_at": "2026-01-15T10:30:45Z",
    "result": {
      "product_name": "Example Product",
      "price": 29.99
    },
    "error": null
  }
}
```

### Event Types

| Event           | When                                   |
| --------------- | -------------------------------------- |
| `run.completed` | Run finished (check `result` for data) |
| `run.failed`    | Infrastructure error occurred          |
| `run.cancelled` | Run was manually cancelled             |

### Payload Fields

| Field         | Type           | Description                                       |
| ------------- | -------------- | ------------------------------------------------- |
| `event`       | string         | Event type (e.g. `run.completed`)                 |
| `run_id`      | string         | Unique run identifier                             |
| `status`      | string         | `COMPLETED`, `FAILED`, or `CANCELLED`             |
| `data`        | object         | Full run data — same shape as `GET /v1/runs/{id}` |
| `data.result` | object \| null | Extracted data (when completed)                   |
| `data.error`  | object \| null | Error details (when failed)                       |
| `data.steps`  | array          | List of actions the agent took                    |

<Note>
  Screenshots are not included in webhook payloads to keep the payload size small. To get screenshots, call `GET /v1/runs/{id}?screenshots=base64` after receiving the webhook.
</Note>

***

## Error Payload

When a run fails, `data.error` contains details about what went wrong:

```json theme={null}
{
  "event": "run.failed",
  "run_id": "run-2",
  "status": "FAILED",
  "data": {
    "error": {
      "message": "Site blocked access",
      "category": "AGENT_FAILURE"
    },
    "result": null
  }
}
```

***

## Retry Behavior

TinyFish retries failed webhook deliveries automatically:

| Behavior       | Detail                       |
| -------------- | ---------------------------- |
| Total attempts | 4 (1 initial + 3 retries)    |
| Backoff        | Exponential: 1s, 2s, 4s      |
| Timeout        | 10 seconds per attempt       |
| 4xx responses  | No retry (fails immediately) |
| 5xx responses  | Retried with backoff         |
| Network errors | Retried with backoff         |

***

## Receiving Webhooks

Here's how to handle webhook events on your server:

<CodeGroup>
  ```typescript Express theme={null}
  import express from "express";

  const app = express();
  app.use(express.json());

  app.post("/webhooks/tinyfish", (req, res) => {
    const { event, run_id, data } = req.body;

    switch (event) {
      case "run.completed":
        console.log(`Run ${run_id} completed:`, data.result);
        // Process the result
        break;
      case "run.failed":
        console.error(`Run ${run_id} failed:`, data.error?.message);
        // Handle the error
        break;
      case "run.cancelled":
        console.log(`Run ${run_id} was cancelled`);
        break;
    }

    // Respond quickly — TinyFish has a 10s timeout
    res.status(200).send("OK");
  });
  ```

  ```python Flask theme={null}
  from flask import Flask, request

  app = Flask(__name__)

  @app.route("/webhooks/tinyfish", methods=["POST"])
  def handle_webhook():
      payload = request.json
      event = payload["event"]
      run_id = payload["run_id"]
      data = payload["data"]

      if event == "run.completed":
          print(f"Run {run_id} completed:", data["result"])
          # Process the result
      elif event == "run.failed":
          print(f"Run {run_id} failed:", data.get("error", {}).get("message"))
          # Handle the error
      elif event == "run.cancelled":
          print(f"Run {run_id} was cancelled")

      # Respond quickly — TinyFish has a 10s timeout
      return "OK", 200
  ```
</CodeGroup>

***

## Best Practices

<AccordionGroup>
  <Accordion title="Respond within 10 seconds">
    TinyFish waits up to 10 seconds for your response. Do heavy processing asynchronously — acknowledge the webhook immediately and handle the data in the background.
  </Accordion>

  <Accordion title="Handle duplicates idempotently">
    In rare cases (network retries, server restarts), you may receive the same webhook more than once. Use `run_id` to deduplicate.
  </Accordion>

  <Accordion title="Verify by fetching the run">
    For sensitive workflows, confirm the webhook data by calling `GET /v1/runs/{run_id}` before acting on the payload.
  </Accordion>

  <Accordion title="Return 2xx to acknowledge">
    Any 2xx response acknowledges the webhook. Non-2xx responses trigger retries (except 4xx, which fail immediately).
  </Accordion>
</AccordionGroup>

***

## Related

<CardGroup>
  <Card title="Runs" icon="play" href="/key-concepts/runs">
    Understand run lifecycle and statuses
  </Card>

  <Card title="Endpoints" icon="plug" href="/key-concepts/endpoints">
    Choose sync, async, or streaming
  </Card>
</CardGroup>
