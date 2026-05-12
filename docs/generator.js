// Event Listeners
document.getElementById('wizardForm').addEventListener('submit', function(e) {
    e.preventDefault();
    generateManifests();
});

document.getElementById('multusEnable').addEventListener('change', function() {
    document.getElementById('multusOptions').classList.toggle('hidden', !this.checked);
});

document.getElementById('nodeConfig').addEventListener('change', function() {
    const isMulti = this.value.includes('multi');
    const hasWorkers = this.value === 'multi-with-workers';
    document.getElementById('workerConfig').classList.toggle('hidden', !hasWorkers);
    document.getElementById('metallbConfig').classList.toggle('hidden', !isMulti);
});

document.getElementById('networkType').addEventListener('change', function() {
    document.getElementById('dhcpInfo').classList.toggle('hidden', this.value !== 'dhcp');
    document.getElementById('staticInfo').classList.toggle('hidden', this.value !== 'dhcp-less');
});

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', function() {
        const targetTab = this.dataset.tab;
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        this.classList.add('active');
        document.getElementById(targetTab + '-content').classList.add('active');
    });
});

function copyToClipboard(elementId) {
    const textarea = document.getElementById(elementId);
    textarea.select();
    document.execCommand('copy');
    alert('Copied to clipboard!');
}

function generateManifests() {
    const config = {
        clusterName: document.getElementById('clusterName').value || 'edge-cluster',
        architecture: document.getElementById('architecture').value,
        networkType: document.getElementById('networkType').value,
        ipVersion: document.getElementById('ipVersion').value,
        cni: document.getElementById('cni').value,
        multusEnable: document.getElementById('multusEnable').checked,
        multusIpam: document.getElementById('multusIpam').value,
        nodeConfig: document.getElementById('nodeConfig').value,
        workerCount: document.getElementById('workerCount').value || 3,
        useMetallb: document.getElementById('useMetallb').checked,
        deployment: document.getElementById('deployment').value,
        sriov: document.getElementById('sriov').checked,
        cpuManager: document.getElementById('cpuManager').checked,
        cisProfile: document.getElementById('cisProfile').checked,
        generateBMH: document.getElementById('generateBMH').checked
    };

    // Generate CAPI manifests
    let capiYaml = generateCluster(config);
    capiYaml += '\n---\n' + generateMetal3Cluster(config);
    capiYaml += '\n---\n' + generateRKE2ControlPlane(config);
    capiYaml += '\n---\n' + generateMetal3MachineTemplate(config);
    capiYaml += '\n---\n' + generateMetal3DataTemplate(config);

    // Add worker nodes for multi-node with workers
    if (config.nodeConfig === 'multi-with-workers') {
        capiYaml += '\n\n## Workers\n---\n' + generateMachineDeployment(config);
        capiYaml += '\n---\n' + generateRKE2ConfigTemplate(config);
        capiYaml += '\n---\n' + generateWorkerMetal3MachineTemplate(config);
        capiYaml += '\n---\n' + generateWorkerMetal3DataTemplate(config);
    }

    document.getElementById('capiYaml').value = capiYaml;

    // Generate BMH if requested
    if (config.generateBMH) {
        const bmhYaml = generateBareMetalHost(config);
        document.getElementById('bmhYaml').value = bmhYaml;
    } else {
        document.getElementById('bmhYaml').value = '# BMH generation not selected';
    }

    // Generate variables list
    generateVariablesList(config);

    document.getElementById('outputSection').classList.remove('hidden');
    document.getElementById('outputSection').scrollIntoView({ behavior: 'smooth' });
}

function generateCluster(config) {
    const podCIDR = getCIDRBlocks(config.ipVersion, 'pods');
    const serviceCIDR = getCIDRBlocks(config.ipVersion, 'services');

    return `apiVersion: cluster.x-k8s.io/v1beta1
kind: Cluster
metadata:
  name: ${config.clusterName}
  namespace: default
  labels:
    cluster-api.cattle.io/rancher-auto-import: "true"
spec:
  clusterNetwork:
    pods:
      cidrBlocks:
${podCIDR.map(c => `        - ${c}`).join('\n')}
    services:
      cidrBlocks:
${serviceCIDR.map(c => `        - ${c}`).join('\n')}
  controlPlaneRef:
    apiVersion: controlplane.cluster.x-k8s.io/v1beta1
    kind: RKE2ControlPlane
    name: ${config.clusterName}
  infrastructureRef:
    apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
    kind: Metal3Cluster
    name: ${config.clusterName}`;
}

