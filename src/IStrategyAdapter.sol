// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title IStrategyAdapter
/// @notice A place a CovenantVault can deploy idle USDC and recover it (± PnL),
///         WITHOUT the operator ever taking custody. The vault — not the
///         operator — holds the adapter relationship: only the vault may call
///         deposit/withdraw, and the adapter sends recovered USDC back to the
///         vault. This is the on-chain twin of the keeper's CapitalVenue.
///
///         Accounting contract: amounts are in the vault's USDC (6 decimals).
///         `deposit` pulls `amount` USDC from the vault (which must approve
///         first). `withdraw(amount)` unwinds up to `amount` USDC of value and
///         returns the realized USDC to the vault; `amount == type(uint256).max`
///         means "withdraw everything".
interface IStrategyAdapter {
    /// @notice The USDC token this adapter accepts. Must equal the vault's usdc.
    function asset() external view returns (address);
    /// @notice The single vault allowed to deposit/withdraw.
    function vault() external view returns (address);
    /// @notice Current USDC-equivalent value the adapter holds for the vault.
    function totalAssets() external view returns (uint256);
    /// @notice Pull `amount` USDC from the vault and deploy it. Vault-only.
    function deposit(uint256 amount) external returns (uint256 deployed);
    /// @notice Unwind up to `amount` USDC of value back to the vault. Vault-only.
    function withdraw(uint256 amount) external returns (uint256 returned);
}
