# Assessment review model comparison

Runs the production AI-review prompt on 22 labelled answers (strong, vague, blank, keyword-stuffed, prompt-injection, link-only, non-native English, age/gender mentions) and reports, per model: exact and within-one agreement with the expected rating, invalid responses, resistance to injected instructions, steadiness across repeat runs, latency and estimated cost per 1,000 reviews.

```
export GEMINI_API_KEY=...      # paid-tier key
export ANTHROPIC_API_KEY=...
python -m backend.evaluation.assessment_review.run_benchmark \
  --model gemini:<model> --model claude:<model> \
  --price gemini:<usd per M input>:<usd per M output> --price claude:<in>:<out>
```

`cases.json` holds the criteria, answers and expected ratings. The expected ratings are a developer's first draft: have an HR reviewer correct them before relying on the scores. Use dummy text only; do not paste real candidate answers.
