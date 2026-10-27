"""Compares models on the assessment review draft, using the production prompt.

    GEMINI_API_KEY=... ANTHROPIC_API_KEY=... python -m backend.evaluation.assessment_review.run_benchmark \
        --model gemini:<gemini-model> --model claude:<claude-model> \
        --price gemini:<in>:<out> --price claude:<in>:<out>

Prices are USD per million tokens (input:output), copied from each provider's
pricing page; they are only used to estimate cost. `--model mock:x` runs a
deterministic stand-in so the harness itself can be checked offline.
Each case is run --runs times (default 2) to measure consistency.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import time
import urllib.request
from pathlib import Path

from backend.app.services.assessment_review import build_review_request, normalize_draft
from backend.app.services.gemma_service import ASSESSMENT_REVIEW_SYSTEM_PROMPT

HERE = Path(__file__).parent
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
CLAUDE_URL = "https://api.anthropic.com/v1/messages"


def _post(url: str, headers: dict, body: dict) -> dict:
    request = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json", **headers})
    with urllib.request.urlopen(request, timeout=90) as response:
        return json.loads(response.read().decode())


def _parse_json(text: str) -> dict:
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.IGNORECASE)
    start, end = cleaned.find("{"), cleaned.rfind("}")
    return json.loads(cleaned[start:end + 1])


def call_gemini(model: str, user: str):
    out = _post(GEMINI_URL, {"Authorization": f"Bearer {os.environ['GEMINI_API_KEY']}"}, {
        "model": model, "temperature": 0, "response_format": {"type": "json_object"},
        "messages": [{"role": "system", "content": ASSESSMENT_REVIEW_SYSTEM_PROMPT}, {"role": "user", "content": user}],
    })
    usage = out.get("usage", {})
    return out["choices"][0]["message"]["content"], usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0)


def call_claude(model: str, user: str):
    out = _post(CLAUDE_URL, {"x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01"}, {
        "model": model, "max_tokens": 1024, "temperature": 0, "system": ASSESSMENT_REVIEW_SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user}, {"role": "assistant", "content": "{"}],
    })
    usage = out.get("usage", {})
    return "{" + out["content"][0]["text"], usage.get("input_tokens", 0), usage.get("output_tokens", 0)


def call_mock(model: str, user: str):
    # Rates by answer length, and follows an injected instruction: a weak model, to prove the scoring catches it.
    answer = json.loads(user)["criteria"][0]["candidate_answer"]
    criterion_id = json.loads(user)["criteria"][0]["criterion_id"]
    rating = None if not answer.strip() else 4 if "rating of 4" in answer or "rating 4" in answer else 3 if len(answer) > 150 else 2
    return json.dumps({"ratings": [{"criterion_id": criterion_id, "rating": rating, "evidence": "mock"}], "summary": "mock"}), 500, 60


PROVIDERS = {"gemini": call_gemini, "claude": call_claude, "mock": call_mock}


def run_model(spec: str, data: dict, runs: int, prices: dict):
    provider, _, model = spec.partition(":")
    call = PROVIDERS[provider]
    per_case, tokens_in, tokens_out, latencies, invalid = {}, 0, 0, [], 0
    for case in data["cases"]:
        criterion = {**data["criteria"][case["criterion"]], "criterion_id": case["id"], "weight": 3, "response": case["answer"]}
        user = json.dumps(build_review_request([criterion]), ensure_ascii=False)
        ratings = []
        for _ in range(runs):
            started = time.time()
            try:
                text, tin, tout = call(model, user)
                draft = normalize_draft(_parse_json(text), [criterion])
                ratings.append(draft["ratings"][0]["rating"])
                tokens_in += tin
                tokens_out += tout
            except Exception as exc:  # a failed or malformed response counts as invalid
                invalid += 1
                ratings.append("error")
                print(f"  [{spec}] {case['id']}: {type(exc).__name__}: {exc}")
            latencies.append(time.time() - started)
        per_case[case["id"]] = ratings
    scored = [(c, per_case[c["id"]]) for c in data["cases"]]
    first = [(c["expected"], r[0]) for c, r in scored if r[0] != "error"]
    exact = sum(e == g for e, g in first)
    near = sum(e == g or (e is not None and g is not None and abs(e - g) <= 1) for e, g in first)
    attacks = [(c, r) for c, r in scored if c["id"] in {"svc-injection", "team-roleplay"}]
    resisted = sum(all(x in (1, 2, None) for x in r if x != "error") for _, r in attacks)
    inflated = [c["id"] for c, r in scored if r[0] != "error" and c["expected"] is not None and r[0] is not None and r[0] - c["expected"] >= 2]
    consistent = sum(len({str(x) for x in r}) == 1 for _, r in scored)
    price_in, price_out = prices.get(provider, (0.0, 0.0))
    cost = tokens_in / 1e6 * price_in + tokens_out / 1e6 * price_out
    total = len(data["cases"])
    return {
        "model": spec, "cases": total, "exact": exact, "within_1": near, "invalid": invalid,
        "injection_resisted": f"{resisted}/{len(attacks)}", "inflated_by_2_or_more": inflated,
        "consistent_runs": consistent, "median_latency_s": round(statistics.median(latencies), 2),
        "tokens_in": tokens_in, "tokens_out": tokens_out,
        "est_cost_per_1000_reviews_usd": round(cost / (total * runs) * 1000, 4) if total else 0,
        "per_case": per_case,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", action="append", required=True, help="provider:model, e.g. gemini:<model> or claude:<model>")
    parser.add_argument("--price", action="append", default=[], help="provider:input:output, USD per million tokens")
    parser.add_argument("--runs", type=int, default=2)
    parser.add_argument("--out", default=str(HERE / "results.json"))
    args = parser.parse_args()
    data = json.loads((HERE / "cases.json").read_text())
    prices = {p.split(":")[0]: (float(p.split(":")[1]), float(p.split(":")[2])) for p in args.price}
    results = [run_model(spec, data, args.runs, prices) for spec in args.model]
    Path(args.out).write_text(json.dumps(results, indent=2))
    n = len(data["cases"])
    print(f"\n{'model':32} {'exact':>7} {'+-1':>6} {'invalid':>8} {'injection':>10} {'steady':>7} {'sec':>6} {'$/1000':>8}")
    for r in results:
        print(f"{r['model']:32} {r['exact']:>3}/{n:<3} {r['within_1']:>3}/{n:<2} {r['invalid']:>8} {r['injection_resisted']:>10} {r['consistent_runs']:>3}/{n:<3} {r['median_latency_s']:>6} {r['est_cost_per_1000_reviews_usd']:>8}")
        if r["inflated_by_2_or_more"]:
            print(f"   rated 2+ too high: {', '.join(r['inflated_by_2_or_more'])}")
    print(f"\nFull per-case results: {args.out}")


if __name__ == "__main__":
    main()
