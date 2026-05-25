#!/usr/bin/env python3
"""
Validate Edge Image Builder (EIB) configuration files with auto-detected schema
"""
import yaml
import sys
import json
import subprocess
from pathlib import Path
from jsonschema import validate, ValidationError, Draft7Validator

def get_eib_schema():
    """
    Get EIB schema - auto-detect from actual files if possible,
    fallback to default schema if detection fails
    """
    try:
        # Try to auto-detect schema from actual EIB files
        script_dir = Path(__file__).parent
        detect_script = script_dir / "detect-eib-schema.py"

        result = subprocess.run(
            [sys.executable, str(detect_script), "telco-examples"],
            capture_output=True,
            text=True,
            timeout=10
        )

        if result.returncode == 0:
            # Parse the JSON output (stdout contains the schema)
            schema = json.loads(result.stdout)
            print("✅ Using auto-detected EIB schema", file=sys.stderr)
            return schema
        else:
            print("⚠️  Schema auto-detection failed, using default", file=sys.stderr)

    except Exception as e:
        print(f"⚠️  Error auto-detecting schema: {e}, using default", file=sys.stderr)

    # Fallback to default schema
    return {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "required": ["apiVersion", "image", "operatingSystem"],
        "properties": {
            "apiVersion": {
                "oneOf": [
                    {"type": "string", "enum": ["1.0", "1.3"]},
                    {"type": "number", "enum": [1.0, 1.3]}
                ]
            },
            "image": {
                "type": "object",
                "required": ["imageType", "arch", "baseImage"],
                "properties": {
                    "imageType": {
                        "type": "string",
                        "pattern": "^(RAW|ISO|raw|iso)$"
                    },
                    "arch": {
                        "type": "string",
                        "enum": ["x86_64", "aarch64"]
                    },
                    "baseImage": {"type": "string"},
                    "outputImageName": {"type": "string"}
                }
            },
            "operatingSystem": {
                "type": "object",
                "properties": {
                    "users": {"type": "array"},
                    "packages": {"type": "object"},
                    "systemd": {"type": "object"},
                    "isoConfiguration": {"type": "object"},
                    "time": {"type": "object"},
                    "proxy": {"type": "object"},
                    "suma": {"type": "object"}
                }
            },
            "kubernetes": {"type": "object"},
            "embeddedArtifactRegistry": {"type": "object"}
        }
    }

# Get schema (auto-detected or default)
EIB_SCHEMA = get_eib_schema()

def validate_eib_file(file_path):
    """Validate a single EIB configuration file"""
    try:
        with open(file_path) as f:
            config = yaml.safe_load(f)

        if not config:
            print(f"⚠️  {file_path}: Empty file")
            return True

        # Use Draft7Validator for better error messages
        validator = Draft7Validator(EIB_SCHEMA)
        errors = list(validator.iter_errors(config))

        if errors:
            print(f"❌ {file_path}:")
            for error in errors:
                path = ".".join(str(p) for p in error.path) if error.path else "root"
                print(f"   - {path}: {error.message}")
            return False

        print(f"✅ {file_path}")
        return True

    except yaml.YAMLError as e:
        print(f"❌ {file_path}: YAML parsing error - {e}")
        return False
    except Exception as e:
        print(f"❌ {file_path}: {str(e)}")
        return False

def main():
    print("🔍 Validating EIB configuration files")
    print()

    errors = 0
    validated = 0

    # Find all EIB config files
    eib_files = list(Path("telco-examples").rglob("eib/*.yaml"))

    # Exclude network config files and scripts
    eib_files = [
        f for f in eib_files
        if "network" not in f.name.lower()
        and "script" not in str(f)
        and f.name not in ["configure-network.sh"]
    ]

    if not eib_files:
        print("⚠️  No EIB configuration files found")
        return

    for file_path in sorted(eib_files):
        if validate_eib_file(file_path):
            validated += 1
        else:
            errors += 1

    print()
    print("════════════════════════════════════════")

    if errors > 0:
        print(f"❌ {errors} EIB config validation error(s)")
        print(f"✅ {validated} file(s) validated successfully")
        sys.exit(1)

    print(f"✅ All {validated} EIB configuration(s) validated successfully")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n⚠️  Validation interrupted")
        sys.exit(1)