function generateMetal3Cluster(config) {
    const isMulti = config.nodeConfig.includes('multi');
    const ipVar = config.ipVersion === 'dualstack' ? '${EDGE_CONTROL_PLANE_IP_V4}' : '${EDGE_CONTROL_PLANE_IP}';
    const vipVar = '${EDGE_VIP_ADDRESS}';

    return `apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
kind: Metal3Cluster
metadata:
  name: ${config.clusterName}
  namespace: default
spec:
  controlPlaneEndpoint:
    host: ${isMulti && config.useMetallb ? vipVar : ipVar}
    port: 6443
  noCloudProvider: true`;
}

function generateRKE2ControlPlane(config) {
    const isMulti = config.nodeConfig.includes('multi');
    const replicas = config.nodeConfig === 'single' ? 1 : 3;
    const hasIPv6 = config.ipVersion === 'ipv6' || config.ipVersion === 'dualstack';

    let yaml = `apiVersion: controlplane.cluster.x-k8s.io/v1beta1
kind: RKE2ControlPlane
metadata:
  name: ${config.clusterName}
  namespace: default`;

    if (isMulti && config.useMetallb) {
        yaml += `
  annotations:
    rke2.controlplane.cluster.x-k8s.io/load-balancer-exclusion: "true"`;
    }

    yaml += `
spec:
  infrastructureRef:
    apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
    kind: Metal3MachineTemplate
    name: ${config.clusterName}-controlplane
  replicas: ${replicas}
  version: \${RKE2_VERSION}
  rolloutStrategy:
    type: "RollingUpdate"
    rollingUpdate:
      maxSurge: 0
  registrationMethod: "control-plane-endpoint"`;

    if (isMulti && config.useMetallb) {
        yaml += `
  registrationAddress: \${EDGE_VIP_ADDRESS}`;
    }

    // Airgap configuration
    if (config.deployment === 'airgap') {
        yaml += `
  privateRegistriesConfig:
    mirrors:
      docker.io:
        endpoint:
          - "\${PRIVATE_REGISTRY_URL}"
        rewrite:
          "^(.*)$": "mirror/$1"
      registry.suse.com:
        endpoint:
          - "\${PRIVATE_REGISTRY_URL}"
        rewrite:
          "^(.*)$": "mirror/$1"
      registry.rancher.com:
        endpoint:
          - "\${PRIVATE_REGISTRY_URL}"
        rewrite:
          "^(.*)$": "mirror/$1"
    configs:
      "\${PRIVATE_REGISTRY_URL}":
        authSecret:
          name: private-registry-auth
        tlsSecret:
          name: private-registry-cert`;
    }

    yaml += `
  serverConfig:
    cni: ${config.cni}`;

    if (config.multusEnable) {
        yaml += `
    cniMultusEnable: true`;
    }

    if (hasIPv6 || (isMulti && config.useMetallb)) {
        yaml += `
    tlsSan:`;
        if (hasIPv6) {
            yaml += `
      - \${EDGE_CONTROL_PLANE_IP_V6}`;
        }
        if (isMulti && config.useMetallb) {
            yaml += `
      - \${EDGE_VIP_ADDRESS}
      - https://\${EDGE_VIP_ADDRESS}.sslip.io`;
        }
    }

    // preRKE2Commands for SR-IOV
    if (config.sriov) {
        yaml += `
  preRKE2Commands:
    - modprobe vfio-pci enable_sriov=1 disable_idle_d3=1`;
    }

    yaml += `
  agentConfig:
    format: ignition`;

    if (config.cisProfile) {
        yaml += `
    cisProfile: cis`;
    }

    yaml += `
    additionalUserData:
      config: |
        variant: fcos
        version: 1.4.0`;

    // Storage files
    yaml += `
        storage:
          files:`;

    // DNS resolver config
    if (hasIPv6) {
        yaml += generateDNSConfig(config);
    }

    // Multus configuration
    if (config.multusEnable && config.multusIpam !== 'none') {
        yaml += generateMultusConfig(config);
    }

    // SR-IOV configuration
    if (config.sriov) {
        yaml += generateSRIOVConfig(config);
    }

    // MetalLB for multi-node
    if (isMulti && config.useMetallb) {
        yaml += generateMetalLBConfig(config);
    }

    // Kernel arguments
    if (config.cpuManager || config.sriov) {
        yaml += generateKernelArgs(config);
    }

    // Systemd units
    yaml += generateSystemdUnits(config);

    yaml += `
    kubelet:
      extraArgs:
        - provider-id=metal3://BAREMETALHOST_UUID
    nodeName: "${config.nodeConfig === 'single' ? 'localhost.localdomain' : 'Node-' + config.clusterName}"`;

    return yaml;
}

