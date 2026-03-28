/**
 * blockchain.js — Polygon Amoy hash anchoring helpers
 *
 * Integrates TrustlessIDRegistry.sol with this credential wallet/verifier flow.
 * Contract stores only SHA-256 hashes (no personal data).
 */

const BlockchainModule = (() => {
  const STORAGE_KEY = 'cc_blockchain_config';
  const DEFAULT_CONFIG = {
    CONTRACT_ADDRESS: '0x9476bcF12FC80f57102FB60E33b93C7C9d28078F',
    NETWORK_NAME: 'Polygon Amoy Testnet',
    CHAIN_ID: 80002,
    RPC_URL: 'https://rpc-amoy.polygon.technology',
    BLOCK_EXPLORER: 'https://amoy.polygonscan.com',
  };

  const CONTRACT_ABI = [
    'function storeHash(string memory hash) external',
    'function verifyHash(string memory hash) external view returns (bool)',
    'function getAnchorTime(string memory hash) external view returns (uint256)',
  ];

  function getConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_CONFIG };
      const user = JSON.parse(raw);
      return { ...DEFAULT_CONFIG, ...user };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  function hasEthers() {
    return typeof ethers !== 'undefined';
  }

  function normalizeAddress(addr) {
    return typeof addr === 'string' ? addr.trim().toLowerCase() : '';
  }

  function addressesEqual(a, b) {
    return !!normalizeAddress(a) && normalizeAddress(a) === normalizeAddress(b);
  }

  function isConfigured() {
    const cfg = getConfig();
    return /^0x[a-fA-F0-9]{40}$/.test(cfg.CONTRACT_ADDRESS);
  }

  function getExplorerTxUrl(txHash) {
    const cfg = getConfig();
    return `${cfg.BLOCK_EXPLORER}/tx/${txHash}`;
  }

  function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).sort().forEach((k) => {
        if (typeof value[k] !== 'undefined') out[k] = canonicalize(value[k]);
      });
      return out;
    }
    return value;
  }

  function canonicalStringify(value) {
    return JSON.stringify(canonicalize(value));
  }

  async function sha256Hex(str) {
    const enc = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  function getCredentialAnchorPayload(credential) {
    return {
      id: credential?.id,
      type: credential?.type,
      issuer: credential?.issuer,
      issuerPublicKey: credential?.issuerPublicKey,
      issuanceDate: credential?.issuanceDate,
      expirationDate: credential?.expirationDate,
      originalSubject: credential?.originalSubject,
      proof: credential?.proof,
    };
  }

  async function computeCredentialHash(credential) {
    const payload = getCredentialAnchorPayload(credential);
    const stable = canonicalStringify(payload);
    return await sha256Hex(stable);
  }

  async function computeCredentialHashFromPresentation(presentation) {
    return await computeCredentialHash(presentation?.credential);
  }

  async function getReadOnlyContract() {
    if (!hasEthers()) throw new Error('ethers.js not loaded');
    const cfg = getConfig();
    const provider = new ethers.JsonRpcProvider(cfg.RPC_URL);
    return new ethers.Contract(cfg.CONTRACT_ADDRESS, CONTRACT_ABI, provider);
  }

  async function getConnectedAddress(requestAccess = true) {
    if (!window.ethereum) return null;
    if (requestAccess) {
      const acc = await window.ethereum.request({ method: 'eth_requestAccounts' });
      return acc && acc[0] ? acc[0] : null;
    }
    const acc = await window.ethereum.request({ method: 'eth_accounts' });
    return acc && acc[0] ? acc[0] : null;
  }

  async function ensureWalletNetwork(provider) {
    const cfg = getConfig();
    const current = await provider.getNetwork();
    if (Number(current.chainId) === cfg.CHAIN_ID) return;

    const hexChainId = `0x${cfg.CHAIN_ID.toString(16)}`;
    try {
      await provider.send('wallet_switchEthereumChain', [{ chainId: hexChainId }]);
    } catch (switchErr) {
      if (switchErr && switchErr.code === 4902) {
        await provider.send('wallet_addEthereumChain', [{
          chainId: hexChainId,
          chainName: cfg.NETWORK_NAME,
          rpcUrls: [cfg.RPC_URL],
          nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
          blockExplorerUrls: [cfg.BLOCK_EXPLORER],
        }]);
      } else {
        throw switchErr;
      }
    }
  }

  async function anchorHash(hash) {
    if (!isConfigured()) throw new Error('Contract address is not configured');
    if (!hasEthers()) throw new Error('ethers.js not loaded');
    if (!window.ethereum) throw new Error('MetaMask not detected');

    const cfg = getConfig();
    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send('eth_requestAccounts', []);
    await ensureWalletNetwork(provider);

    const signer = await provider.getSigner();
    const from = await signer.getAddress();
    const contract = new ethers.Contract(cfg.CONTRACT_ADDRESS, CONTRACT_ABI, signer);
    // Amoy can reject txs with too-low priority fee; enforce a sane floor.
    const feeData = await provider.getFeeData();
    const minTip = ethers.parseUnits('30', 'gwei');
    const priorityFee = feeData.maxPriorityFeePerGas && feeData.maxPriorityFeePerGas > minTip
      ? feeData.maxPriorityFeePerGas
      : minTip;
    const baseOrMax = feeData.maxFeePerGas || feeData.gasPrice || ethers.parseUnits('60', 'gwei');
    const maxFee = baseOrMax > priorityFee ? baseOrMax : (priorityFee * 2n);

    const tx = await contract.storeHash(hash, {
      maxPriorityFeePerGas: priorityFee,
      maxFeePerGas: maxFee,
    });
    const receipt = await tx.wait();
    let anchorTime = null;
    try {
      const t = await contract.getAnchorTime(hash);
      anchorTime = Number(t);
    } catch {
      anchorTime = null;
    }

    return {
      hash,
      from,
      txHash: tx.hash,
      blockNumber: receipt?.blockNumber || null,
      chainId: cfg.CHAIN_ID,
      anchorTime,
      explorerUrl: getExplorerTxUrl(tx.hash),
    };
  }

  async function verifyHash(hash) {
    if (!isConfigured()) {
      return { anchored: false, anchorTime: null, reason: 'Contract not configured' };
    }
    const contract = await getReadOnlyContract();
    const anchored = await contract.verifyHash(hash);
    let anchorTime = null;
    if (anchored) {
      try {
        const t = await contract.getAnchorTime(hash);
        anchorTime = Number(t);
      } catch {
        anchorTime = null;
      }
    }
    return { anchored: !!anchored, anchorTime };
  }

  return {
    CONTRACT_ABI,
    getConfig,
    isConfigured,
    normalizeAddress,
    addressesEqual,
    getConnectedAddress,
    getExplorerTxUrl,
    getCredentialAnchorPayload,
    computeCredentialHash,
    computeCredentialHashFromPresentation,
    anchorHash,
    verifyHash,
  };
})();
