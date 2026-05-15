#!/usr/bin/env python3
"""Fetch one ServiceMinder appointment and write a redacted JSON artifact."""

from __future__ import annotations

import argparse
import getpass
import json
import re
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REDACTED = "[REDACTED]"

FIELD_NAME_KEYS = {
    "name",
    "label",
    "fieldname",
    "field",
    "key",
    "question",
    "prompt",
    "title",
    "displayname",
}
FIELD_VALUE_KEYS = {
    "value",
    "answer",
    "response",
    "score",
    "rating",
    "text",
    "textvalue",
    "numbervalue",
    "displayvalue",
    "selectedoption",
}
SERVICE_KEYS = {"service", "serviceid", "servicename"}
SAFE_VALUE_KEYS = {
    "id",
    "appointmentid",
    "contactid",
    "organizationid",
    "locationid",
    "proposalid",
    "rootproposalid",
    "invoiceid",
    "status",
    "datetime",
    "datetimeformatted",
    "actualstart",
    "actualfinish",
    "actualduration",
    "completeddate",
    "completiondate",
    "datecompleted",
    "duration",
    "durationformatted",
    "quantity",
    "discount",
    "total",
    "amount",
    "weeknumber",
}
PII_KEYS = {
    "address",
    "address1",
    "address2",
    "altphone",
    "altphonelabel",
    "body",
    "city",
    "clientname",
    "comment",
    "comments",
    "company",
    "contactname",
    "customername",
    "customernotes",
    "displayname",
    "email",
    "emailaddress",
    "firstname",
    "fullname",
    "internalnotes",
    "lastname",
    "messagebody",
    "mobile",
    "mobilephone",
    "name",
    "nickname",
    "note",
    "notes",
    "phone",
    "postalcode",
    "priphone",
    "priphonelabel",
    "state",
    "street",
    "text",
    "zip",
}

CUSTOM_CONTEXT_RE = re.compile(
    r"(custom.*field|customproperties|field.*value|appointment.*field|answer|survey|scorecard|checklist)",
    re.IGNORECASE,
)
SCORE_RE = re.compile(r"(ses|score|rating|nps|satisfaction|quality|grade|stars|points|survey)", re.IGNORECASE)
URL_KEY_RE = re.compile(r"(url|uri|href|link|tracking)", re.IGNORECASE)
EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
PHONE_RE = re.compile(r"(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b")
ADDRESS_RE = re.compile(
    r"\b\d{1,6}\s+[\w .'-]+(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|court|ct|circle|cir|boulevard|blvd|way)\b",
    re.IGNORECASE,
)
TOKEN_SEGMENT_RE = re.compile(r"^[A-Za-z0-9_-]{16,}$")


class ServiceMinderRequestError(Exception):
    def __init__(self, message: str, payload: Any | None = None):
        super().__init__(message)
        self.payload = payload


def normalized_key(key: str) -> str:
    return re.sub(r"[^a-z0-9]", "", key.lower())


def path_text(path: tuple[str, ...]) -> str:
    return ".".join(path)


def is_record(value: Any) -> bool:
    return isinstance(value, dict)


def value_type(value: Any) -> str:
    if value is None or value == "":
        return "blank"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return "text"


def numeric_value(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    if not trimmed:
        return None
    fraction = re.match(r"^(-?\d+(?:\.\d+)?)\s*/\s*(-?\d+(?:\.\d+)?)$", trimmed)
    if fraction:
        return float(fraction.group(1))
    normalized = re.sub(r"[$,%\s,]", "", trimmed)
    if not re.match(r"^-?\d+(?:\.\d+)?$", normalized):
        return None
    return float(normalized)


def is_custom_context(path: tuple[str, ...]) -> bool:
    return bool(CUSTOM_CONTEXT_RE.search(path_text(path)))


def is_custom_field_name(path: tuple[str, ...]) -> bool:
    if not path:
        return False
    return normalized_key(path[-1]) in FIELD_NAME_KEYS and is_custom_context(path[:-1])


def looks_sensitive(value: str) -> bool:
    return bool(EMAIL_RE.search(value) or PHONE_RE.search(value) or ADDRESS_RE.search(value))


def redact_url(value: str) -> str:
    try:
        parsed = urllib.parse.urlsplit(value)
    except ValueError:
        return REDACTED

    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return REDACTED

    safe_segments: list[str] = []
    for segment in parsed.path.split("/"):
        if not segment:
            safe_segments.append(segment)
            continue
        if TOKEN_SEGMENT_RE.match(segment):
            safe_segments.append(REDACTED)
        else:
            safe_segments.append(segment)

    query = REDACTED if parsed.query else ""
    fragment = REDACTED if parsed.fragment else ""
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, "/".join(safe_segments), query, fragment))