function generateDNSConfig(config) {
    const nameservers = config.ipVersion === 'ipv6' ?
        'nameserver 2001:4860:4860::8844' :
        'nameserver 8.8.4.4\n                  nameserver 2001:4860:4860::8844';

    return `
            - path: /var/lib/rancher/rke2/agent/etc/resolv.conf
              overwrite: true
              contents:
                inline: |
                  ${nameservers}
              mode: 0644
              user:
                name: root
              group:
                name: root`;
}

function generateMultusConfig(config) {
    const ipam = config.multusIpam;
    const ipRanges = config.ipVersion === 'dualstack' ? `
                                  {
                                      "range":   "10.123.0.0/16",
                                      "gateway": "10.123.255.254"
                                  },
                                  {
                                      "range":   "fd:1234:4321::/64",
                                      "gateway": "fd:1234:4321:ffff::1"
                                  }` :
        config.ipVersion === 'ipv6' ? `
                                  {
                                      "range":   "fd:1234:4321::/64",
                                      "gateway": "fd:1234:4321:ffff::1"
                                  }` : `
                                  {
                                      "range":   "10.123.0.0/16",
                                      "gateway": "10.123.255.254"
                                  }`;

    let yaml = `
            - path: /var/lib/rancher/rke2/server/manifests/rke2-multus-config.yaml
              overwrite: true
              contents:
                inline: |
                  ---
                  apiVersion: helm.cattle.io/v1
                  kind: HelmChartConfig
                  metadata:
                    name: rke2-multus
                    namespace: kube-system
                  spec:
                    valuesContent: |-
                      rke2-whereabouts:
                        enabled: ${ipam === 'whereabouts' ? 'true' : 'false'}
              mode: 0644`;

    if (ipam === 'whereabouts') {
        yaml += `
            - path: /var/lib/rancher/rke2/server/manifests/nad-whereabouts.yaml
              overwrite: true
              contents:
                inline: |
                  ---
                  apiVersion: k8s.cni.cncf.io/v1
                  kind: NetworkAttachmentDefinition
                  metadata:
                    name: nad-test-conf
                    namespace: kube-system
                  spec:
                    config: |-
                      {
                          "cniVersion": "0.3.0",
                          "name": "ptp-whereabouts-conf",
                          "type": "ptp",
                          "ipam": {
                              "type": "whereabouts",
                              "ipRanges": [${ipRanges}
                              ]
                          }
                      }
              mode: 0644`;
    } else if (ipam === 'hostlocal') {
        yaml += `
            - path: /var/lib/rancher/rke2/server/manifests/nad-hostlocal.yaml
              overwrite: true
              contents:
                inline: |
                  ---
                  apiVersion: k8s.cni.cncf.io/v1
                  kind: NetworkAttachmentDefinition
                  metadata:
                    name: nad-test-conf
                    namespace: kube-system
                  spec:
                    config: |-
                      {
                          "cniVersion": "0.3.0",
                          "name": "ptp-hostlocal-conf",
                          "type": "ptp",
                          "ipam": {
                              "type": "host-local",
                              "subnet": "10.123.0.0/16"
                          }
                      }
              mode: 0644`;
    }

    return yaml;
}

