---
name: doc-coauthoring
description: "Structured co-authoring workflow for documents, proposals, specs, and decision docs. Use when helping the user write PRDs, design docs, RFCs, proposals, technical specs, or any structured document that benefits from iterative refinement."
---

# Document Co-authoring

A three-stage workflow for writing high-quality documents collaboratively.

## Stage 1: Context Gathering

Before writing anything, collect all relevant context:

1. **Ask what type of document** -- PRD, design doc, proposal, RFC, decision doc, report?
2. **Ask for existing context** -- links, notes, prior discussions, related documents, data
3. **Ask who the audience is** -- technical team, executives, customers, cross-functional?
4. **Ask about constraints** -- length, format, deadline, required sections

Read any linked files or URLs provided. Pull in relevant context from the workspace.

### Clarifying questions

Ask focused questions to fill gaps. Ask one at a time:

```
"What's the key decision this document needs to support?"
"Who needs to approve this?"
"What's the one thing the reader must walk away understanding?"
```

Stop gathering when you have enough to draft an outline.

## Stage 2: Iterative Refinement

Build the document section by section, not all at once.

### For each section:

1. **Brainstorm** -- generate 2-3 options for how to frame this section
2. **Present options** -- show the user numbered choices
3. **Draft** -- write the section based on their choice
4. **Review** -- ask if anything needs adjustment
5. **Move on** -- proceed to the next section

### Section iteration

```
"Here are three ways we could frame the problem statement:
1. Customer-pain focused: 'Users report...'
2. Metric-driven: 'Conversion dropped 15% because...'
3. Opportunity-based: 'If we solve X, we unlock Y...'

Which framing works best for your audience?"
```

### Gap check

After every 3 sections, do a gap check:
- "Is there anything we've missed so far?"
- "Does the flow make sense from the reader's perspective?"
- "Any sections that need rethinking?"

### Quality check

After 3 consecutive iterations with no changes, the section is stable. Move on.

## Stage 3: Reader Testing

Before finalizing, test the document for blind spots:

1. **Spawn a fresh agent** (via `spawn`) with no context from the conversation
2. Give it only the document and ask:
   - "What questions does this leave unanswered?"
   - "What assumptions does it make that should be stated?"
   - "Is there anything confusing or ambiguous?"
3. **Review the feedback** with the user
4. **Address any valid gaps**

If spawning an agent is not practical, mentally simulate a fresh reader: pretend you have never seen this conversation and read the document from scratch.

## Document Types

### PRD (Product Requirements Document)
Sections: Problem, Users, Goals, Non-goals, Requirements, Success metrics, Open questions

### Design Doc
Sections: Context, Goals, Design overview, Detailed design, Alternatives considered, Risks, Timeline

### Decision Doc
Sections: Context, Options (with pros/cons), Recommendation, Decision, Next steps

### RFC (Request for Comments)
Sections: Summary, Motivation, Detailed design, Drawbacks, Alternatives, Unresolved questions

### Proposal
Sections: Executive summary, Problem, Proposed solution, Cost/effort, Timeline, Risks

## Tips

- Start with the executive summary, even if it changes later -- it forces clarity
- Write for skimmers: bold key points, use headers, keep paragraphs short
- Every section should answer "so what?" for the reader
- Link to supporting data rather than embedding it (keeps the doc scannable)
