# Theme Brief Gold Set

Each file in this folder should represent a human-reviewed Theme Brief gold
example.

Recommended filename pattern:

- `<theme>-<period>.golden.json`

Required sections:

- `whatChanged`
- `whyItMatters`
- `evidence`
- `subtopicMovement`
- `relatedEntities`
- `risks`
- `watchpoints`
- `notebookHooks`

Recommended shape inside each section:

- `whatChanged`
  - array of `{ title, detail, importance }`
- `whyItMatters`
  - `{ summary, statements[] }`
- `evidence`
  - `{ requiredSourceClasses[], requiredClaims[], provenanceExpectations[], notes[] }`
- `subtopicMovement`
  - array of `{ subtheme, direction, rationale }`
- `relatedEntities`
  - `{ pathways[] }`, where each pathway has
    `{ entity, symbol?, relationType, note }`
- `risks`
  - array of `{ title, detail }`
- `watchpoints`
  - array of `{ horizon, trigger, implication }`
- `notebookHooks`
  - `{ suggestedTags[], prompts[] }`

The goal is not to freeze exact prose. The goal is to make the expected brief
contract and evidence burden explicit enough to catch regressions.