def redact_string(value: str, path: tuple[str, ...]) -> str:
    key = normalized_key(path[-1]) if path else ""

    if "apikey" in key or "authorization" in key or "token" in key or "password" in key or "secret" in key:
        return REDACTED

    if URL_KEY_RE.search(path_text(path)):
        return redact_url(value)

    if is_custom_field_name(path):
        return value

    if key in SERVICE_KEYS or key in SAFE_VALUE_KEYS:
        return value

    if key in PII_KEYS or key.endswith("name") or looks_sensitive(value):
        return REDACTED

    return value


def redact(value: Any, path: tuple[str, ...] = ()) -> Any:
    if isinstance(value, list):
        return [redact(item, (*path, f"[{index}]")) for index, item in enumerate(value)]
    if isinstance(value, dict):
        return {key: redact(nested, (*path, key)) for key, nested in value.items()}
    if isinstance(value, str):
        return redact_string(value, path)
    return value


def endpoint_url(base_url: str, endpoint: str) -> str:
    return f"{base_url.rstrip('/')}/{endpoint.lstrip('/')}"


def build_ssl_context(ca_file: str | None, insecure_skip_tls_verify: bool) -> tuple[ssl.SSLContext, dict[str, Any]]:
    if insecure_skip_tls_verify:
        return ssl._create_unverified_context(), {
            "verify": False,
            "caSource": "disabled",
            "caFile": None,
        }

    if ca_file:
        resolved_ca_file = str(Path(ca_file).expanduser())
        return ssl.create_default_context(cafile=resolved_ca_file), {
            "verify": True,
            "caSource": "--ca-file",
            "caFile": resolved_ca_file,
        }

    try:
        import certifi  # type: ignore[import-not-found]
    except ImportError:
        return ssl.create_default_context(), {
            "verify": True,
            "caSource": "system",
            "caFile": None,
        }

    certifi_ca_file = certifi.where()
    return ssl.create_default_context(cafile=certifi_ca_file), {
        "verify": True,
        "caSource": "certifi",
        "caFile": certifi_ca_file,
    }


def post_json(
    base_url: str,
    endpoint: str,
    api_key: str,
    payload: dict[str, Any],
    timeout: int,
    ssl_context: ssl.SSLContext,
) -> dict[str, Any]:
    url = endpoint_url(base_url, endpoint)
    body = json.dumps({**payload, "ApiKey": api_key}).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"content-type": "application/json", "accept": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout, context=ssl_context) as response:
            text = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        text = error.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(text) if text else {"status": error.code}
        except json.JSONDecodeError:
            payload = {"status": error.code, "body": text}
        raise ServiceMinderRequestError(f"HTTP {error.code} from {endpoint}", payload) from error
    except urllib.error.URLError as error:
        message = f"Could not reach {endpoint}: {error.reason}"
        if "CERTIFICATE_VERIFY_FAILED" in str(error.reason):
            message += (
                " (TLS certificate verification failed. Pass --ca-file /path/to/cacert.pem, "
                "install certifi, or use --insecure-skip-tls-verify only for local debugging.)"
            )
        raise ServiceMinderRequestError(message) from error

    try:
        parsed = json.loads(text) if text else {}
    except json.JSONDecodeError as error:
        raise ServiceMinderRequestError(f"Non-JSON response from {endpoint}", {"body": text}) from error

    if not isinstance(parsed, dict):
        raise ServiceMinderRequestError(f"Unexpected JSON response from {endpoint}", parsed)

    result_code = parsed.get("ResultCode")
    if isinstance(result_code, int) and result_code != 0:
        raise ServiceMinderRequestError(str(parsed.get("Message") or f"ResultCode {result_code} from {endpoint}"), parsed)

    return parsed


