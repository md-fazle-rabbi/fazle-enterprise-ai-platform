# ADR-036: Retrieval order and the sparse query

Status: Accepted (2026-10-15)

## Context
A RAGAS run scored context precision 0.70 against a floor of 0.80. Looking for the cause
found three separate defects in retrieval.

1. `expand_to_parents` loaded the matched chunks with `WHERE id IN (...)` and no `ORDER BY`.
   The database returned them in storage order, so the ranking from hybrid search was thrown
   away before the context was built. Generation, the `[1]` and `[2]` citation numbers, CRAG
   grading and the order RAGAS scores all followed storage order. In the evaluation corpus the
   chunk that answers the Reciprocal Rank Fusion question and the sparse search question is
   stored last, so it always came second.
2. The sparse half of the search used `plainto_tsquery`, which joins every word of the
   question with AND. One word missing from a chunk ("value", "catch") removed it from the
   sparse results. Checked with SQL against the three corpus chunks: for the Reciprocal Rank
   Fusion, application layer and sparse search questions no chunk matched at all, so hybrid
   search was dense only for 3 of the 5 golden questions.
3. When two chunks swap places between the two lists (dense 1 and sparse 2, against dense 2
   and sparse 1) their fused scores are identical. The winner was whichever chunk the loop saw
   first, so the order depended on insertion order and not on evidence.

## Decision
1. `expand_to_parents` sorts the matched chunks by their position in `chunk_ids`, which is the
   search ranking. When several matches share a section, the best ranked one anchors it.
2. The sparse query keeps the parsing, stemming and stop word removal of `plainto_tsquery`,
   then joins the lexemes with OR instead of AND:
   `to_tsquery('simple', replace(plainto_tsquery('english', :q)::text, ' & ', ' | '))`.
   `ts_rank_cd` ranks a chunk that matches more of the words higher, and the chunk id breaks
   ties inside the sparse list. A question made only of stop words gives an empty query and
   no sparse results, and the dense half still answers.
3. Reciprocal Rank Fusion breaks equal scores by the better rank in the last list (sparse in
   `hybrid_search`), then by the earlier lists, then by chunk id. Scores are rounded to 12
   places before comparing, so a difference in the last float bit counts as a tie.

## Options considered
- Lower the RAGAS floor: rejected. The floor was not the problem, the ranking was.
- `websearch_to_tsquery`: rejected. It also joins words with AND, and its OR needs the user to
  type the word "or".
- Break ties toward the dense list: rejected. A keyword hit that matches several words of the
  question is easier to explain than a small cosine difference between near identical chunks.
  This is a design choice and has not been measured on a larger set.
- Weighted Reciprocal Rank Fusion: not tried.

## Consequences
Positive: the context, the citation numbers and the order RAGAS scores now follow the
ranking, and the sparse half works for questions that carry an extra word. On the golden set
context precision went from 0.70 to 1.00, with faithfulness 1.00 and answer relevancy 0.86
(`proof/ragas-scores.txt`, `proof/ragas-scores.png`).
Negative:
- OR matching lets a weak match in. A single shared stem such as "use" is enough for a chunk
  to appear in the sparse list. `ts_rank_cd` keeps it low and Reciprocal Rank Fusion adds only
  1/(60 + rank), so a weak match rarely beats a strong one, but this is not measured on a
  large corpus.
- The tie rule is a choice, not a measured improvement.
- The OR query has no automated test of its own. It was checked with SQL against the
  evaluation corpus and through the RAGAS run. The tie rule and the parent order have unit
  tests (`tests/test_search.py`, `tests/test_parent_retrieval.py`).
- The golden set is 5 questions over 3 one-chunk documents, so it cannot show how the OR query
  behaves on a large corpus.
- The earlier RAGAS proof of 2026-09-15 (context precision 0.80, two questions at 0.5) was
  most likely produced by defect 1, since the two questions whose answer chunk is stored last
  were the ones at 0.5. Nobody looked at the retrieval order in that run, so this is an
  inference. The proof image was replaced.
