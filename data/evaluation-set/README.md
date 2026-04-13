# Evaluation Set v0

This folder contains the first human-reviewable gold set for the
trend-intelligence product branch.

The purpose is not benchmark theater. It is to keep the product from drifting
into plausible-but-unverifiable taxonomy labels, discovery decisions, and theme
briefs.

## Structure

- `theme-briefs/`
  - gold Theme Brief examples with the expected eight-section contract
  - each file should describe a real theme, period type, and the evidence
    classes required to justify the brief
- `theme-proposals/`
  - gold decision-flow examples for `propose`, `attach`, and `reject`
  - each item should state the expected decision, why, and which prompt/output
    contract points must remain true
- `discovery-quality/`
  - known-noise and known-genuine-emerging examples for discovery review
  - each item should state the expected disposition and why
- `taxonomy-coverage/`
  - manually checked article-to-theme labels
  - each item should include the expected canonical theme, parent, category,
    and a short rationale

## Intended Use

Use this set to answer:

- did taxonomy migration improve canonical coverage
- did discovery precision improve
- did Theme Brief quality regress
- did evidence-grounded text remain faithful
- did workflow-facing surfaces stay aligned with the Theme Brief contract

## Minimum Shape Expectations

- Theme Brief gold files
  - `theme`
  - `periodType`
  - `sections.whatChanged`
  - `sections.whyItMatters.summary`
  - `sections.evidence.requiredSourceClasses`
  - `sections.subtopicMovement`
  - `sections.relatedEntities.pathways`
  - `sections.risks`
  - `sections.watchpoints`
  - `sections.notebookHooks.suggestedTags`
- Discovery quality files
  - `datasetType`
  - `items[].label`
  - `items[].expectedDisposition`
  - `items[].rationale`
- Theme proposal flow files
  - `datasetType`
  - `items[].topicLabel`
  - `items[].expectedDecision`
  - `items[].promptMustCover`
  - `items[].expectedTargetTheme` for attach
  - `items[].expectedThemeId` for propose
- Taxonomy coverage files
  - `targetSampleSize`
  - `items[].title`
  - `items[].expectedTheme`
  - `items[].expectedParentTheme`
  - `items[].expectedCategory`

## Expected Growth

Initial target:

- 200 manually checked article labels
- 10 gold Theme Briefs
- 1 known-noise discovery file
- 1 known-genuine-emerging discovery file

The files in this folder are now a stronger v0, not a final benchmark. They
should keep growing as product, research, and taxonomy review become stricter.