def id_text(value: Any) -> str:
    if isinstance(value, bool):
        return ""
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def looks_like_appointment_with_id(record: dict[str, Any], appointment_id: str) -> bool:
    if id_text(record.get("AppointmentId")) == appointment_id:
        return True
    if id_text(record.get("Id")) != appointment_id:
        return False

    markers = {
        "ContactId",
        "DateTime",
        "DateTimeFormatted",
        "ServiceId",
        "ServiceName",
        "Status",
        "TrackingUrl",
        "ActualStart",
        "ActualFinish",
    }
    return any(marker in record for marker in markers)


def extract_appointment(value: Any, appointment_id: str) -> dict[str, Any] | None:
    if isinstance(value, dict):
        for preferred_key in ("Appointment", "Appointments", "Slot", "Slots", "Matches"):
            nested = value.get(preferred_key)
            found = extract_appointment(nested, appointment_id)
            if found is not None:
                return found

        if looks_like_appointment_with_id(value, appointment_id):
            return value

        for nested in value.values():
            found = extract_appointment(nested, appointment_id)
            if found is not None:
                return found

    if isinstance(value, list):
        for item in value:
            found = extract_appointment(item, appointment_id)
            if found is not None:
                return found

    return None


def looks_like_contact_with_id(record: dict[str, Any], contact_id: str) -> bool:
    return id_text(record.get("Id")) == contact_id or id_text(record.get("ContactId")) == contact_id


def extract_contact(value: Any, contact_id: str) -> dict[str, Any] | None:
    if isinstance(value, dict):
        for preferred_key in ("Contact", "Contacts", "Matches"):
            nested = value.get(preferred_key)
            found = extract_contact(nested, contact_id)
            if found is not None:
                return found

        if looks_like_contact_with_id(value, contact_id):
            return value

        for nested in value.values():
            found = extract_contact(nested, contact_id)
            if found is not None:
                return found

    if isinstance(value, list):
        for item in value:
            found = extract_contact(item, contact_id)
            if found is not None:
                return found

    return None


def appointment_contact_id(appointment: dict[str, Any] | None) -> str | None:
    if not appointment:
        return None
    direct = id_text(appointment.get("ContactId"))
    if direct:
        return direct
    contact = appointment.get("Contact")
    if isinstance(contact, dict):
        nested = id_text(contact.get("Id") or contact.get("ContactId"))
        if nested:
            return nested
    return None


def appointments_from_response(response: dict[str, Any]) -> list[Any]:
    for key in ("Appointments", "Slots", "Matches"):
        value = response.get(key)
        if isinstance(value, list):
            return value
    return []


def query_for_appointment(
    base_url: str,
    api_key: str,
    appointment_id: str,
    from_date: str,
    through_date: str,
    take: int,
    max_records: int,
    timeout: int,
    ssl_context: ssl.SSLContext,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, list[dict[str, Any]]]:
    skip = 0
    scanned = 0
    summaries: list[dict[str, Any]] = []

    while scanned < max_records:
        response = post_json(
            base_url,
            "appointments/query",
            api_key,
            {
                "FromDate": from_date,
                "ThroughDate": through_date,
                "IncludeContact": True,
                "IncludeCompleted": True,
                "Skip": skip,
                "Take": take,
            },
            timeout,
            ssl_context,
        )
        page = appointments_from_response(response)
        found = extract_appointment(page, appointment_id)
        summaries.append(
            {
                "skip": skip,
                "take": take,
                "returned": len(page),
                "totalCount": response.get("Count") or response.get("TotalCount"),
                "foundAppointment": found is not None,
            }
        )

        if found is not None:
            return found, response, summaries

        if len(page) < take:
            break

        scanned += len(page)
        skip += take

    return None, None, summaries


