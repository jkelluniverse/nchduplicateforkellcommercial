#!/usr/bin/env python3
"""
doc_maker.py — NCH Document Generation Dispatcher

Reads JSON from stdin, routes to the correct generator by doc_type,
writes the PDF to a temp file, and prints only the temp file path to stdout.
"""

import sys
import json
import os
import tempfile
import subprocess

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(SCRIPT_DIR, "doc_generators"))


def compute_calculated(schema_fields, data):
    """Mirror the TypeScript computeCalculated logic for formula fields."""
    result = dict(data)
    for field in schema_fields:
        if field.get("type") == "calculated" and field.get("formula"):
            expr = field["formula"]
            for key, val in result.items():
                try:
                    num = float(str(val)) if val not in (None, "") else 0.0
                except (ValueError, TypeError):
                    num = 0.0
                import re
                expr = re.sub(r'\b' + re.escape(key) + r'\b', str(num), expr)
            try:
                result[field["id"]] = eval(expr)
            except Exception:
                result[field["id"]] = 0
    return result


def route(doc_type, data):
    """Route to the correct generator."""
    generators = {
        "three_day_notice": "gen_three_day_notice",
        "ten_day_notice": "gen_ten_day_notice",
        "thirty_day_notice": "gen_thirty_day_notice",
        "notice_of_default": "gen_notice_of_default",
        "occupancy_verification": "gen_occupancy_verification",
        "payment_receipt": "gen_payment_receipt",
        "work_authorization": "gen_work_authorization",
        "land_contract": "gen_land_contract",
        "quit_claim_deed": "gen_quit_claim",
        "letter_of_acknowledgement": "gen_letter_of_acknowledgement",
        "hold_harmless": "gen_hold_harmless",
        "cancellation_land_contract": "gen_cancellation",
        "payment_plan": "gen_payment_plan",
        "land_contract_nch": "gen_land_contract_nch",
        "residential_lease": "gen_lease",
        "recurring_charge_auth": "gen_recurring_charge_auth",
    }

    if doc_type not in generators:
        raise ValueError(f"Unknown doc_type: {doc_type}")

    module_name = generators[doc_type]
    module_path = os.path.join(SCRIPT_DIR, "doc_generators", module_name + ".py")

    if not os.path.exists(module_path):
        raise FileNotFoundError(f"Generator not found: {module_path}")

    import importlib.util
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    return mod.generate(data)


def libreoffice_convert(docx_path):
    """Convert a .docx file to PDF using LibreOffice headless."""
    tmp_dir = tempfile.mkdtemp()
    result = subprocess.run(
        ["soffice", "--headless", "--convert-to", "pdf", "--outdir", tmp_dir, docx_path],
        capture_output=True, text=True, timeout=60
    )
    if result.returncode != 0:
        raise RuntimeError(f"LibreOffice conversion failed: {result.stderr}")

    base = os.path.splitext(os.path.basename(docx_path))[0]
    pdf_path = os.path.join(tmp_dir, base + ".pdf")
    if not os.path.exists(pdf_path):
        raise RuntimeError(f"LibreOffice did not produce PDF at {pdf_path}")
    return pdf_path


def main():
    try:
        payload = json.loads(sys.stdin.read())
        doc_type = payload.get("doc_type")
        data = payload.get("data", {})
        schema_fields = payload.get("schema_fields", [])

        if not doc_type:
            raise ValueError("Missing doc_type in payload")

        data = compute_calculated(schema_fields, data)
        tmp_path = route(doc_type, data)

        print(tmp_path, end="")
        sys.exit(0)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
