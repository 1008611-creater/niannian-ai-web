---
name: post-coding-review
description: "Mandatory post-coding self-review for Codex after any code, script, skill, automation, or pipeline edit. Use before reporting completion whenever files were created or modified, especially after interrupted work, multi-step runners, delivery automation, generated artifacts, or production pipeline changes."
---

# Post Coding Review

## Purpose

Prevent incomplete code changes from being reported as done. This is a final engineering pass after implementation and before the final user-facing report whenever Codex changed files.

## Correctness-First Review

Review must first reconstruct the correct operating path, not only list how to repair the observed fault. For workflow, pipeline, provider, browser, or production tasks, start by answering: what should have happened if this step were done correctly? Then compare the actual path against that standard. A useful review identifies the right source artifact, the right entrypoint, the required readbacks/gates, the downstream artifact that should exist, and the evidence that proves it. Only after that should it list repair actions.

Bad review shape: "proxy failed, restart proxy." Good review shape: "this step should use the accepted storyboard image, locked prompt, verified provider settings, real submission, downloaded output, media probe, QA, and ledger; the current run stopped at browser access, so the missing next action is provider submission/download, not another planning pass."

## Required Review

1. Reconstruct the requested outcome in one sentence.
2. Reconstruct the correct operating path for the requested outcome before diagnosing the failure.
3. List the files intentionally changed, generated, or migrated.
4. Inspect the actual changed content, not only command output. Use `git diff` when available; if files are untracked, read the touched files or compare against the expected contract.
5. Check the end-to-end execution path:
   - entrypoint command;
   - downstream runner or worker command;
   - generated artifacts expected by the user;
   - packaging, scoring, reporting, or send path if applicable.
6. Look for a "stops too early" bug:
   - a runner says complete before the requested final artifact exists;
   - a plan-only smoke is being treated as real production;
   - a scorer/report expects files the runner never creates;
   - a packaging script scans latest/old files instead of current manifest paths;
   - a fallback path bypasses quality gates.
7. Verify with commands that match the risk:
   - syntax checks for changed scripts;
   - unit or smoke tests for logic;
   - dry-run/plan-only for orchestration;
   - manifest/schema inspection for packaging or delivery;
   - real execution only when credentials, time, and safety policy allow it.
8. Classify remaining blockers accurately:
   - `external_resource_failure` for missing runtime keys/tokens/services;
   - `infrastructure_failure` for runner/sandbox/startup failures;
   - `pipeline_runtime_packaging_gap` for missing runner files or missing final artifacts;
   - `quality_failure` only after real generated outputs prove a content issue.
9. Update durable docs/manifests when the change affects future runs.
10. If another thread or workspace must consume the fix, send a concrete handoff with file paths, sha/validation status when useful, and the exact remaining blocker.
11. In the final answer, state what was verified and what was not verified. Do not imply real production success from a structural smoke.

## Minimum Evidence

For small edits, minimum evidence is syntax check plus changed-file review.

For pipeline or delivery edits, minimum evidence is:

- changed-file review;
- syntax checks for all edited scripts;
- a dry-run or plan-only run that exercises the orchestration;
- inspection that expected downstream commands or artifacts are represented;
- explicit blocker status for any skipped real execution.

For user-facing delivery or batch production, do not finish until the actual package/send success is verified, unless a blocker is reported plainly.
