#!/bin/bash
set -euo pipefail

# Auto-detects apiVersions from manifests and finds matching CRD releases
# This can take several minutes on first run as it downloads large files

MANIFESTS_DIR="${1:-telco-examples}"
SCHEMA_DIR=".schemas"
CACHE_DIR="${SCHEMA_DIR}/cache"

mkdir -p "${SCHEMA_DIR}" "${CACHE_DIR}"

echo "🔍 Step 1: Detecting apiVersions in manifests..." >&2
echo "" >&2

# Extract unique apiVersions from all YAML files
APIS=$(find "${MANIFESTS_DIR}" -name "*.yaml" ! -path "*/eib/*" -exec grep -h "^apiVersion:" {} \; 2>/dev/null | sort -u | sed 's/apiVersion: *//')

echo "   Found apiVersions:" >&2
echo "${APIS}" | sed 's/^/     - /' >&2
echo "" >&2

# Function to check if a release supports a specific apiVersion
# This is slow because it downloads large YAML files
check_release_for_apiversion() {
    local repo="$1"
    local release="$2"
    local component_file="$3"
    local apiversion="$4"
    local cache_file="${CACHE_DIR}/$(echo ${repo}_${release}_${apiversion} | tr '/' '_' | tr '.' '_').result"

    # Check cache first
    if [ -f "${cache_file}" ]; then
        local result=$(cat "${cache_file}")
        if [ "${result}" = "yes" ]; then
            return 0
        else
            return 1
        fi
    fi

    echo "     Checking ${release}..." >&2

    # Download and check CRDs
    local url="https://github.com/${repo}/releases/download/${release}/${component_file}"
    local temp_file="${CACHE_DIR}/temp_${release}.yaml"

    # Download to temp file
    if ! curl -sSL "${url}" -o "${temp_file}" 2>/dev/null; then
        echo "no" > "${cache_file}"
        rm -f "${temp_file}"
        return 1
    fi

    # Check if apiVersion exists in CRDs
    # Extract all version names from CRDs
    local versions
    versions=$(yq eval 'select(.kind == "CustomResourceDefinition") | .spec.versions[].name' "${temp_file}" 2>/dev/null || echo "")

    if [ -z "${versions}" ]; then
        echo "no" > "${cache_file}"
        rm -f "${temp_file}"
        return 1
    fi

    # Check if our apiVersion is in the list
    if echo "${versions}" | grep -q "^${apiversion}$"; then
        echo "yes" > "${cache_file}"
        rm -f "${temp_file}"
        return 0
    else
        echo "no" > "${cache_file}"
        rm -f "${temp_file}"
        return 1
    fi
}

# Function to find best release for an apiVersion
find_release_for_apiversion() {
    local repo="$1"
    local component_file="$2"
    local apiversion="$3"
    local max_releases="${4:-15}"

    echo "   Searching ${repo} for ${apiversion}..." >&2
    echo "   (This may take a few minutes, checking up to ${max_releases} releases)" >&2

    # Get releases from GitHub API
    local releases=$(curl -sSL "https://api.github.com/repos/${repo}/releases?per_page=${max_releases}" 2>/dev/null \
        | jq -r '.[].tag_name' 2>/dev/null)

    if [ -z "${releases}" ]; then
        echo "     ⚠️  Could not fetch releases from GitHub API" >&2
        return 1
    fi

    local count=0
    # Try each release until we find one that supports this apiVersion
    for release in ${releases}; do
        count=$((count + 1))

        # Skip pre-releases (e.g., v1.13.0-rc.1, v1.13.0-beta.1)
        if echo "${release}" | grep -qE '\-(alpha|beta|rc|RC)\.'; then
            continue
        fi

        if check_release_for_apiversion "${repo}" "${release}" "${component_file}" "${apiversion}"; then
            echo "     ✅ Found in ${release} (checked ${count} releases)" >&2
            echo "${release}"
            return 0
        fi
    done

    echo "     ⚠️  Not found in ${count} releases checked" >&2
    return 1
}

echo "🔎 Step 2: Finding matching GitHub releases..." >&2
echo "⏱️  This may take several minutes on first run..." >&2
echo "" >&2

# Determine CAPI version
CAPI_VERSION=""
if echo "${APIS}" | grep -q "cluster.x-k8s.io/v1beta2"; then
    CAPI_VERSION=$(find_release_for_apiversion "kubernetes-sigs/cluster-api" "cluster-api-components.yaml" "v1beta2" 15)
elif echo "${APIS}" | grep -q "cluster.x-k8s.io/v1beta1"; then
    CAPI_VERSION=$(find_release_for_apiversion "kubernetes-sigs/cluster-api" "cluster-api-components.yaml" "v1beta1" 15)
fi

if [ -z "${CAPI_VERSION}" ]; then
    echo "   Falling back to latest CAPI release..." >&2
    CAPI_VERSION=$(curl -sSL "https://api.github.com/repos/kubernetes-sigs/cluster-api/releases/latest" | jq -r '.tag_name' 2>/dev/null || echo "v1.13.2")
fi

echo "" >&2

# Determine CAPM3 version
CAPM3_VERSION=""
if echo "${APIS}" | grep -q "infrastructure.cluster.x-k8s.io/v1beta1"; then
    CAPM3_VERSION=$(find_release_for_apiversion "metal3-io/cluster-api-provider-metal3" "infrastructure-components.yaml" "v1beta1" 15)
