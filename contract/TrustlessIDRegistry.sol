// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title TrustlessID Registry
 * @notice Stores SHA-256 hashes of identity credentials on-chain.
 *         NO personal data is ever stored — only the hash.
 */
contract TrustlessIDRegistry {

    address public owner;

    // hash => exists
    mapping(string => bool) private hashes;

    // hash => timestamp
    mapping(string => uint256) private anchoredAt;

    // Total credentials anchored
    uint256 public totalAnchored;

    event HashAnchored(string indexed hash, uint256 timestamp);

    modifier onlyValidHash(string memory hash) {
        require(bytes(hash).length == 64, "Invalid SHA-256 hash length");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /**
     * @notice Anchor a credential hash on-chain
     * @param hash SHA-256 hex string of the JWT credential
     */
    function storeHash(string memory hash) external onlyValidHash(hash) {
        require(!hashes[hash], "Hash already anchored");
        hashes[hash] = true;
        anchoredAt[hash] = block.timestamp;
        totalAnchored++;
        emit HashAnchored(hash, block.timestamp);
    }

    /**
     * @notice Check whether a credential hash exists on-chain
     * @param hash SHA-256 hex string to verify
     * @return bool true if hash was previously anchored
     */
    function verifyHash(string memory hash) external view returns (bool) {
        return hashes[hash];
    }

    /**
     * @notice Get the timestamp when a hash was anchored
     * @param hash SHA-256 hex string
     * @return timestamp unix timestamp, 0 if not found
     */
    function getAnchorTime(string memory hash) external view returns (uint256) {
        return anchoredAt[hash];
    }
}