function generateSRIOVConfig(config) {
    return `
            - path: /var/lib/rancher/rke2/server/manifests/sriov-crd.yaml
              overwrite: true
              contents:
                inline: |
                  apiVersion: helm.cattle.io/v1
                  kind: HelmChart
                  metadata:
                    name: sriov-crd
                    namespace: kube-system
                  spec:
                    chart: oci://registry.suse.com/edge/charts/sriov-crd
                    targetNamespace: sriov-network-operator
                    version: 305.0.4+up1.6.0
                    createNamespace: true
              mode: 0644
            - path: /var/lib/rancher/rke2/server/manifests/sriov-network-operator.yaml
              overwrite: true
              contents:
                inline: |
                  apiVersion: helm.cattle.io/v1
                  kind: HelmChart
                  metadata:
                    name: sriov-network-operator
                    namespace: kube-system
                  spec:
                    chart: oci://registry.suse.com/edge/charts/sriov-network-operator
                    targetNamespace: sriov-network-operator
                    version: 305.0.4+up1.6.0
                    createNamespace: true
              mode: 0644`;
}

function generateMetalLBConfig(config) {
    return `
            - path: /var/lib/rancher/rke2/server/manifests/endpoint-copier-operator.yaml
              overwrite: true
              contents:
                inline: |
                  apiVersion: helm.cattle.io/v1
                  kind: HelmChart
                  metadata:
                    name: endpoint-copier-operator
                    namespace: kube-system
                  spec:
                    chart: oci://registry.suse.com/edge/charts/endpoint-copier-operator
                    targetNamespace: endpoint-copier-operator
                    version: 305.0.1+up0.3.0
                    createNamespace: true
              mode: 0644
            - path: /var/lib/rancher/rke2/server/manifests/metallb.yaml
              overwrite: true
              contents:
                inline: |
                  apiVersion: helm.cattle.io/v1
                  kind: HelmChart
                  metadata:
                    name: metallb
                    namespace: kube-system
                  spec:
                    chart: oci://registry.suse.com/edge/charts/metallb
                    targetNamespace: metallb-system
                    version: 305.0.1+up0.15.2
                    createNamespace: true
              mode: 0644
            - path: /var/lib/rancher/rke2/server/manifests/metallb-cr.yaml
              overwrite: true
              contents:
                inline: |
                  apiVersion: metallb.io/v1beta1
                  kind: IPAddressPool
                  metadata:
                    name: kubernetes-vip-ip-pool
                    namespace: metallb-system
                  spec:
                    addresses:
                      - \${EDGE_VIP_ADDRESS}/32
                    serviceAllocation:
                      priority: 100
                      namespaces:
                        - default
                      serviceSelectors:
                        - matchExpressions:
                          - {key: "serviceType", operator: In, values: [kubernetes-vip]}
                  ---
                  apiVersion: metallb.io/v1beta1
                  kind: L2Advertisement
                  metadata:
                    name: ip-pool-l2-adv
                    namespace: metallb-system
                  spec:
                    ipAddressPools:
                      - kubernetes-vip-ip-pool
              mode: 0644
            - path: /var/lib/rancher/rke2/server/manifests/endpoint-svc.yaml
              overwrite: true
              contents:
                inline: |
                  apiVersion: v1
                  kind: Service
                  metadata:
                    name: kubernetes-vip
                    namespace: default
                    labels:
                      serviceType: kubernetes-vip
                  spec:
                    ports:
                    - name: rke2-api
                      port: 9345
                      protocol: TCP
                      targetPort: 9345
                    - name: k8s-api
                      port: 6443
                      protocol: TCP
                      targetPort: 6443
                    type: LoadBalancer
              mode: 0644`;
}

function generateKernelArgs(config) {
    let args = `
        kernel_arguments:
          should_exist:
            - intel_iommu=on
            - iommu=pt`;

    if (config.cpuManager) {
        args += `
            - idle=poll
            - mce=off
            - hugepagesz=1G hugepages=40
            - hugepagesz=2M hugepages=0
            - default_hugepagesz=1G
            - irqaffinity=\${NON_ISOLATED_CPU_CORES}
            - isolcpus=domain,nohz,managed_irq,\${ISOLATED_CPU_CORES}
            - nohz_full=\${ISOLATED_CPU_CORES}
            - rcu_nocbs=\${ISOLATED_CPU_CORES}
            - rcu_nocb_poll
            - nosoftlockup
            - nowatchdog
            - nohz=on
            - nmi_watchdog=0
            - skew_tick=1
            - quiet
            - rcupdate.rcu_cpu_stall_suppress=1
            - rcupdate.rcu_expedited=1
            - rcupdate.rcu_normal_after_boot=1
            - rcupdate.rcu_task_stall_timeout=0
            - rcutree.kthread_prio=99`;
    }

    return args;
}

