#!/bin/bash
set -euo pipefail

# Check if yq is installed
if ! command -v yq &> /dev/null; then
    echo "❌ yq not found. Please install it first:"
    echo "   macOS: brew install yq"
    echo "   Linux: wget https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64"
    exit 1
fi

echo "🔍 Validating required fields in CAPI resources"
echo ""

ERRORS=0

validate_cluster() {
    local file=$1

    # Validate Cluster resources
    while IFS= read -r name; do
        if [ -z "${name}" ] || [ "${name}" == "null" ]; then
            continue
        fi

        echo "  📄 $(basename "${file}"): Cluster '${name}'"

        # Check clusterNetwork
        if ! yq eval-all "select(.kind == \"Cluster\" and .metadata.name == \"${name}\") | .spec.clusterNetwork.pods" "${file}" 2>/dev/null | grep -q "cidrBlocks:"; then
            echo "    ❌ Missing spec.clusterNetwork.pods"
            ERRORS=$((ERRORS + 1))
        else
            echo "    ✅ spec.clusterNetwork present"
        fi

        # Check controlPlaneRef
        if ! yq eval-all "select(.kind == \"Cluster\" and .metadata.name == \"${name}\") | .spec.controlPlaneRef.kind" "${file}" 2>/dev/null | grep -qv "null"; then
            echo "    ❌ Missing spec.controlPlaneRef"
            ERRORS=$((ERRORS + 1))
        else
            echo "    ✅ spec.controlPlaneRef present"
        fi

        # Check infrastructureRef
        if ! yq eval-all "select(.kind == \"Cluster\" and .metadata.name == \"${name}\") | .spec.infrastructureRef.kind" "${file}" 2>/dev/null | grep -qv "null"; then
            echo "    ❌ Missing spec.infrastructureRef"
            ERRORS=$((ERRORS + 1))
        else
            echo "    ✅ spec.infrastructureRef present"
        fi

    done < <(yq eval-all 'select(.kind == "Cluster") | .metadata.name' "${file}" 2>/dev/null)
}

validate_metal3cluster() {
    local file=$1

    # Validate Metal3Cluster resources
    while IFS= read -r name; do
        if [ -z "${name}" ] || [ "${name}" == "null" ]; then
            continue
        fi

        echo "  📄 $(basename "${file}"): Metal3Cluster '${name}'"

        # Check controlPlaneEndpoint.host
        if ! yq eval-all "select(.kind == \"Metal3Cluster\" and .metadata.name == \"${name}\") | .spec.controlPlaneEndpoint.host" "${file}" 2>/dev/null | grep -qv "null"; then
            echo "    ❌ Missing spec.controlPlaneEndpoint.host"
            ERRORS=$((ERRORS + 1))
        else
            echo "    ✅ spec.controlPlaneEndpoint.host present"
        fi

    done < <(yq eval-all 'select(.kind == "Metal3Cluster") | .metadata.name' "${file}" 2>/dev/null)
}

validate_baremetalhost() {
    local file=$1

    # Validate BareMetalHost resources
    while IFS= read -r name; do
        if [ -z "${name}" ] || [ "${name}" == "null" ]; then
            continue
        fi

        echo "  📄 $(basename "${file}"): BareMetalHost '${name}'"

        # Check bootMACAddress
        if ! yq eval-all "select(.kind == \"BareMetalHost\" and .metadata.name == \"${name}\") | .spec.bootMACAddress" "${file}" 2>/dev/null | grep -qv "null"; then
            echo "    ❌ Missing spec.bootMACAddress"
            ERRORS=$((ERRORS + 1))
        else
            echo "    ✅ spec.bootMACAddress present"
        fi

        # Check bmc.address
        if ! yq eval-all "select(.kind == \"BareMetalHost\" and .metadata.name == \"${name}\") | .spec.bmc.address" "${file}" 2>/dev/null | grep -qv "null"; then
            echo "    ❌ Missing spec.bmc.address"
            ERRORS=$((ERRORS + 1))
        else
            echo "    ✅ spec.bmc.address present"
        fi

    done < <(yq eval-all 'select(.kind == "BareMetalHost") | .metadata.name' "${file}" 2>/dev/null)
}

validate_rke2controlplane() {
    local file=$1

    # Validate RKE2ControlPlane resources
    while IFS= read -r name; do
        if [ -z "${name}" ] || [ "${name}" == "null" ]; then
            continue
        fi

        echo "  📄 $(basename "${file}"): RKE2ControlPlane '${name}'"

        # Check machineTemplate
        if ! yq eval-all "select(.kind == \"RKE2ControlPlane\" and .metadata.name == \"${name}\") | .spec.machineTemplate" "${file}" 2>/dev/null | grep -q "infrastructureRef:"; then
            echo "    ❌ Missing spec.machineTemplate"
            ERRORS=$((ERRORS + 1))
        else
            echo "    ✅ spec.machineTemplate present"
        fi

        # Check version
        if ! yq eval-all "select(.kind == \"RKE2ControlPlane\" and .metadata.name == \"${name}\") | .spec.version" "${file}" 2>/dev/null | grep -qv "null"; then
            echo "    ❌ Missing spec.version"
            ERRORS=$((ERRORS + 1))
        else
            echo "    ✅ spec.version present"
        fi

        # Check replicas
        if ! yq eval-all "select(.kind == \"RKE2ControlPlane\" and .metadata.name == \"${name}\") | .spec.replicas" "${file}" 2>/dev/null | grep -qE "[0-9]+"; then
            echo "    ❌ Missing spec.replicas"
            ERRORS=$((ERRORS + 1))
        else
            echo "    ✅ spec.replicas present"
        fi

    done < <(yq eval-all 'select(.kind == "RKE2ControlPlane") | .metadata.name' "${file}" 2>/dev/null)
}

# Process all YAML files
while IFS= read -r file; do
    validate_cluster "${file}"
    validate_metal3cluster "${file}"
    validate_baremetalhost "${file}"
    validate_rke2controlplane "${file}"
done < <(find telco-examples -type f -name "*.yaml" ! -path "*/eib/*")

echo ""
echo "════════════════════════════════════════"

if [ ${ERRORS} -gt 0 ]; then
    echo "❌ Found ${ERRORS} required field error(s)"
    exit 1
fi

echo "✅ All required fields validated"
