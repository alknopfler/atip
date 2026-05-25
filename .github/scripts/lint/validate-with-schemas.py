#!/usr/bin/env python3
"""
Validates YAML manifests against downloaded CRD schemas
This is a comprehensive validator that checks:
- Required fields
- Optional fields (if present)
- Invalid fields (typos, deprecated fields)
- Field types
"""
import yaml
import json
import sys
from pathlib import Path
from jsonschema import validate, ValidationError, Draft7Validator

def load_schemas(schema_dir=".schemas/openapi"):
    """Load all CRD schemas from the schema directory"""
    schema_path = Path(schema_dir)

    if not schema_path.exists():
        print("❌ Schema directory not found. Run download-crd-schemas.sh first.", file=sys.stderr)
        return {}

    schemas = {}
    for schema_file in schema_path.glob("*.json"):
        try:
            with open(schema_file) as f:
                schema = json.load(f)

            # Extract metadata from schema
            gvk_list = schema.get('x-kubernetes-group-version-kind', [])
            if gvk_list:
                for gvk in gvk_list:
                    group = gvk['group']
                    version = gvk['version']
                    kind = gvk['kind']
                    api_version = f"{group}/{version}"
                    key = f"{api_version}:{kind}"
                    schemas[key] = schema

        except Exception as e:
            print(f"⚠️  Error loading {schema_file}: {e}", file=sys.stderr)

    return schemas

def preprocess_template_vars(content):
    """Replace template variables with placeholder values that pass schema validation"""
    import re

    # Replace ${VAR} with values that match expected patterns
    # Order matters: more specific patterns first

    # Version fields
    content = re.sub(r'\$\{RKE2_VERSION\}', 'v1.30.0+rke2r1', content)

    # Context-aware replacements: bootMACAddress field needs MAC format
    content = re.sub(r'(bootMACAddress:\s*)\$\{[^}]+\}', r'\g<1>00:00:00:00:00:00', content)

    # MAC addresses - must be before IP/ADDRESS patterns
    # CONTROLPLANE_MAC, BMC_MAC, etc.
    content = re.sub(r'\$\{[^}]*MAC[^}]*\}', '00:00:00:00:00:00', content, flags=re.IGNORECASE)

    # BMC address field (usually IPMI URL)
    content = re.sub(r'(address:\s*)\$\{BMC_ADDRESS\}', r'\g<1>ipmi://192.168.1.1', content)
    content = re.sub(r'\$\{BMC_USERNAME\}', 'admin', content)
    content = re.sub(r'\$\{BMC_PASSWORD\}', 'password', content)

    # IP addresses (after MAC, after BMC)
    content = re.sub(r'\$\{[^}]*IP[^}]*\}', '192.168.1.1', content, flags=re.IGNORECASE)
    content = re.sub(r'\$\{[^}]*ADDRESS[^}]*\}', '192.168.1.1', content, flags=re.IGNORECASE)

    # Usernames/passwords
    content = re.sub(r'\$\{[^}]*USERNAME[^}]*\}', 'admin', content, flags=re.IGNORECASE)
    content = re.sub(r'\$\{[^}]*PASSWORD[^}]*\}', 'password', content, flags=re.IGNORECASE)

    # Numeric values (cores, memory, etc.)
    content = re.sub(r'\$\{[^}]*CORES[^}]*\}', '4', content, flags=re.IGNORECASE)
    content = re.sub(r'\$\{[^}]*CPU[^}]*\}', '4', content, flags=re.IGNORECASE)
    content = re.sub(r'\$\{[^}]*MEMORY[^}]*\}', '8192', content, flags=re.IGNORECASE)

    # Network prefixes (CIDR)
    content = re.sub(r'\$\{[^}]*PREFIX[^}]*\}', '24', content, flags=re.IGNORECASE)

    # Interface names
    content = re.sub(r'\$\{[^}]*INTERFACE[^}]*\}', 'eth0', content, flags=re.IGNORECASE)
    content = re.sub(r'\$\{[^}]*NIC[^}]*\}', 'eth0', content, flags=re.IGNORECASE)

    # Generic placeholder for any remaining variables
    content = re.sub(r'\$\{[^}]+\}', 'placeholder-value', content)

    return content