def flatten_leaves(value: Any, path: tuple[str, ...] = ()) -> list[tuple[tuple[str, ...], Any]]:
    if isinstance(value, dict):
        leaves: list[tuple[tuple[str, ...], Any]] = []
        for key, nested in value.items():
            leaves.extend(flatten_leaves(nested, (*path, key)))
        return leaves
    if isinstance(value, list):
        leaves = []
        for index, nested in enumerate(value):
            leaves.extend(flatten_leaves(nested, (*path, f"[{index}]")))
        return leaves
    return [(path, value)]


def collect_custom_field_paths(value: Any, path: tuple[str, ...] = ()) -> list[dict[str, Any]]:
    paths: list[dict[str, Any]] = []
    if isinstance(value, dict):
        for key, nested in value.items():
            next_path = (*path, key)
            if CUSTOM_CONTEXT_RE.search(key) and isinstance(nested, (dict, list)):
                paths.append(
                    {
                        "path": path_text(next_path),
                        "type": value_type(nested),
                        "size": len(nested),
                    }
                )
            paths.extend(collect_custom_field_paths(nested, next_path))
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            paths.extend(collect_custom_field_paths(nested, (*path, f"[{index}]")))
    return paths


def first_matching_value(record: dict[str, Any], keys: set[str]) -> tuple[str, Any] | None:
    for key, value in record.items():
        if normalized_key(key) in keys and value not in (None, ""):
            return key, value
    return None


def collect_named_score_fields(value: Any, path: tuple[str, ...] = ()) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    if isinstance(value, dict):
        name_pair = first_matching_value(value, FIELD_NAME_KEYS)
        value_pair = first_matching_value(value, FIELD_VALUE_KEYS)
        if name_pair and value_pair and isinstance(name_pair[1], str) and SCORE_RE.search(name_pair[1]):
            value_path = (*path, value_pair[0])
            results.append(
                {
                    "path": path_text(value_path),
                    "fieldName": name_pair[1],
                    "valueType": value_type(value_pair[1]),
                    "value": redact(value_pair[1], value_path),
                    "numericValue": numeric_value(value_pair[1]),
                    "reason": "score-like field name",
                }
            )
        for key, nested in value.items():
            results.extend(collect_named_score_fields(nested, (*path, key)))
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            results.extend(collect_named_score_fields(nested, (*path, f"[{index}]")))
    return results


