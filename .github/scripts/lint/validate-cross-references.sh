#!/bin/bash
set -euo pipefail

# Check if yq is installed
if ! command -v yq &> /dev/null; then
    echo "❌ yq not found. Please install it first:"
    echo "   macOS: brew install yq"
    echo "   Linux: wget https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64"
    exit 1
fi

echo "🔍 Validating cross-references in CAPI manifests"
echo ""

ERRORS=0

# Find all YAML files with CAPI resources
while IFS= read -r file; do
    # Extract Cluster resources and validate their references
    while IFS= read -r line; do
        if [ -z "${line}" ] || [ "${line}" == "null" ] || [ "${line}" == "---" ]; then
            continue
        fi

        cluster_name=$(echo "${line}" | yq e '.name' - 2>/dev/null)
        cp_ref=$(echo "${line}" | yq e '.controlPlaneRef' - 2>/dev/null)
        infra_ref=$(echo "${line}" | yq e '.infrastructureRef' - 2>/dev/null)

        if [ "${cluster_name}" == "null" ] || [ -z "${cluster_name}" ]; then
            continue
        fi

        echo "  📄 $(basename "${file}"): Cluster '${cluster_name}'"

        # Check if controlPlaneRef exists
        if [ "${cp_ref}" != "null" ] && [ -n "${cp_ref}" ]; then
            if ! yq eval-all "select(.kind == \"RKE2ControlPlane\" and .metadata.name == \"${cp_ref}\")" "${file}" 2>/dev/null | grep -q "kind:"; then
                echo "    ❌ References missing RKE2ControlPlane '${cp_ref}'"
                ERRORS=$((ERRORS + 1))
            else
                echo "    ✅ RKE2ControlPlane '${cp_ref}' found"
            fi
        fi

        # Check if infrastructureRef exists
        if [ "${infra_ref}" != "null" ] && [ -n "${infra_ref}" ]; then
            if ! yq eval-all "select(.kind == \"Metal3Cluster\" and .metadata.name == \"${infra_ref}\")" "${file}" 2>/dev/null | grep -q "kind:"; then
                echo "    ❌ References missing Metal3Cluster '${infra_ref}'"
                ERRORS=$((ERRORS + 1))
            else
                echo "    ✅ Metal3Cluster '${infra_ref}' found"
            fi
        fi

    done < <(yq eval-all 'select(.kind == "Cluster") | {"name": .metadata.name, "controlPlaneRef": .spec.controlPlaneRef.name, "infrastructureRef": .spec.infrastructureRef.name}' "${file}" 2>/dev/null)

done < <(find telco-examples -type f -name "*.yaml" ! -path "*/eib/*")

echo ""
echo "════════════════════════════════════════"

if [ ${ERRORS} -gt 0 ]; then
    echo "❌ Found ${ERRORS} cross-reference error(s)"
    exit 1
fi

echo "✅ All cross-references validated"