fi

if [ -z "${CAPM3_VERSION}" ]; then
    echo "   Falling back to latest CAPM3 release..." >&2
    CAPM3_VERSION=$(curl -sSL "https://api.github.com/repos/metal3-io/cluster-api-provider-metal3/releases/latest" | jq -r '.tag_name' 2>/dev/null || echo "v1.13.0")
fi

echo "" >&2

# Determine RKE2 Provider version
CAPRKE2_VERSION=""
if echo "${APIS}" | grep -q "controlplane.cluster.x-k8s.io/v1beta2\|bootstrap.cluster.x-k8s.io/v1beta2"; then
    CAPRKE2_VERSION=$(find_release_for_apiversion "rancher/cluster-api-provider-rke2" "bootstrap-components.yaml" "v1beta2" 15)
elif echo "${APIS}" | grep -q "controlplane.cluster.x-k8s.io/v1beta1"; then
    CAPRKE2_VERSION=$(find_release_for_apiversion "rancher/cluster-api-provider-rke2" "bootstrap-components.yaml" "v1beta1" 15)
fi

if [ -z "${CAPRKE2_VERSION}" ]; then
    echo "   Falling back to latest RKE2 Provider release..." >&2
    CAPRKE2_VERSION=$(curl -sSL "https://api.github.com/repos/rancher/cluster-api-provider-rke2/releases/latest" | jq -r '.tag_name' 2>/dev/null || echo "v0.24.4")
fi

echo "" >&2

# Determine Metal3 version
METAL3_VERSION=""
if echo "${APIS}" | grep -q "metal3.io/v1alpha1"; then
    METAL3_VERSION=$(find_release_for_apiversion "metal3-io/baremetal-operator" "baremetal-operator.yaml" "v1alpha1" 15)
fi

if [ -z "${METAL3_VERSION}" ]; then
    echo "   Falling back to latest Metal3 release..." >&2
    METAL3_VERSION=$(curl -sSL "https://api.github.com/repos/metal3-io/baremetal-operator/releases/latest" | jq -r '.tag_name' 2>/dev/null || echo "v0.13.0")
fi

echo "" >&2
echo "✅ Resolved versions:" >&2
echo "   → CAPI: ${CAPI_VERSION}" >&2
echo "   → CAPM3: ${CAPM3_VERSION}" >&2
echo "   → RKE2 Provider: ${CAPRKE2_VERSION}" >&2
echo "   → Metal3: ${METAL3_VERSION}" >&2
echo "" >&2

echo "📦 Step 3: Downloading CRD schemas..." >&2
echo "" >&2

# Download CAPI core schemas
echo "  Downloading CAPI ${CAPI_VERSION}..." >&2
curl -sSL "https://github.com/kubernetes-sigs/cluster-api/releases/download/${CAPI_VERSION}/cluster-api-components.yaml" \
  | yq eval-all 'select(.kind == "CustomResourceDefinition")' - \
  > "${SCHEMA_DIR}/capi-crds.yaml"

# Download CAPM3 schemas
echo "  Downloading CAPM3 ${CAPM3_VERSION}..." >&2
curl -sSL "https://github.com/metal3-io/cluster-api-provider-metal3/releases/download/${CAPM3_VERSION}/infrastructure-components.yaml" \
  | yq eval-all 'select(.kind == "CustomResourceDefinition")' - \
  > "${SCHEMA_DIR}/capm3-crds.yaml"

# Download RKE2 provider schemas
echo "  Downloading RKE2 Provider ${CAPRKE2_VERSION} (bootstrap)..." >&2
curl -sSL "https://github.com/rancher/cluster-api-provider-rke2/releases/download/${CAPRKE2_VERSION}/bootstrap-components.yaml" \
  | yq eval-all 'select(.kind == "CustomResourceDefinition")' - \
  > "${SCHEMA_DIR}/caprke2-bootstrap-crds.yaml"

echo "  Downloading RKE2 Provider ${CAPRKE2_VERSION} (controlplane)..." >&2
curl -sSL "https://github.com/rancher/cluster-api-provider-rke2/releases/download/${CAPRKE2_VERSION}/control-plane-components.yaml" \
  | yq eval-all 'select(.kind == "CustomResourceDefinition")' - \
  > "${SCHEMA_DIR}/caprke2-controlplane-crds.yaml"

# Download Metal3 BareMetalHost schemas
echo "  Downloading Metal3 ${METAL3_VERSION}..." >&2
curl -sSL "https://github.com/metal3-io/baremetal-operator/releases/download/${METAL3_VERSION}/baremetal-operator.yaml" \
  | yq eval-all 'select(.kind == "CustomResourceDefinition")' - \
  > "${SCHEMA_DIR}/metal3-crds.yaml"

# Convert CRDs to OpenAPI schemas
echo "" >&2
echo "🔧 Step 4: Converting CRDs to OpenAPI schemas..." >&2
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 "${SCRIPT_DIR}/convert-crds-to-schemas.py" "${SCHEMA_DIR}"

echo "" >&2
echo "✅ Done! Schemas saved to ${SCHEMA_DIR}/openapi/" >&2
echo "   Subsequent runs will be faster thanks to caching." >&2