def build_inventory(appointment: dict[str, Any] | None) -> dict[str, Any]:
    if appointment is None:
        return {
            "topLevelKeys": [],
            "customFieldPaths": [],
            "possibleSesFields": [],
            "possibleUrlLinkFields": [],
        }

    possible_ses_fields: list[dict[str, Any]] = []
    possible_url_fields: list[dict[str, Any]] = []
    seen_ses_paths: set[str] = set()

    for leaf_path, value in flatten_leaves(appointment):
        leaf_path_text = path_text(leaf_path)
        leaf_key = leaf_path[-1] if leaf_path else ""
        numeric = numeric_value(value)

        if URL_KEY_RE.search(leaf_path_text) or (isinstance(value, str) and value.startswith(("http://", "https://"))):
            possible_url_fields.append(
                {
                    "path": leaf_path_text,
                    "valueType": value_type(value),
                    "value": redact(value, leaf_path),
                }
            )

        score_reason = None
        if SCORE_RE.search(leaf_path_text):
            score_reason = "score-like path"
        elif numeric is not None and 0 <= numeric <= 100 and is_custom_context(leaf_path):
            score_reason = "numeric value under custom-field-like path"

        if score_reason and leaf_path_text not in seen_ses_paths:
            possible_ses_fields.append(
                {
                    "path": leaf_path_text,
                    "key": leaf_key,
                    "valueType": value_type(value),
                    "value": redact(value, leaf_path),
                    "numericValue": numeric,
                    "reason": score_reason,
                }
            )
            seen_ses_paths.add(leaf_path_text)

    for item in collect_named_score_fields(appointment):
        if item["path"] not in seen_ses_paths:
            possible_ses_fields.append(item)
            seen_ses_paths.add(item["path"])

    return {
        "topLevelKeys": list(appointment.keys()),
        "customFieldPaths": collect_custom_field_paths(appointment),
        "possibleSesFields": possible_ses_fields,
        "possibleUrlLinkFields": possible_url_fields,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch one ServiceMinder appointment and write a redacted JSON file.",
    )
    parser.add_argument(
        "--api-key",
        default=None,
        help="ServiceMinder API key. If omitted, uses SERVICEMINDER_API_KEY or prompts securely.",
    )
    parser.add_argument("--appointment-id", required=True, help="ServiceMinder appointment ID to extract.")
    parser.add_argument("--org-id", required=True, help="ServiceMinder organization ID used for the web appointment URL.")
    parser.add_argument("--base-url", default="https://serviceminder.com/api", help="ServiceMinder API base URL.")
    parser.add_argument("--output", default=None, help="Output JSON path. Defaults to redacted-appointment-<id>.json.")
    parser.add_argument("--from", dest="from_date", default=None, help="Fallback query start date, e.g. 2026-01-01.")
    parser.add_argument("--through", dest="through_date", default=None, help="Fallback query end date, e.g. 2026-05-14.")
    parser.add_argument("--take", type=int, default=100, help="Fallback query page size.")
    parser.add_argument("--max-records", type=int, default=5000, help="Maximum fallback query records to scan.")
    parser.add_argument("--timeout", type=int, default=30, help="HTTP timeout in seconds.")
    parser.add_argument("--ca-file", default=None, help="CA bundle path for TLS verification. Defaults to certifi when installed.")
    parser.add_argument(
        "--insecure-skip-tls-verify",
        action="store_true",
        help="Disable TLS certificate verification. Use only for local debugging.",
    )

    args = parser.parse_args()
    if bool(args.from_date) != bool(args.through_date):
        parser.error("--from and --through must be supplied together.")
    if args.take < 1:
        parser.error("--take must be greater than 0.")
    if args.max_records < 1:
        parser.error("--max-records must be greater than 0.")
    return args


