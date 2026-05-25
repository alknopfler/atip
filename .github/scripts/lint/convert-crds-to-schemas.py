#!/usr/bin/env python3
"""
Convert Kubernetes CRDs to OpenAPI schemas for kubeconform validation
"""
import yaml
import json
import os
import sys
from pathlib import Path

def convert_crd_to_schema(crd):
    """Convert a CRD to OpenAPI schema format for kubeconform"""
    schemas = {}

    # Ensure we have the expected structure
    if not crd or 'spec' not in crd:
        return schemas

    spec = crd['spec']
    if 'versions' not in spec:
        return schemas

    for version in spec['versions']:
        if not version.get('schema'):
            continue

        # Build the schema identifier
        group = spec['group']
        version_name = version['name']
        kind = spec['names']['kind']

        # Extract the OpenAPI schema
        schema = version['schema'].get('openAPIV3Schema', {})

        # Add metadata for easy identification
        schema['x-kubernetes-group-version-kind'] = [{
            'group': group,
            'version': version_name,
            'kind': kind
        }]

        # Create filename: <kind>-<group>-<version>.json
        # Replace dots in group with dashes
        group_safe = group.replace('.', '-')
        filename = f"{kind.lower()}-{group_safe}-{version_name}.json"
        schemas[filename] = schema

    return schemas

def main(schema_dir):
    schema_dir = Path(schema_dir)
    output_dir = schema_dir / "openapi"
    output_dir.mkdir(exist_ok=True)

    total_schemas = 0

    # Find all CRD files
    for crd_file in schema_dir.glob("*-crds.yaml"):
        print(f"  Processing {crd_file.name}...")

        with open(crd_file) as f:
            # Load all documents in the YAML file
            try:
                docs = list(yaml.safe_load_all(f))
            except yaml.YAMLError as e:
                print(f"    ⚠️  Error parsing {crd_file}: {e}")
                continue

            for doc in docs:
                if not doc or doc.get('kind') != 'CustomResourceDefinition':
                    continue

                schemas = convert_crd_to_schema(doc)

                for filename, schema in schemas.items():
                    output_path = output_dir / filename
                    with open(output_path, 'w') as out:
                        json.dump(schema, out, indent=2)
                    total_schemas += 1
                    print(f"    ✅ {filename}")

    print(f"\n✅ Converted {total_schemas} schemas to {output_dir}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: convert-crds-to-schemas.py <schema-directory>")
        sys.exit(1)

    main(sys.argv[1])
