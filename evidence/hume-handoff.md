# Frantic #33 Current Candidate Execution Record

This record supersedes every earlier worker handoff for Frantic #33. The live
claim is active, but there is no publication approval or delivery approval.

## Active Claim

- ClaimId: `4ec19597-79e9-499b-a932-d91fc0150881`.
- ClaimedAt: `2026-07-16T19:14:58.021Z`.
- FuseExpiresAt: `2026-07-17T00:14:58.021Z`.
- DeliverDeadlineAt: `2026-07-17T00:14:58.021Z`.

## Fixed Roles

- Gauss (`019f65c3-203f-7990-8feb-3cc1ee98d86c`, xhigh) owns implementation,
  local debugging, deterministic tests, and local evidence preparation.
- Dirac (`019f65c3-29ec-7181-9277-b251442a3250`, xhigh) is the independent QA
  gatekeeper. Only a fresh QA decision for the exact reviewed bytes can
  authorize the next governed stage.

## Candidate Lineage

- Current public parent: `2a572fee31bb273b3c16333c3a869798e8c5227f`.
- Current candidate: the single post-claim publication commit containing this
  record; its direct parent is `2a572fee31bb273b3c16333c3a869798e8c5227f`.
- Earlier local remediation commits are historical review milestones only and
  are not the publication history to push.
- Pinned target: `go-redsync/redsync@79f6ba24a8bf41f35141de700d410a06bb27622f`.
- Public-host thesis: claimant-authored, project-named ReadTheDocs community
  documentation. It is not target-owned or official.
- PR #245 is an optional open and unmerged link proposal. It is not adoption,
  endorsement, or maintainer acceptance.

## Required Governed Sequence

1. Revalidate the exact post-claim candidate bytes and all live external state.
2. Obtain Dirac outbound-publication QA for the exact candidate commit.
3. Push only those reviewed bytes and require a ReadTheDocs build/deploy tied
   to that exact commit.
4. Dispatch the governed workflow exactly once and require clean raw output,
   a complete receipt-status audit, byte-exact archive reconstruction, and
   successful root receipt verification.
5. Materialize immutable evidence for only that successful run, then obtain a
   separate full Dirac final-delivery QA PASS on the exact payload.
6. Use the guarded Frantic delivery path before the recorded deadline.

The candidate is not complete or authorized for outbound use until the
applicable fresh Dirac QA record ends in `QA_DECISION: PASS`.
