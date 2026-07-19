// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Disperse-style bulk sender. No admin, no custody.
/// Industry-standard pattern (disperse.app) — 1 tx → many recipients.
contract MultiSend {
    error LengthMismatch();
    error BadValue();
    error EthFail(address to);
    error TokenFail(address to);

    /// @notice Send native coin to many addresses in one transaction.
    function disperseEther(address[] calldata recipients, uint256[] calldata amounts) external payable {
        uint256 n = recipients.length;
        if (n != amounts.length) revert LengthMismatch();

        uint256 total;
        for (uint256 i; i < n; ++i) {
            total += amounts[i];
        }
        if (msg.value != total) revert BadValue();

        for (uint256 i; i < n; ++i) {
            (bool ok, ) = recipients[i].call{value: amounts[i]}("");
            if (!ok) revert EthFail(recipients[i]);
        }
    }

    /// @notice Send ERC-20 to many addresses (requires prior approve of this contract).
    function disperseToken(address token, address[] calldata recipients, uint256[] calldata amounts) external {
        uint256 n = recipients.length;
        if (n != amounts.length) revert LengthMismatch();

        for (uint256 i; i < n; ++i) {
            (bool ok, bytes memory data) = token.call(
                abi.encodeWithSelector(bytes4(0x23b872dd), msg.sender, recipients[i], amounts[i])
            );
            if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) {
                revert TokenFail(recipients[i]);
            }
        }
    }
}