function generateSystemdUnits(config) {
    let units = `
        systemd:
          units:
            - name: rke2-preinstall.service
              enabled: true
              contents: |
                [Unit]
                Description=rke2-preinstall
                Wants=network-online.target
                Before=rke2-install.service
                ConditionPathExists=!/run/cluster-api/bootstrap-success.complete
                [Service]
                Type=oneshot
                User=root
                ExecStartPre=/bin/sh -c "mount -L config-2 /mnt"
                ExecStart=/bin/sh -c "sed -i \\"s/BAREMETALHOST_UUID/$(jq -r .uuid /mnt/openstack/latest/meta_data.json)/\\" /etc/rancher/rke2/config.yaml"
                ExecStart=/bin/sh -c "echo \\"node-name: $(jq -r .name /mnt/openstack/latest/meta_data.json)\\" >> /etc/rancher/rke2/config.yaml"
                ExecStartPost=/bin/sh -c "umount /mnt"
                [Install]
                WantedBy=multi-user.target`;

    if (config.cpuManager) {
        units += `
            - name: cpu-partitioning.service
              enabled: true
              contents: |
                [Unit]
                Description=cpu-partitioning
                Wants=network-online.target
                After=network.target network-online.target
                [Service]
                Type=oneshot
                User=root
                ExecStart=/bin/sh -c "echo isolated_cores=\${ISOLATED_CPU_CORES} > /etc/tuned/cpu-partitioning-variables.conf"
                ExecStartPost=/bin/sh -c "tuned-adm profile cpu-partitioning"
                ExecStartPost=/bin/sh -c "systemctl enable tuned.service"
                [Install]
                WantedBy=multi-user.target
            - name: performance-settings.service
              enabled: true
              contents: |
                [Unit]
                Description=performance-settings
                Wants=network-online.target
                After=network.target network-online.target cpu-partitioning.service
                [Service]
                Type=oneshot
                User=root
                ExecStart=/bin/sh -c "/opt/performance-settings/performance-settings.sh"
                [Install]
                WantedBy=multi-user.target`;
    }

    return units;
}

function generateMetal3MachineTemplate(config) {
    const imageBaseName = config.architecture === 'aarch64' ?
        'slmicro-rt-telco-arm' : 'slemicro-rt-telco';

    return `apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
kind: Metal3MachineTemplate
metadata:
  name: ${config.clusterName}-controlplane
  namespace: default
spec:
  template:
    spec:${config.nodeConfig === 'single' ? `
      automatedCleaningMode: metadata` : ''}
      dataTemplate:
        name: ${config.clusterName}-controlplane-template
      hostSelector:
        matchLabels:
          cluster-role: control-plane
      image:
        checksum: http://imagecache.local:8080/eibimage-${imageBaseName}.raw.sha256
        checksumType: sha256
        format: raw
        url: http://imagecache.local:8080/eibimage-${imageBaseName}.raw`;
}

function generateMetal3DataTemplate(config) {
    return `apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
kind: Metal3DataTemplate
metadata:
  name: ${config.clusterName}-controlplane-template
  namespace: default
spec:
  clusterName: ${config.clusterName}
  metaData:
    objectNames:
      - key: name
        object: machine
      - key: local-hostname
        object: machine
      - key: local_hostname
        object: machine`;
}

function generateMachineDeployment(config) {
    return `apiVersion: cluster.x-k8s.io/v1beta1
kind: MachineDeployment
metadata:
  name: ${config.clusterName}-workers
  namespace: default
  labels:
    cluster.x-k8s.io/cluster-name: ${config.clusterName}
spec:
  clusterName: ${config.clusterName}
  replicas: \${WORKER_NODE_COUNT}
  selector:
    matchLabels:
      cluster.x-k8s.io/cluster-name: ${config.clusterName}
  template:
    spec:
      clusterName: ${config.clusterName}
      version: \${RKE2_VERSION}
      bootstrap:
        configRef:
          apiVersion: bootstrap.cluster.x-k8s.io/v1beta1
          kind: RKE2ConfigTemplate
          name: ${config.clusterName}-workers
      infrastructureRef:
        apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
        kind: Metal3MachineTemplate
        name: ${config.clusterName}-workers`;
}

