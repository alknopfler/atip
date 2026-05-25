#!/usr/bin/env python3
"""
Auto-detects EIB configuration schema from actual usage in the repository
"""
import yaml
import sys
import json
from pathlib import Path
from collections import defaultdict

def analyze_eib_files(base_dir="telco-examples"):
    """Analyze all EIB files and extract schema patterns"""

    base_path = Path(base_dir)
    eib_files = list(base_path.rglob("eib/*.yaml"))

    # Exclude network config files
    eib_files = [
        f for f in eib_files
        if "network" not in f.name.lower()
        and "script" not in str(f)
    ]

    if not eib_files:
        print("⚠️  No EIB files found", file=sys.stderr)
        return None

    # Collect statistics
    api_versions = set()
    image_types = set()
    architectures = set()
    top_level_fields = defaultdict(int)
    image_fields = defaultdict(int)
    os_fields = defaultdict(int)

    print(f"🔍 Analyzing {len(eib_files)} EIB configuration files...", file=sys.stderr)

    for file_path in eib_files:
        try:
            with open(file_path) as f:
                config = yaml.safe_load(f)

            if not config:
                continue

            # Collect apiVersion
            if 'apiVersion' in config:
                api_versions.add(str(config['apiVersion']))

            # Collect top-level fields
            for field in config.keys():
                top_level_fields[field] += 1

            # Collect image fields
            if 'image' in config and isinstance(config['image'], dict):
                if 'imageType' in config['image']:
                    image_types.add(config['image']['imageType'])
                if 'arch' in config['image']:
                    architectures.add(config['image']['arch'])
                for field in config['image'].keys():
                    image_fields[field] += 1

            # Collect operatingSystem fields
            if 'operatingSystem' in config and isinstance(config['operatingSystem'], dict):
                for field in config['operatingSystem'].keys():
                    os_fields[field] += 1

        except Exception as e:
            print(f"⚠️  Error parsing {file_path}: {e}", file=sys.stderr)
            continue

    total_files = len(eib_files)

    print(f"\n📊 Analysis Results:", file=sys.stderr)
    print(f"   apiVersions found: {sorted(api_versions)}", file=sys.stderr)
    print(f"   imageTypes found: {sorted(image_types)}", file=sys.stderr)
    print(f"   architectures found: {sorted(architectures)}", file=sys.stderr)
    print(f"", file=sys.stderr)

    # Determine required fields (present in 100% of files)
    required_top = [f for f, count in top_level_fields.items() if count == total_files]
    required_image = [f for f, count in image_fields.items() if count == total_files]

    print(f"   Required top-level fields: {required_top}", file=sys.stderr)
    print(f"   Required image fields: {required_image}", file=sys.stderr)
    print(f"", file=sys.stderr)

    return {
        'api_versions': sorted(api_versions),
        'image_types': sorted(image_types),
        'architectures': sorted(architectures),
        'required_fields': required_top,
        'required_image_fields': required_image,
        'optional_top_fields': [f for f in top_level_fields.keys() if f not in required_top],
        'optional_image_fields': [f for f in image_fields.keys() if f not in required_image],
        'optional_os_fields': list(os_fields.keys())
    }

def generate_schema(analysis):
    """Generate JSON schema from analysis"""

    # Build apiVersion enum - support both string and number
    api_version_schema = {
        "oneOf": [
            {"type": "string", "enum": analysis['api_versions']},
            {"type": "number", "enum": [float(v) if '.' in v else int(v) for v in analysis['api_versions']]}
        ]
    }

    # Build imageType pattern - case insensitive
    image_types_pattern = "|".join(
        [t.upper() for t in analysis['image_types']] +
        [t.lower() for t in analysis['image_types']]
    )

    schema = {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "required": analysis['required_fields'],
        "properties": {
            "apiVersion": api_version_schema,
            "image": {
                "type": "object",
                "required": analysis['required_image_fields'],
                "properties": {
                    "imageType": {
                        "type": "string",
                        "pattern": f"^({image_types_pattern})$"
                    },
                    "arch": {
                        "type": "string",
                        "enum": analysis['architectures']
                    },
                    "baseImage": {"type": "string"},
                    "outputImageName": {"type": "string"}
                }
            },
            "operatingSystem": {
                "type": "object",
                "properties": {
                    field: {"type": ["object", "array", "string"]}
                    for field in analysis['optional_os_fields']
                }
            }
        }
    }

    # Add optional top-level fields
    for field in analysis['optional_top_fields']:
        if field not in schema['properties']:
            schema['properties'][field] = {"type": ["object", "array", "string"]}

    # Add optional image fields
    for field in analysis['optional_image_fields']:
        if field not in schema['properties']['image']['properties']:
            schema['properties']['image']['properties'][field] = {"type": "string"}

    return schema

def main():
    base_dir = sys.argv[1] if len(sys.argv) > 1 else "telco-examples"

    analysis = analyze_eib_files(base_dir)

    if not analysis:
        sys.exit(1)

    schema = generate_schema(analysis)

    print("✅ Schema generated successfully", file=sys.stderr)
    print("", file=sys.stderr)

    # Output the schema as Python code
    print(json.dumps(schema, indent=4))

if __name__ == "__main__":
    main()
