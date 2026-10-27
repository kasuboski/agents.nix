---
name: develop-testing-strategy
description: Generates a project-specific testing strategy based on the Purity & Extent framework. Analyzes architecture to output data-driven testing guidelines and `check` idiom code patterns.
---

## 🎯 Objective
Create a highly resilient, project-specific testing strategy based on the "Purity and Extent" testing framework. The output must guide developers to test application **features** (not internal code), ruthlessly optimize for **purity** (Value In, Value Out), and minimize brittle, mock-heavy integration tests.

## 📥 Inputs & Context Gathering
This skill can be invoked in two contexts. The agent must determine the context and gather information accordingly:

**Context A: Greenfield / External Request**
If the user is asking about a hypothetical project or provides a spec in the prompt, ensure you have:
1. **Project Architecture:** How the system works, its core modules, and IO boundaries.
2. **Programming Language / Framework:** To generate accurate code examples.

**Context B: Existing Codebase (Agent inside an IDE or Repo)**
If you are operating within a user's workspace (e.g., Cursor, Copilot, or CLI agent), **do not ask the user for this information.** Instead, proactively use your tools to discover it:
1. **Identify Stack:** Read manifest files (`Cargo.toml`, `package.json`, `gleam.toml`, `mix.exs`, `go.mod`, etc.) to determine the language and primary testing framework.
2. **Discover Architecture:** Read `README.md`, `docs/architecture.md`, or scan the core module structures (e.g., `src/`, `lib/`) to identify where the pure domain logic lives and where the system touches IO (DB, network, file system).

---

## 🧠 Core Philosophy (The Agent's Knowledge Base)
When generating the strategy, you must strictly adhere to and enforce the following principles:

1. **The Neural Network Test (Extent):** Tests must be agnostic to implementation. If the entire internal architecture is replaced by an opaque black box (like an ML model) that produces the correct output, the test suite should still pass without modification.
2. **Ruthless Purity:** IO (network, disk, concurrency) makes tests slow and flaky. Architect tests to target the "pure logic" core. Separate the logic engine (fast, testable) from the effect runner (slow).
3. **The `check` Idiom:** Prevent "Test Ossification". Tests must not directly call public setup functions over and over. Instead, define one centralized `check_xyz` function per domain. If the API changes, only the `check` function needs updating, not the 500 tests.
4. **Data-Driven & Externalized:** Test cases should be driven by external data files (JSON, YAML, Markdown) rather than inline code.
5. **No Mocks for IO:** Mocks couple tests to implementation details. Use "Expect Testing" (Golden files), Data-Driven Stubs, or "Log Assertions" (Telemetry) instead of mocking network/disk layers.
6. **Explicit Slow Tests:** Tests requiring real IO are valid but must be separated into an explicit "slow suite" (integration tests) that is opted-into via CI configurations, not inline conditional logic (`if run_slow_tests() { ... }`).

---

## ⚙️ Execution Steps

To fulfill a request using this skill, follow these exact steps:

### Step 1: Architectural Analysis (Scan & Summarize)
Based on the provided spec OR your codebase discovery, identify and summarize:
* The core pure domain logic (where decisions are made).
* The IO boundaries (where the system touches networks, files, or external processes).
* The concurrency model (e.g., async/await, OTP actors, threads, goroutines).

### Step 2: Define Boundaries
Determine 3-4 specific testing boundaries for the project, moving from high purity to high extent. Name them explicitly based on the project's actual module names (e.g., `src/domain/pricing`).

### Step 3: Apply Testing Techniques
For each boundary, assign the correct testing technique from the core philosophy:
* *Pure Logic:* Scenario-driven external data files.
* *Messy Output/Serialization:* Expect/Golden File testing.
* *Concurrency/State:* Observability/Log Assertion patterns (do not use `sleep` or test process IDs).
* *Real IO:* Explicitly isolated slow/integration tests.

### Step 4: Draft Code Snippets
Create concrete, idiomatic code examples in the project's **detected or requested programming language**. You MUST include:
1. An example of the data-driven test format (e.g., a JSON scenario file).
2. The implementation of the `check` idiom (the centralized test harness).
3. How an individual test invokes the `check` function using the scenario.

### Step 5: Format the Output
Generate a structured Markdown Testing Guide. Use the following structure:
* **Part I: High-Level Axioms:** Explain the core philosophy tailored to the project's specific tech stack.
* **Part II: Area-Specific Guidelines:** Detail how to test the specific modules/boundaries identified in Step 2.
* **Part III: Practical Patterns:** Provide the code snippets from Step 4.

---

## 🚫 Constraints & Anti-Patterns
* **DO NOT** suggest using standard mocking libraries to mock internal functions.
* **DO NOT** suggest testing private functions.
* **DO NOT** suggest mixing fast and slow tests in the same suite.
* Ensure all code examples are strictly in the project's specific programming language.
