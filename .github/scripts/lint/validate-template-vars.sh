#!/bin/bash
set -euo pipefail

# Validates template variables in YAML manifests
# Accepts ANY ${VAR} as valid - no hardcoded list needed
# Only checks for format errors

echo "🔍 Validating template variables format..." >&2
echo "" >&2

ERRORS=0

# Check for format errors
echo "  Checking variable format..." >&2

while IFS= read -r file; do
    line_num=0

    # Check for variables without braces: $VAR instead of ${VAR}
    # This is tricky because $$ (process ID) is valid in shell
    while IFS= read -r line; do
        line_num=$((line_num + 1))

        # Look for $WORD patterns that aren't ${WORD}
        # Exclude $$ (PID), $! (last background job), etc.
        if echo "${line}" | grep -qE '\$[A-Z_][A-Z0-9_]*[^{]'; then
            # Make sure it's not already ${VAR}
            if ! echo "${line}" | grep -qE '\$\{[A-Z_][A-Z0-9_]*\}'; then
                echo "  ❌ ${file}:${line_num}: Variable without braces (use \${VAR} not \$VAR)" >&2
                ERRORS=$((ERRORS + 1))
            fi
        fi
    done < "${file}"

    # Check for unclosed variables: ${VAR without }
    if grep -qE '\$\{[^}]*$' "${file}" 2>/dev/null; then
        echo "  ❌ ${file}: Found unclosed variable (missing })" >&2
        ERRORS=$((ERRORS + 1))
    fi

    # Check for empty variables: ${}
    if grep -q '\${}' "${file}" 2>/dev/null; then
        echo "  ❌ ${file}: Found empty variable \${}" >&2
        ERRORS=$((ERRORS + 1))
    fi

done < <(find telco-examples -type f -name "*.yaml" ! -path "*/eib/*")

# Collect all unique variables across all files
echo "" >&2
echo "  Collecting template variables..." >&2
ALL_VARS=$(find telco-examples -type f -name "*.yaml" ! -path "*/eib/*" \
    -exec grep -oh '\${[^}]*}' {} \; 2>/dev/null \
    | sed 's/[${}]//g' \
    | sort -u || echo "")

if [ -n "${ALL_VARS}" ]; then
    TOTAL_VARS=$(echo "${ALL_VARS}" | wc -l | tr -d ' ')
    echo "  Found ${TOTAL_VARS} unique template variable(s)" >&2
else
    TOTAL_VARS=0
    echo "  No template variables found" >&2
fi

echo "" >&2
echo "════════════════════════════════════════" >&2

if [ ${ERRORS} -gt 0 ]; then
    echo "❌ Found ${ERRORS} format error(s)" >&2
    echo "" >&2
    echo "Common issues:" >&2
    echo "  - Use \${VAR} not \$VAR" >&2
    echo "  - Ensure all variables are closed with }" >&2
    exit 1
fi

echo "✅ All template variables use correct format" >&2
if [ ${TOTAL_VARS} -gt 0 ]; then
    echo "   Total unique variables: ${TOTAL_VARS}" >&2
    echo "" >&2
    echo "   Any \${...} format is accepted as valid." >&2
    echo "   No need to maintain a hardcoded variable list." >&2
fi
