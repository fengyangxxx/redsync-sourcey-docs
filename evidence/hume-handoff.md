# Frantic #33 Replacement Candidate Execution Record

This record supersedes earlier worker handoffs for the replacement candidate.
It is claim-neutral and carries no publication or delivery approval.

## Current Platform State

- `work_status`: `delivered`.
- `capacity`: `1`; `occupied`: `1`; `available`: `0`.
- `active`: `0`; `delivered`: `1`.
- No active claim or usable delivery deadline is represented by these bytes.

## Fixed Roles

- Gauss (`019f65c3-203f-7990-8feb-3cc1ee98d86c`, xhigh) owns implementation,
  local debugging, deterministic tests, and local evidence preparation.
- Dirac (`019f65c3-29ec-7181-9277-b251442a3250`, xhigh) is the independent QA
  gatekeeper. Only a fresh QA decision for the exact reviewed bytes can
  authorize the next governed stage.

## Candidate Lineage

- Current public parent: `2b58caa8d60147df494ce995f3777944a400b9a9`.
- Current candidate: the single replacement publication commit containing this
  record; its direct parent is `2b58caa8d60147df494ce995f3777944a400b9a9`.
- The rejected local candidate is retained only on its audit branch and is not
  part of this replacement branch's history.
- Pinned target: `go-redsync/redsync@79f6ba24a8bf41f35141de700d410a06bb27622f`.
- Public-host thesis: claimant-authored, project-named ReadTheDocs community
  documentation. It is not target-owned or official.
- PR #245 is an optional open and unmerged link proposal. It is not adoption,
  endorsement, or maintainer acceptance.

## Exact Outbound Plan

- Public repository: `https://github.com/fengyangxxx/redsync-sourcey-docs`.
- Destination ref: `refs/heads/fix/frantic33-governed-receipt-v3`.
- Expected pre-push state: branch absent.
- Workflow: `.github/workflows/validate-sourcey-adoption.yml`.
- Dispatch ref: `fix/frantic33-governed-receipt-v3`.
- Final delivery authorization: `false`.

## Required Governed Sequence

1. Revalidate the exact replacement candidate bytes and all live external state.
2. Obtain Dirac outbound-publication QA for the exact candidate commit.
3. Fresh-check that the destination branch is absent, push only the reviewed
   bytes, and require a ReadTheDocs build/deploy tied to the exact commit.
4. Dispatch the governed workflow exactly once on the recorded ref and require
   clean raw output, a complete receipt-status audit, byte-exact archive
   reconstruction, and successful root receipt verification.
5. Materialize immutable evidence for only that successful run, then obtain a
   separate full Dirac review of the exact payload.
6. Keep delivery authorization false unless the platform later exposes a valid
   claim or delivery path with fresh fields and a separate guarded-submit QA.

The candidate is not authorized for outbound use until the applicable fresh
Dirac QA record ends in `QA_DECISION: PASS`.