def main() -> int:
    args = parse_args()
    api_key = args.api_key
    if not api_key:
        import os

        api_key = os.environ.get("SERVICEMINDER_API_KEY")
    if not api_key:
        try:
            api_key = getpass.getpass("ServiceMinder API key: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nMissing --api-key or SERVICEMINDER_API_KEY.", file=sys.stderr)
            return 2
    if not api_key:
        print("Missing API key.", file=sys.stderr)
        return 2

    try:
        ssl_context, tls_info = build_ssl_context(args.ca_file, args.insecure_skip_tls_verify)
    except (OSError, ssl.SSLError) as error:
        print(f"Could not configure TLS verification: {error}", file=sys.stderr)
        return 2

    if args.insecure_skip_tls_verify:
        print("Warning: TLS certificate verification is disabled for this run.", file=sys.stderr)

    appointment_id = id_text(args.appointment_id)
    actual_url = f"https://serviceminder.com/o/{args.org_id}/appointments/details/{appointment_id}"
    output_path = Path(args.output or f"redacted-appointment-{appointment_id}.json")

    attempted_endpoints = ["appointments/find"]
    errors: list[str] = []
    find_response: dict[str, Any] | None = None
    query_response: dict[str, Any] | None = None
    contact_response: dict[str, Any] | None = None
    query_summaries: list[dict[str, Any]] = []
    appointment: dict[str, Any] | None = None
    contact: dict[str, Any] | None = None
    resolved_endpoint: str | None = None

    try:
        find_response = post_json(
            args.base_url,
            "appointments/find",
            api_key,
            {
                "AppointmentId": appointment_id,
                "IncludeContact": True,
                "IncludeCompleted": True,
            },
            args.timeout,
            ssl_context,
        )
        appointment = extract_appointment(find_response, appointment_id)
        if appointment is not None:
            resolved_endpoint = "appointments/find"
    except ServiceMinderRequestError as error:
        errors.append(str(error))
        if isinstance(error.payload, dict):
            find_response = error.payload

    if appointment is None and args.from_date and args.through_date:
        attempted_endpoints.append("appointments/query")
        try:
            appointment, query_response, query_summaries = query_for_appointment(
                args.base_url,
                api_key,
                appointment_id,
                args.from_date,
                args.through_date,
                args.take,
                args.max_records,
                args.timeout,
                ssl_context,
            )
            if appointment is not None:
                resolved_endpoint = "appointments/query"
        except ServiceMinderRequestError as error:
            errors.append(str(error))
            if isinstance(error.payload, dict):
                query_response = error.payload

    contact_id = appointment_contact_id(appointment)
    if contact_id:
        attempted_endpoints.append("contacts/locate")
        try:
            contact_response = post_json(
                args.base_url,
                "contacts/locate",
                api_key,
                {
                    "IdSearch": int(contact_id) if contact_id.isdigit() else contact_id,
                    "NameSearch": "",
                    "PhoneSearch": "",
                    "EmailSearch": "",
                    "AddressSearch": "",
                    "DigitalTrackingIdSearch": "",
                    "ReturnPmtOnFile": False,
                    "DistributeLead": False,
                    "Skip": 0,
                    "Limit": 1,
                },
                args.timeout,
                ssl_context,
            )
            contact = extract_contact(contact_response, contact_id)
        except ServiceMinderRequestError as error:
            errors.append(str(error))
            if isinstance(error.payload, dict):
                contact_response = error.payload

    result = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "request": {
            "baseUrl": args.base_url,
            "endpoint": resolved_endpoint,
            "attemptedEndpoints": attempted_endpoints,
            "appointmentId": appointment_id,
            "orgId": args.org_id,
            "includeContact": True,
            "includeCompleted": True,
            "from": args.from_date,
            "through": args.through_date,
            "take": args.take if "appointments/query" in attempted_endpoints else None,
            "maxRecords": args.max_records if "appointments/query" in attempted_endpoints else None,
            "tls": tls_info,
        },
        "actualAppointmentUrl": actual_url,
        "rawResponse": {
            "find": redact(find_response) if find_response is not None else None,
            "queryFoundPage": redact(query_response) if query_response is not None else None,
            "contactLocate": redact(contact_response) if contact_response is not None else None,
            "queryPageSummaries": query_summaries,
        },
        "appointment": redact(appointment) if appointment is not None else None,
        "contact": redact(contact) if contact is not None else None,
        "inventory": build_inventory(appointment),
        "contactInventory": build_inventory(contact),
        "errors": errors,
        "nextStep": None,
    }

    if appointment is None and not (args.from_date and args.through_date):
        result["nextStep"] = "appointments/find did not return a matching appointment. Rerun with --from and --through to scan appointments/query."
    elif appointment is None:
        result["nextStep"] = "No matching appointment was found. Try a wider --from/--through range or confirm the AppointmentId."
    elif contact_id and contact is None:
        result["nextStep"] = "Appointment was found, but contacts/locate did not return a matching contact. Confirm contacts/locate access for this API key."
    elif contact is not None and not result["contactInventory"]["possibleSesFields"]:
        result["nextStep"] = "Contact was found, but no SES-like custom field was returned. Check custom field name/shortcode or whether this API key can read contact custom fields."

    output_path.write_text(json.dumps(result, indent=2, sort_keys=False) + "\n", encoding="utf-8")
    print(f"Wrote redacted appointment JSON to {output_path}")
    if appointment is None:
        print(result["nextStep"], file=sys.stderr)
        return 1
    if result["nextStep"]:
        print(result["nextStep"], file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
