#!/bin/bash
set -euo pipefail

TARGET_DIR="${1:-.}"
SCHEMA_DIR=".schemas/openapi"

# Check if kubeconform is installed
if ! command -v kubeconform &> /dev/null; then
    echo "❌ kubeconform not found. Please install it first:"
    echo "   macOS: brew install kubeconform"
    echo "   Linux: wget https://github.com/yannh/kubeconform/releases/latest/download/kubeconform-linux-amd64.tar.gz"
    exit 1
fi

# Check if schemas exist
if [ ! -d "${SCHEMA_DIR}" ]; then
    echo "❌ Schema directory not found: ${SCHEMA_DIR}"
    echo "   Run: bash scripts/lint/download-crd-schemas.sh"
    exit 1
fi

# Temporary directory for preprocessing
TEMP_DIR=$(mktemp -d)
trap "rm -rf ${TEMP_DIR}" EXIT

echo "🔍 Validating CAPI manifests in: ${TARGET_DIR}"
echo ""

ERRORS=0
VALIDATED=0

# Find all YAML files, excluding EIB configs
while IFS= read -r file; do
    echo "  📄 $(basename "${file}")"

    # Preprocess: Replace template variables with placeholder values
    # This allows validation to pass while preserving template structure
    PROCESSED="${TEMP_DIR}/$(basename "${file}")"

    sed -e 's/\${[^}]*}/TEMPLATE_PLACEHOLDER/g' "${file}" > "${PROCESSED}"

    # Run kubeconform with:
    # - Skip Kubernetes built-in types (Secret, ConfigMap, etc.)
    # - Use our custom CRD schemas
    # - Strict mode for unknown fields
    # - Ignore missing schemas (for helm.cattle.io which is Rancher-specific)

    if kubeconform \
        -schema-location default \
        -schema-location "${SCHEMA_DIR}/{{ .ResourceKind }}-{{ .Group }}-{{ .ResourceAPIVersion }}.json" \
        -skip "Secret,ConfigMap,Namespace" \
        -ignore-missing-schemas \
        -strict \
        -verbose \
        "${PROCESSED}"; then
        VALIDATED=$((VALIDATED + 1))
    else
        echo "    ❌ Validation failed"
        ERRORS=$((ERRORS + 1))
    fi

    echo ""
done < <(find "${TARGET_DIR}" -type f -name "*.yaml" ! -path "*/eib/*" ! -path "*/.schemas/*")

echo "════════════════════════════════════════"
if [ ${ERRORS} -gt 0 ]; then
    echo "❌ Validation completed with ${ERRORS} error(s)"
    echo "✅ ${VALIDATED} file(s) validated successfully"
    exit 1
fi

echo "✅ All ${VALIDATED} CAPI manifest(s) validated successfully"
