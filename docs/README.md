# ATIP CAPI Manifest Generator

A web-based tool to generate Cluster API (CAPI) manifests for SUSE Edge Telco deployments.

## Overview

This generator helps create custom CAPI manifests based on your specific requirements by asking a series of questions about your deployment. Instead of manually combining snippets from multiple example files, the tool generates the exact configuration you need.

## Features

- **Comprehensive Configuration Options**:
  - Architecture (AMD64, ARM64)
  - Network types (DHCP, static IP)
  - IP versions (IPv4, IPv6, Dual-stack)
  - CNI plugins (Calico, Canal, Cilium)
  - Multus CNI with IPAM options
  - Node topology (single-node, multi-node with/without workers)
  - MetalLB for HA control plane
  - Airgap/private registry support
  - Telco features:
    - SR-IOV (Auto discovery or Manual with DPDK/FEC)
    - CPU Manager / Performance tuning
    - CIS security profile

- **Generated Outputs**:
  - Complete CAPI manifests
  - BareMetalHost (BMH) templates
  - Variable reference documentation

- **Use Case Coverage**:
  This generator covers all combinations found in the `telco-examples/edge-clusters/` directory, including:
  - Single-node and multi-node clusters
  - IPv4, IPv6, and dual-stack networking
  - DHCP and static IP configurations
  - Various CNI combinations
  - Airgap deployments
  - Telco-specific optimizations

## Usage

### GitHub Pages (Recommended)

1. Enable GitHub Pages for this repository:
   - Go to repository Settings → Pages
   - Source: Deploy from branch
   - Branch: `main` (or `study-case-generator`)
   - Folder: `/docs`
   - Save

2. Access the tool at: `https://<your-username>.github.io/atip/`

### Local Development

```bash
# Serve locally using Python
cd docs
python3 -m http.server 8000

# Or using Node.js
npx http-server .

# Open http://localhost:8000 in your browser
```

## Workflow

1. **Fill out the form** with your deployment requirements
2. **Generate manifests** by clicking the "Generate Manifests" button
3. **Review the output** in three tabs:
   - **CAPI Manifests**: Complete cluster configuration
   - **BareMetalHost**: BMH templates (if requested)
   - **Variables Reference**: List of all placeholders you need to replace
4. **Copy to clipboard** using the copy buttons
5. **Replace variables** with your actual values
6. **Apply manifests** to your management cluster

## Variables

All generated manifests contain placeholder variables in the format `${VARIABLE_NAME}`. These must be replaced with actual values before applying to your cluster.

Common variables include:
- `${RKE2_VERSION}` - RKE2 Kubernetes version
- `${EDGE_CONTROL_PLANE_IP}` - Control plane endpoint IP
- `${BMC_ADDRESS}` - Baseboard Management Controller address
- `${BMC_USERNAME}` / `${BMC_PASSWORD}` - BMC credentials (base64 encoded)

The **Variables Reference** tab shows all required variables for your specific configuration.

## Example Combinations

The generator can create manifests for scenarios like:

- **Basic single-node IPv4 cluster with DHCP**
  - Architecture: AMD64
  - Network: DHCP
  - IP: IPv4
  - Nodes: Single

- **Multi-node IPv6 cluster with MetalLB and SR-IOV**
  - Architecture: AMD64
  - Network: Static IP
  - IP: IPv6
  - Nodes: Multi-node (3 CP + workers)
  - Features: SR-IOV, MetalLB

- **Dual-stack airgap cluster with full telco features**
  - Architecture: ARM64
  - Network: Static IP
  - IP: Dual-stack
  - Deployment: Airgap
  - Features: SR-IOV (Auto mode), CPU Manager, CIS profile, Multus

## SR-IOV Configuration Modes

The generator supports two SR-IOV modes:

### Auto Discovery Mode (Recommended)

- Uses SR-IOV Network Operator
- Simpler configuration - only needs interface names and VF counts
- Automatic resource discovery
- Uses `sriov-custom-auto-vfs.service` systemd unit
- Best for: Standard SR-IOV networking use cases

**Required Variables:**

- `RESOURCE_NAME1/2`: Resource identifiers
- `SRIOV_NIC_NAME1/2`: Network interface names
- `PF_NAME1/2`: Physical function names
- `DRIVER_NAME1/2`: Driver (e.g., vfio-pci)
- `NUM_VFS1/2`: Number of VFs to create

### Manual Mode (Advanced)

- Uses SR-IOV Device Plugin DaemonSet
- Requires detailed hardware knowledge (PCI addresses, vendor/device IDs)
- Support for DPDK and FEC accelerators (ACC100/ACC200)
- Uses `dpdk-vf-creation.service` systemd unit
- Best for: Advanced telco workloads with FEC cards, DPDK, specific hardware tuning

**Required Variables:**

- `SRIOV_VENDOR`: Vendor ID (e.g., 8086 for Intel)
- `SRIOV_DEVICE`: Device ID (e.g., 0d58)
- `SRIOV_NET_INTERFACE`: PF interface name
- `DPDK_PCI_ADDRESS`: PCI address for DPDK binding

## Files

- `index.html` - Web interface
- `generator.js` - Manifest generation logic
- `README.md` - This documentation

## Contributing

To add new features or fix issues:

1. Edit `index.html` for UI changes
2. Edit `generator.js` for manifest generation logic
3. Test locally before committing
4. Keep the generator in sync with examples in `telco-examples/edge-clusters/`

## Related Documentation

- [Edge Clusters README](../telco-examples/edge-clusters/README.md)
- [SUSE Edge Documentation](https://documentation.suse.com/suse-edge/)
- [Cluster API Documentation](https://cluster-api.sigs.k8s.io/)
