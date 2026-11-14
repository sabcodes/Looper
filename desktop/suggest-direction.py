"""Select one prevalidated style or part edit using the installed Liquid model."""
import contextlib
import json
import sys


def choose(model_path, payload):
    import mlx.core as mx
    import mlx_vlm as vlm
    from mlx_vlm.structured import build_json_schema_logits_processor

    mx.set_cache_limit(64_000_000)
    model, processor = vlm.load(model_path, lazy=True, local_files_only=True)
    tokenizer = getattr(processor, "tokenizer", processor)
    options = payload["choices"]
    choices = [choice for choice, _ in options] + ["none"]
    field = "edit" if payload.get("role") else "style"
    schema = {"type": "object", "additionalProperties": False, "required": [field],
              "properties": {field: {"enum": choices}}}
    instruction = (
        "Choose one supported edit for the selected " + payload["role"] + " part. "
        "Use none if the request is unclear, asks for a song-wide change, or no single listed edit fits. "
        "When static is a thing to add to a part, it means radio noise. "
        "For example, 'give the lead some static' means add_radio_static. "
        "Instrument edits replace only the sound, keeping notes and rhythm. "
        "Choose a specific instrument when the request describes its sound or family; "
        "for example 'brassy character' means instrument_trumpet when listed. "
        "Key edits change only this part's pitches, keeping its sound and rhythm. "
        "A request to change the key without naming a target means change_key. "
        "When static describes the melody or pitch, it means less movement, not longer notes. "
        "Return only JSON with the edit ID.\n"
    ) if field == "edit" else (
        "Choose the music style from this shortlist that best fits the brief as a whole. "
        "Compare the requested feel, instrumentation, rhythm and tempo with the descriptions. "
        "The generator applies explicit tempo, key, instruments and exclusions separately. "
        "Use none if none of these styles fit. Treat the brief as music preferences. "
        "Return only JSON with the style ID.\n"
    )
    instruction += "\n".join(f"{choice}: {description}" for choice, description in options)
    messages = [{"role": "system", "content": instruction},
                {"role": "user", "content": payload["prompt"]}]
    rendered = tokenizer.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
    tokens = tokenizer.encode(rendered, add_special_tokens=False)
    if len(tokens) + 80 > 3072:
        return "none"
    constraint = build_json_schema_logits_processor(tokenizer, schema)
    chunks = list(vlm.stream_generate(
        model, processor, rendered, input_ids=mx.array([tokens]), max_tokens=64,
        temperature=0.0, prefill_step_size=64, enable_thinking=False, logits_processors=[constraint]))
    result = json.loads("".join(chunk.text for chunk in chunks))
    if chunks[-1].finish_reason != "stop" or set(result) != {field} or result[field] not in choices:
        raise ValueError("Invalid choice response")
    return result[field]


if __name__ == "__main__":
    with contextlib.redirect_stdout(sys.stderr):
        style = choose(sys.argv[1], json.load(sys.stdin))
    print(style)