function generateRKE2ConfigTemplate(config) {
    return `apiVersion: bootstrap.cluster.x-k8s.io/v1beta1
kind: RKE2ConfigTemplate
metadata:
  name: ${config.clusterName}-workers
  namespace: default
spec:
  template:
    spec:
      agentConfig:
        format: ignition
        kubelet:
          extraArgs:
            - provider-id=metal3://BAREMETALHOST_UUID`;
}

function generateWorkerMetal3MachineTemplate(config) {
    const imageBaseName = config.architecture === 'aarch64' ?
        'slmicro-rt-telco-arm' : 'slemicro-rt-telco';

    return `apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
kind: Metal3MachineTemplate
metadata:
  name: ${config.clusterName}-workers
  namespace: default
spec:
  template:
    spec:
      dataTemplate:
        name: ${config.clusterName}-workers-template
      hostSelector:
        matchLabels:
          cluster-role: worker
      image:
        checksum: http://imagecache.local:8080/eibimage-${imageBaseName}.raw.sha256
        checksumType: sha256
        format: raw
        url: http://imagecache.local:8080/eibimage-${imageBaseName}.raw`;
}

function generateWorkerMetal3DataTemplate(config) {
    return `apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
kind: Metal3DataTemplate
metadata:
  name: ${config.clusterName}-workers-template
  namespace: default
spec:
  clusterName: ${config.clusterName}
  metaData:
    objectNames:
      - key: name
        object: machine
      - key: local-hostname
        object: machine
      - key: local_hostname
        object: machine`;
}

function generateBareMetalHost(config) {
    const isMulti = config.nodeConfig.includes('multi');
    const hasWorkers = config.nodeConfig === 'multi-with-workers';
    const isDHCP = config.networkType === 'dhcp';
    const hasIPv6 = config.ipVersion === 'ipv6' || config.ipVersion === 'dualstack';

    let yaml = `---
apiVersion: v1
kind: Secret
metadata:
  name: controlplane-0-credentials
type: Opaque
data:
  username: \${BMC_USERNAME}
  password: \${BMC_PASSWORD}
`;

    // Network data secret for static IP
    if (!isDHCP) {
        yaml += `---
apiVersion: v1
kind: Secret
metadata:
  name: controlplane-0-networkdata
type: Opaque
stringData:
  networkData: |
    interfaces:
    - name: \${CONTROLPLANE_INTERFACE}
      type: ethernet
      state: up
      mtu: 1500
      identifier: mac-address
      mac-address: "\${CONTROLPLANE_MAC}"`;

        if (config.ipVersion === 'ipv4') {
            yaml += `
      ipv4:
        address:
        - ip: "\${CONTROLPLANE_IP}"
          prefix-length: "\${CONTROLPLANE_PREFIX}"
        enabled: true
        dhcp: false`;
        } else if (config.ipVersion === 'ipv6') {
            yaml += `
      ipv6:
        address:
        - ip: "\${CONTROLPLANE_IP_V6}"
          prefix-length: "\${CONTROLPLANE_PREFIX_V6}"
        enabled: true
        dhcp: false
        autoconf: false`;
        } else { // dualstack
            yaml += `
      ipv4:
        address:
        - ip: "\${CONTROLPLANE_IP}"
          prefix-length: "\${CONTROLPLANE_PREFIX}"
        enabled: true
        dhcp: false
      ipv6:
        address:
        - ip: "\${CONTROLPLANE_IP_V6}"
          prefix-length: "\${CONTROLPLANE_PREFIX_V6}"
        enabled: true
        dhcp: false
        autoconf: false`;
        }

        yaml += `
    dns-resolver:
      config:
        server:
        - "\${DNS_SERVER}"
    routes:
      config:
      - destination: ${config.ipVersion === 'ipv6' ? '::/0' : '0.0.0.0/0'}
        next-hop-address: "\${CONTROLPLANE_GATEWAY}"
        next-hop-interface: \${CONTROLPLANE_INTERFACE}
`;
    }

    // Control plane BMH(s)
    const cpCount = isMulti ? 3 : 1;
    for (let i = 0; i < cpCount; i++) {
        const suffix = isMulti ? `-${i + 1}` : '';
        yaml += `---
apiVersion: metal3.io/v1alpha1
kind: BareMetalHost
metadata:
  name: ${config.clusterName}-cp${suffix}
  labels:
    cluster-role: control-plane
spec:
  architecture: ${config.architecture === 'aarch64' ? 'aarch64' : 'x86_64'}
  online: true
  bootMACAddress: \${BMC_MAC${isMulti ? `_CP${i + 1}` : ''}}
  rootDeviceHints:
    deviceName: /dev/nvme0n1
  bmc:
    address: \${BMC_ADDRESS${isMulti ? `_CP${i + 1}` : ''}}
    disableCertificateVerification: true
    credentialsName: controlplane-${i}-credentials${!isDHCP ? `
  preprovisioningNetworkDataName: controlplane-${i}-networkdata` : ''}
`;
    }

    // Worker BMHs for multi-node with workers
    if (hasWorkers) {
        yaml += `
# Worker nodes - repeat this block for each worker
`;
        for (let i = 1; i <= 3; i++) {
            yaml += `---
apiVersion: metal3.io/v1alpha1
kind: BareMetalHost
metadata:
  name: ${config.clusterName}-worker-${i}
  labels:
    cluster-role: worker
spec:
  architecture: ${config.architecture === 'aarch64' ? 'aarch64' : 'x86_64'}
  online: true
  bootMACAddress: \${BMC_MAC_WORKER${i}}
  rootDeviceHints:
    deviceName: /dev/nvme0n1
  bmc:
    address: \${BMC_ADDRESS_WORKER${i}}
    disableCertificateVerification: true
    credentialsName: worker-${i}-credentials${!isDHCP ? `
  preprovisioningNetworkDataName: worker-${i}-networkdata` : ''}
`;
        }
    }

    return yaml;
}