def validate_manifest(manifest_file, schemas):
    """Validate a single manifest file against schemas"""
    errors = []
    warnings = []
    validated = 0

    try:
        with open(manifest_file) as f:
            raw_content = f.read()

        # Preprocess template variables
        processed_content = preprocess_template_vars(raw_content)

        # Parse YAML
        docs = list(yaml.safe_load_all(processed_content))
    except Exception as e:
        return [(f"YAML parsing error: {e}", "error")], 0

    for doc_idx, doc in enumerate(docs):
        if not doc or not isinstance(doc, dict):
            continue

        kind = doc.get('kind')
        api_version = doc.get('apiVersion')

        if not kind or not api_version:
            continue

        # Skip built-in Kubernetes types
        if kind in ['Secret', 'ConfigMap', 'Namespace', 'Service']:
            continue

        # Find matching schema
        key = f"{api_version}:{kind}"
        schema = schemas.get(key)

        if not schema:
            # Try with capitalized kind
            for stored_key, stored_schema in schemas.items():
                if stored_key.endswith(f":{kind}") and api_version in stored_key:
                    schema = stored_schema
                    break

        if not schema:
            warnings.append(f"{kind} ({api_version}): No schema found - skipping validation")
            continue

        # Validate against schema
        validator = Draft7Validator(schema)
        validation_errors = list(validator.iter_errors(doc))

        if validation_errors:
            resource_name = doc.get('metadata', {}).get('name', 'unknown')
            for error in validation_errors:
                path = ".".join(str(p) for p in error.path) if error.path else "root"
                errors.append(f"{kind} '{resource_name}': {path} - {error.message}")
        else:
            validated += 1

    results = [(e, "error") for e in errors] + [(w, "warning") for w in warnings]
    return results, validated

def main():
    print("🔍 Validating manifests with CRD schemas", file=sys.stderr)
    print("", file=sys.stderr)

    # Load schemas
    print("📚 Loading CRD schemas...", file=sys.stderr)
    schemas = load_schemas()

    if not schemas:
        print("❌ No schemas found. Run: bash .github/scripts/lint/download-crd-schemas.sh", file=sys.stderr)
        sys.exit(1)

    print(f"   Loaded {len(schemas)} schemas", file=sys.stderr)
    print("", file=sys.stderr)

    # Find manifest files
    manifests_dir = Path("telco-examples")
    manifest_files = [
        f for f in manifests_dir.rglob("*.yaml")
        if not any(part in str(f) for part in ["eib", ".schemas"])
    ]

    print(f"🔍 Validating {len(manifest_files)} manifest files...", file=sys.stderr)
    print("", file=sys.stderr)

    total_errors = 0
    total_warnings = 0
    total_validated = 0

    for manifest_file in sorted(manifest_files):
        results, validated = validate_manifest(manifest_file, schemas)

        if results:
            print(f"  📄 {manifest_file}", file=sys.stderr)
            for message, level in results:
                if level == "error":
                    print(f"    ❌ {message}", file=sys.stderr)
                    total_errors += 1
                else:
                    print(f"    ⚠️  {message}", file=sys.stderr)
                    total_warnings += 1

        total_validated += validated

    print("", file=sys.stderr)
    print("════════════════════════════════════════", file=sys.stderr)

    if total_errors > 0:
        print(f"❌ Found {total_errors} validation error(s)", file=sys.stderr)
        print(f"⚠️  Found {total_warnings} warning(s)", file=sys.stderr)
        print(f"✅ {total_validated} resource(s) validated successfully", file=sys.stderr)
        sys.exit(1)

    if total_warnings > 0:
        print(f"⚠️  Found {total_warnings} warning(s)", file=sys.stderr)

    print(f"✅ All {total_validated} resource(s) validated successfully", file=sys.stderr)

if __name__ == "__main__":
    main()