function generateVariablesList(config) {
    const variables = [];

    // Common variables
    variables.push({ name: 'RKE2_VERSION', desc: 'RKE2 version (e.g., v1.28.5+rke2r1)', example: 'v1.28.5+rke2r1' });

    // IP variables
    const isMulti = config.nodeConfig.includes('multi');
    if (isMulti && config.useMetallb) {
        variables.push({ name: 'EDGE_VIP_ADDRESS', desc: 'Virtual IP for HA control plane', example: '192.168.1.100' });
    } else {
        if (config.ipVersion === 'dualstack') {
            variables.push({ name: 'EDGE_CONTROL_PLANE_IP_V4', desc: 'Control plane IPv4 address', example: '192.168.1.50' });
            variables.push({ name: 'EDGE_CONTROL_PLANE_IP_V6', desc: 'Control plane IPv6 address', example: '2001:db8::50' });
        } else {
            variables.push({ name: 'EDGE_CONTROL_PLANE_IP', desc: 'Control plane IP address', example: config.ipVersion === 'ipv6' ? '2001:db8::50' : '192.168.1.50' });
        }
    }

    // Network variables for static IP
    if (config.networkType === 'dhcp-less') {
        variables.push({ name: 'CONTROLPLANE_INTERFACE', desc: 'Network interface name', example: 'enp1s0' });
        variables.push({ name: 'CONTROLPLANE_MAC', desc: 'MAC address of interface', example: 'aa:bb:cc:dd:ee:ff' });
        if (config.ipVersion !== 'ipv6') {
            variables.push({ name: 'CONTROLPLANE_IP', desc: 'Static IPv4 address', example: '192.168.1.50' });
            variables.push({ name: 'CONTROLPLANE_PREFIX', desc: 'IPv4 prefix length', example: '24' });
        }
        if (config.ipVersion === 'ipv6' || config.ipVersion === 'dualstack') {
            variables.push({ name: 'CONTROLPLANE_IP_V6', desc: 'Static IPv6 address', example: '2001:db8::50' });
            variables.push({ name: 'CONTROLPLANE_PREFIX_V6', desc: 'IPv6 prefix length', example: '64' });
        }
        variables.push({ name: 'CONTROLPLANE_GATEWAY', desc: 'Default gateway', example: config.ipVersion === 'ipv6' ? '2001:db8::1' : '192.168.1.1' });
        variables.push({ name: 'DNS_SERVER', desc: 'DNS server', example: '8.8.8.8' });
    }

    // SR-IOV variables
    if (config.sriov) {
        variables.push({ name: 'SRIOV_VENDOR', desc: 'SR-IOV device vendor ID', example: '8086' });
        variables.push({ name: 'SRIOV_DEVICE', desc: 'SR-IOV device ID', example: '0d58' });
        variables.push({ name: 'SRIOV_NET_INTERFACE', desc: 'SR-IOV network interface PF name', example: 'enp1s0f0' });
    }

    // CPU Manager variables
    if (config.cpuManager) {
        variables.push({ name: 'ISOLATED_CPU_CORES', desc: 'CPU cores to isolate for workloads', example: '2-15' });
        variables.push({ name: 'NON_ISOLATED_CPU_CORES', desc: 'CPU cores for system tasks', example: '0,1' });
    }

    // Airgap variables
    if (config.deployment === 'airgap') {
        variables.push({ name: 'PRIVATE_REGISTRY_URL', desc: 'Private registry URL', example: 'registry.local:5000' });
        variables.push({ name: 'REGISTRY_USERNAME', desc: 'Registry username (base64)', example: 'YWRtaW4=' });
        variables.push({ name: 'REGISTRY_PASSWORD', desc: 'Registry password (base64)', example: 'cGFzc3dvcmQ=' });
        variables.push({ name: 'TLS_BASE64_CERT', desc: 'TLS certificate (base64)', example: 'LS0tLS...' });
        variables.push({ name: 'TLS_BASE64_KEY', desc: 'TLS key (base64)', example: 'LS0tLS...' });
        variables.push({ name: 'CA_BASE64_CERT', desc: 'CA certificate (base64)', example: 'LS0tLS...' });
    }

    // Worker count
    if (config.nodeConfig === 'multi-with-workers') {
        variables.push({ name: 'WORKER_NODE_COUNT', desc: 'Number of worker nodes', example: '3' });
    }

    // BMH variables
    if (config.generateBMH) {
        variables.push({ name: 'BMC_USERNAME', desc: 'BMC username (base64)', example: 'YWRtaW4=' });
        variables.push({ name: 'BMC_PASSWORD', desc: 'BMC password (base64)', example: 'cGFzc3dvcmQ=' });

        if (isMulti) {
            for (let i = 1; i <= 3; i++) {
                variables.push({ name: `BMC_ADDRESS_CP${i}`, desc: `BMC address for CP node ${i}`, example: `redfish+https://192.168.1.${100+i}/redfish/v1/Systems/1` });
                variables.push({ name: `BMC_MAC_CP${i}`, desc: `Boot MAC address for CP node ${i}`, example: `aa:bb:cc:dd:ee:0${i}` });
            }
        } else {
            variables.push({ name: 'BMC_ADDRESS', desc: 'BMC address', example: 'redfish+https://192.168.1.101/redfish/v1/Systems/1' });
            variables.push({ name: 'BMC_MAC', desc: 'Boot MAC address', example: 'aa:bb:cc:dd:ee:01' });
        }

        if (config.nodeConfig === 'multi-with-workers') {
            for (let i = 1; i <= 3; i++) {
                variables.push({ name: `BMC_ADDRESS_WORKER${i}`, desc: `BMC address for worker ${i}`, example: `redfish+https://192.168.1.${110+i}/redfish/v1/Systems/1` });
                variables.push({ name: `BMC_MAC_WORKER${i}`, desc: `Boot MAC for worker ${i}`, example: `aa:bb:cc:dd:ff:0${i}` });
            }
        }
    }

    let html = '<h3>Required Variables</h3><p style="margin-bottom: 15px;">Replace these placeholders in your generated manifests:</p>';
    variables.forEach(v => {
        html += `<div class="variable-item"><code>\${${v.name}}</code> - ${v.desc} <br><small style="color: #666;">Example: ${v.example}</small></div>`;
    });

    document.getElementById('variablesList').innerHTML = html;
}

function getCIDRBlocks(ipVersion, type) {
    if (type === 'pods') {
        if (ipVersion === 'ipv4') return ['192.168.0.0/18'];
        if (ipVersion === 'ipv6') return ['fd00:bad:face::/48'];
        return ['192.168.0.0/18', 'fd00:bad:face::/48'];
    } else { // services
        if (ipVersion === 'ipv4') return ['10.96.0.0/12'];
        if (ipVersion === 'ipv6') return ['fd00:bad:deaf:beef::/112'];
        return ['10.96.0.0/12', 'fd00:bad:deaf:beef::/112'];
    }
}
