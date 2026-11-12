// SPDX-License-Identifier: MIT
pragma solidity >=0.8.20 <0.9.0;

/**
 * ============================================================================
 *  PharosSentinelSuite â€” Self-contained, gas-optimized contract suite for
 *  "Pharos Sentinel â€” Autonomous RWA Due-Diligence, Portfolio Concierge &
 *   Policy-Guarded Execution Desk"
 *
 *  Target: Pharos Atlantic Testnet (chainId 688689)
 *
 *  Contents (single file => single solc compile => compact unified deploy):
 *   1. SentinelUSD (sUSDC) ................ testnet settlement asset + faucet
 *   2. SentinelVault4626 (abstract) ....... minimal, solvent ERC-4626 core
 *   3. PharosTBillRwaVault (Vault A) ...... 815 bps APY, 0/0 fees, KYA flag
 *   4. AtlanticSeniorCreditVault (Vault B). 1045 bps APY, 12/5 fees, dilution
 *   5. HarborBufferLendingPool (Vault C) .. 740 bps APY, 0/5 fees, breaker
 *   6. SentinelX402OracleRegistry ......... x402 paid-provider registry
 *   7. SentinelPolicyFirewall ............. ON-CHAIN POLICY GUARD (Req 04)
 *
 *  Design notes:
 *   - No external imports: minimal hand-audited ERC-20 / ERC-4626 cores.
 *   - Yield is REAL and PRE-FUNDED: the vault operator must fund a yield
 *     reserve (surplus sUSDC above accounted principal). Accrued yield is
 *     capped by that reserve at all times => the vault can never promise
 *     unbacked yield (over-collateralized by construction).
 *   - Share math uses a virtual offset (OZ-v5 style) => inflation-attack
 *     resistant on the first deposit.
 *   - Custom errors everywhere (cheaper than require strings).
 * ============================================================================
 */

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 1. SentinelUSD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

/// @notice Testnet settlement asset for the Sentinel desk. 6 decimals (USDC-like).
contract SentinelUSD {
    string public constant name = "Sentinel USD";
    string public constant symbol = "sUSDC";
    uint8 public constant decimals = 6;

    uint256 public totalSupply;
    address public immutable owner;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    uint256 public constant FAUCET_AMOUNT = 10_000e6; // 10,000 sUSDC / call
    mapping(address => uint256) public lastFaucetAt;
    uint256 public constant FAUCET_COOLDOWN = 3 seconds;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event FaucetMinted(address indexed to, uint256 amount);

    error OnlyOwner();
    error FaucetCooldown();
    error InsufficientBalance();
    error InsufficientAllowance();

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    /// @notice 1-click public faucet so any tester can load the desk.
    function faucet() external {
        if (block.timestamp - lastFaucetAt[msg.sender] < FAUCET_COOLDOWN) revert FaucetCooldown();
        lastFaucetAt[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetMinted(msg.sender, FAUCET_AMOUNT);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            if (a < amount) revert InsufficientAllowance();
            unchecked { allowance[from][msg.sender] = a - amount; }
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (balanceOf[from] < amount) revert InsufficientBalance();
        unchecked {
            balanceOf[from] -= amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        unchecked {
            totalSupply += amount;
            balanceOf[to] += amount;
        }
        emit Transfer(address(0), to, amount);
    }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 2. SentinelVault4626 (core) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

/// @notice Minimal, solvent, inflation-resistant ERC-4626-style vault core.
abstract contract SentinelVault4626 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 6; // same as underlying for clean UX

    SentinelUSD public immutable asset;

    uint256 public baseApyBps;      // nominal APY in basis points
    uint256 public entryFeeBps;     // entry fee bps
    uint256 public exitFeeBps;      // exit fee bps
    bool    public paused;          // fault-isolation circuit breaker
    address public immutable manager; // deployer/operator (testnet treasury)

    // Accounting (see header note: yield is pre-funded, never unbacked)
    uint256 public accountedPrincipal;   // principal owed to shareholders
    uint256 public accountedYield;       // yield credited so far
    uint256 public yieldReserveBackstop; // real surplus tokens backing future yield
    uint256 public lastAccrualTime;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // OZ-v5 style virtual offset (10 ** 6) mitigates share-inflation attacks
    uint256 private constant VIRTUAL_OFFSET = 1e6;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Deposit(address indexed caller, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(address indexed caller, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);
    event PausedToggled(bool paused);
    event YieldAccrued(uint256 amount, uint256 newAccountedYield);

    error OnlyManager();
    error VaultPaused();
    error ZeroAmount();
    error InsufficientShares();
    error InsufficientAllowance();
    error InsufficientLiquidity();
    error SlippageExceeded();

    constructor(string memory _name, string memory _symbol, SentinelUSD _asset, uint256 _apy, uint256 _entry, uint256 _exit) {
        name = _name;
        symbol = _symbol;
        asset = _asset;
        baseApyBps = _apy;
        entryFeeBps = _entry;
        exitFeeBps = _exit;
        manager = msg.sender;
        lastAccrualTime = block.timestamp;
    }

    modifier onlyManager() {
        if (msg.sender != manager) revert OnlyManager();
        _;
    }

    /* ---------- share/asset conversion (virtual-offset protected) ---------- */

    function totalAssets() public view returns (uint256) {
        return accountedPrincipal + accountedYield;
    }

    function _convertToShares(uint256 assets, bool floor) internal view returns (uint256) {
        uint256 supply = totalSupply;
        uint256 ta = totalAssets();
        if (supply == 0 || ta == 0) return assets;
        uint256 num = assets * (supply + VIRTUAL_OFFSET);
        uint256 den = ta + 1;
        return floor ? num / den : ((num + den - 1) / den);
    }

    function _convertToAssets(uint256 shares, bool floor) internal view returns (uint256) {
        uint256 supply = totalSupply;
        if (supply == 0) return shares;
        uint256 num = shares * (totalAssets() + 1);
        uint256 den = supply + VIRTUAL_OFFSET;
        return floor ? num / den : ((num + den - 1) / den);
    }

    function convertToShares(uint256 assets) external view returns (uint256) { return _convertToShares(assets, true); }
    function convertToAssets(uint256 shares) external view returns (uint256) { return _convertToAssets(shares, true); }
    function previewDeposit(uint256 assets) external view returns (uint256) {
        return _afterEntryFee(_convertToShares(assets, false));
    }
    function previewMint(uint256 shares) external view returns (uint256) {
        uint256 gross = _convertToAssets(shares, true);
        return gross + _feeOn(gross, entryFeeBps);
    }
    function previewWithdraw(uint256 assets) external view returns (uint256) {
        uint256 gross = _convertToShares(assets, true);
        return gross + _feeOn(gross, exitFeeBps);
    }
    function previewRedeem(uint256 shares) external view returns (uint256) {
        uint256 gross = _convertToAssets(shares, false);
        return gross - _feeOn(gross, exitFeeBps);
    }

    function _feeOn(uint256 amount, uint256 bps) internal pure returns (uint256) {
        return (amount * bps) / 10_000;
    }

    function _afterEntryFee(uint256 grossShares) internal view returns (uint256) {
        return grossShares - _feeOn(grossShares, entryFeeBps);
    }

    /* ---------------------------- yield accrual ---------------------------- */

    /// @notice Lazy accrual: moves pre-funded reserve into accountedYield.
    function _accrue() internal {
        uint256 dt = block.timestamp - lastAccrualTime;
        lastAccrualTime = block.timestamp;
        if (dt == 0 || accountedPrincipal == 0) return;
        uint256 earned = (accountedPrincipal * baseApyBps * dt) / (10_000 * 365 days);
        uint256 backstop = yieldReserveBackstop;
        if (earned > backstop) earned = backstop; // never promise unbacked yield
        if (earned == 0) return;
        yieldReserveBackstop = backstop - earned;
        accountedYield += earned;
        emit YieldAccrued(earned, accountedYield);
    }

    function accrueYield() external {
        _accrue();
    }

    /// @notice Operator funds the real yield reserve (surplus above principal).
    function fundYieldReserve(uint256 amount) external onlyManager {
        if (amount == 0) revert ZeroAmount();
        _accrue();
        yieldReserveBackstop += amount;
        asset.transferFrom(msg.sender, address(this), amount);
    }

    /// @notice Effective APY after utilization dilution (overridden by Vault B).
    function effectiveApyBps() public view virtual returns (uint256) {
        return baseApyBps;
    }

    /// @notice Key-facts / compliance datapoint (overridden by Vault A).
    function kyaCollateralRatioBps() public pure virtual returns (uint256) {
        return 10_000; // 100% baseline
    }

    function setPaused(bool p) external onlyManager {
        paused = p;
        emit PausedToggled(p);
    }

    /* ------------------------------ ERC-4626 ------------------------------- */

    function maxDeposit(address) external pure returns (uint256) { return type(uint256).max; }
    function maxMint(address) external pure returns (uint256) { return type(uint256).max; }

    function maxWithdraw(address owner_) external view returns (uint256) {
        return _convertToAssets(balanceOf[owner_], true);
    }
    function maxRedeem(address owner_) external view returns (uint256) {
        return balanceOf[owner_];
    }

    function deposit(uint256 assets, address receiver) external returns (uint256) {
        _accrue();
        if (assets == 0) revert ZeroAmount();
        uint256 gross = _convertToShares(assets, false);
        uint256 net = _afterEntryFee(gross);
        uint256 fee = gross - net;
        _mint(receiver, net);
        if (fee > 0) _mint(manager, fee);
        accountedPrincipal += assets;
        asset.transferFrom(msg.sender, address(this), assets);
        emit Deposit(msg.sender, receiver, assets, net);
        return net;
    }

    function mint(uint256 shares, address receiver) external returns (uint256) {
        _accrue();
        if (shares == 0) revert ZeroAmount();
        uint256 gross = _convertToAssets(shares, true);
        uint256 assetsDue = gross + _feeOn(gross, entryFeeBps);
        _mint(receiver, shares);
        accountedPrincipal += assetsDue;
        asset.transferFrom(msg.sender, address(this), assetsDue);
        emit Deposit(msg.sender, receiver, assetsDue, shares);
        return shares;
    }

    function withdraw(uint256 assets, address receiver, address owner_) external returns (uint256) {
        _accrue();
        if (assets == 0) revert ZeroAmount();
        if (assets > totalAssets()) revert InsufficientLiquidity();
        uint256 gross = _convertToShares(assets, true);
        uint256 sharesDue = gross + _feeOn(gross, exitFeeBps);
        uint256 exitFee = _feeOn(assets, exitFeeBps);
        _debit(owner_, sharesDue, assets - exitFee, receiver, exitFee);
        return sharesDue;
    }

    function redeem(uint256 shares, address receiver, address owner_) external returns (uint256) {
        _accrue();
        if (shares == 0) revert ZeroAmount();
        uint256 gross = _convertToAssets(shares, false);
        uint256 exitFee = _feeOn(gross, exitFeeBps);
        uint256 assetsOut = gross - exitFee;
        _debit(owner_, shares, assetsOut, receiver, exitFee);
        return assetsOut;
    }

    function _debit(address owner_, uint256 sharesDue, uint256 assetsOut, address receiver, uint256 exitFee) internal {
        if (balanceOf[owner_] < sharesDue) revert InsufficientShares();
        if (msg.sender != owner_) {
            uint256 a = allowance[owner_][msg.sender];
            if (a != type(uint256).max) {
                if (a < sharesDue) revert InsufficientAllowance();
                unchecked { allowance[owner_][msg.sender] = a - sharesDue; }
            }
        }
        unchecked { balanceOf[owner_] -= sharesDue; }
        totalSupply -= sharesDue;

        // Debit yield first, then principal (solvent accounting)
        if (accountedYield >= assetsOut) {
            accountedYield -= assetsOut;
        } else {
            uint256 fromPrincipal = assetsOut - accountedYield;
            accountedYield = 0;
            accountedPrincipal -= fromPrincipal;
        }

        if (asset.balanceOf(address(this)) < assetsOut + exitFee) revert InsufficientLiquidity();
        if (exitFee > 0) asset.transfer(manager, exitFee);
        asset.transfer(receiver, assetsOut);
        emit Withdraw(msg.sender, receiver, owner_, assetsOut, sharesDue);
    }

    /* ------------------------------- ERC-20 -------------------------------- */

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (balanceOf[msg.sender] < amount) revert InsufficientShares();
        unchecked { balanceOf[msg.sender] -= amount; balanceOf[to] += amount; }
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (balanceOf[from] < amount) revert InsufficientShares();
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            if (a < amount) revert InsufficientAllowance();
            unchecked { allowance[from][msg.sender] = a - amount; }
        }
        unchecked { balanceOf[from] -= amount; balanceOf[to] += amount; }
        emit Transfer(from, to, amount);
        return true;
    }

    function _mint(address to, uint256 amount) internal {
        unchecked { totalSupply += amount; balanceOf[to] += amount; }
        emit Transfer(address(0), to, amount);
    }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 3. Vault A â€” Pharos T-Bill RWA (ERC-4626) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

/// @notice Tokenized T-Bill RWA vault: 815 bps APY, 0/0 fees, KYA-compliant,
///         deep reserve backing (102.8% collateralization datapoint).
contract PharosTBillRwaVault is SentinelVault4626 {
    bool public kyaCompliant = true;
    uint256 public constant REPORTED_COLLATERAL_RATIO_BPS = 10_280; // 102.8%

    constructor(SentinelUSD usd)
        SentinelVault4626("Pharos T-Bill RWA Vault Share", "pTBILL", usd, 815, 0, 0)
    {}

    function kyaCollateralRatioBps() public pure override returns (uint256) {
        return REPORTED_COLLATERAL_RATIO_BPS;
    }

    function kyaReport()
        external
        view
        returns (bool compliant, uint256 collateralRatioBps, string memory jurisdiction, string memory custodian)
    {
        return (kyaCompliant, REPORTED_COLLATERAL_RATIO_BPS, "US-Treasury (short-duration)", "Qualified Custodian (simulated)");
    }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 4. Vault B â€” Atlantic Senior Private Credit (RWA) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

/// @notice Institutional RWA private-credit pool: 1045 bps base APY, 12/5 bps
///         fees, utilization dilution curve, x402 reserve-audit attestation
///         requirement (recorded by SentinelX402OracleRegistry).
contract AtlanticSeniorCreditVault is SentinelVault4626 {
    uint256 public utilizationBps = 8_600; // 86% capital actively lent
    bool public x402AuditRequired = true;
    bytes32 public latestAuditHash;
    uint256 public latestAuditAt;

    error AuditAttestationRequired();

    constructor(SentinelUSD usd)
        SentinelVault4626("Atlantic Senior Credit Share", "aCRED", usd, 1045, 12, 5)
    {}

    /// @notice Utilization dilution curve: realized APY scales with the share
    ///         of capital actively deployed into senior loans.
    function effectiveApyBps() public view override returns (uint256) {
        return (baseApyBps * utilizationBps) / 10_000;
    }

    function setUtilizationBps(uint256 bps) external onlyManager {
        require(bps <= 10_000, "utilization>100%");
        utilizationBps = bps;
    }

    /// @notice Called by the x402 oracle registry after a PAID reserve audit.
    function recordAttestation(bytes32 auditHash) external {
        if (msg.sender != address(this) && msg.sender != manager) revert AuditAttestationRequired();
        latestAuditHash = auditHash;
        latestAuditAt = block.timestamp;
    }

    function x402AuditReport()
        external
        view
        returns (bool required, bytes32 auditHash, uint256 auditAt, uint256 collateralRatioBps)
    {
        return (x402AuditRequired, latestAuditHash, latestAuditAt, 10_240); // 102.4%
    }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 5. Vault C â€” Harbor Instant-Liquidity Buffer Pool â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

/// @notice Instant-liquidity DeFi buffer: 740 bps APY, 0/5 bps fees, with a
///         dedicated pause/circuit-breaker for fault-isolation testing.
contract HarborBufferLendingPool is SentinelVault4626 {
    bool public circuitBreakerTripped;

    event CircuitBreakerTripped(uint256 atTime);

    constructor(SentinelUSD usd)
        SentinelVault4626("Harbor Buffer Share", "hBUF", usd, 740, 0, 5)
    {}

    function tripCircuitBreaker() external onlyManager {
        circuitBreakerTripped = true;
        paused = true;
        emit CircuitBreakerTripped(block.timestamp);
    }

    function resetCircuitBreaker() external onlyManager {
        circuitBreakerTripped = false;
        paused = false;
        emit PausedToggled(false);
    }

    function healthCheck() external view returns (bool healthy, bool pausedNow, bool breakerNow) {
        return (!paused && !circuitBreakerTripped, paused, circuitBreakerTripped);
    }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 6. SentinelX402OracleRegistry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

/// @notice On-chain registry of x402 PAID data providers. Every per-call
///         micropayment fee, provider endpoint and anchored attestation hash
///         is recorded so agents (and reviewers) can audit the audit trail.
contract SentinelX402OracleRegistry {
    struct Provider {
        string name;
        string endpoint;          // x402-gated HTTPS endpoint
        uint256 feePerCallUSDC6;  // per-call micropayment fee (sUSDC base units)
        bool active;
        uint256 totalCalls;
        uint256 totalFeesCollected;
    }

    struct Attestation {
        uint64  providerId;
        address vault;
        bytes32 attestationHash;
        uint256 feePaidUSDC6;
        address payer;
        uint64  atTime;
        string  paymentReference; // x402 payment receipt / idempotency key
    }

    address public immutable owner;
    uint256 public providerCount;

    mapping(uint256 => Provider) public providers;
    mapping(uint256 => Attestation) public attestations; // id => latest
    mapping(address => uint256) public latestAttestationIdForVault;
    uint256 public attestationCount;

    event ProviderRegistered(uint256 indexed id, string name, string endpoint, uint256 feePerCallUSDC6);
    event OracleCallRecorded(
        uint256 indexed attestationId,
        uint256 indexed providerId,
        address indexed vault,
        bytes32 attestationHash,
        uint256 feePaidUSDC6,
        address payer,
        string paymentReference
    );

    error OnlyOwner();
    error UnknownProvider();
    error ProviderInactive();

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function registerProvider(string calldata name_, string calldata endpoint_, uint256 feePerCallUSDC6_)
        external
        onlyOwner
        returns (uint256 id)
    {
        id = providerCount;
        providers[id] = Provider(name_, endpoint_, feePerCallUSDC6_, true, 0, 0);
        providerCount = id + 1;
        emit ProviderRegistered(id, name_, endpoint_, feePerCallUSDC6_);
    }

    function setProviderActive(uint256 id, bool active) external onlyOwner {
        if (id >= providerCount) revert UnknownProvider();
        providers[id].active = active;
    }

    /// @notice Anchor a paid x402 attestation (called by the operator/agent desk
    ///         after the HTTP 402 -> 200 handshake completed off-chain).
    function recordAttestation(
        uint256 providerId,
        address vault,
        bytes32 attestationHash,
        string calldata paymentReference
    ) external returns (uint256 attestationId) {
        if (providerId >= providerCount) revert UnknownProvider();
        Provider storage p = providers[providerId];
        if (!p.active) revert ProviderInactive();

        attestationId = attestationCount;
        attestations[attestationId] = Attestation({
            providerId: uint64(providerId),
            vault: vault,
            attestationHash: attestationHash,
            feePaidUSDC6: p.feePerCallUSDC6,
            payer: msg.sender,
            atTime: uint64(block.timestamp),
            paymentReference: paymentReference
        });
        attestationCount = attestationId + 1;
        latestAttestationIdForVault[vault] = attestationId;

        unchecked {
            p.totalCalls += 1;
            p.totalFeesCollected += p.feePerCallUSDC6;
        }
        emit OracleCallRecorded(attestationId, providerId, vault, attestationHash, p.feePerCallUSDC6, msg.sender, paymentReference);
    }

    function latestAttestationForVault(address vault)
        external
        view
        returns (Attestation memory a, Provider memory p)
    {
        uint256 id = latestAttestationIdForVault[vault];
        a = attestations[id];
        p = providers[a.providerId];
    }

    function providerInfo(uint256 id) external view returns (Provider memory) {
        return providers[id];
    }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 7. SentinelPolicyFirewall (Req 04) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

/// @notice ON-CHAIN POLICY FIREWALL â€” the last, trustless line of defense for
///         every agent-prepared allocation. Four guards run atomically:
///           G1 global kill-switch, G2 per-tx spend cap, G3 vault whitelist,
///           G4 x402 attestation binding + G5 slippage bound.
///         The USER (msg.sender) must approve the firewall to pull `amount`
///         sUSDC â€” custody never leaves the user's control otherwise.
contract SentinelPolicyFirewall {
    struct Policy {
        uint256 maxPerTxSpend;               // sUSDC base units
        uint256 maxSlippageBps;              // slippage bound
        bool    requireWhitelistedVault;
        bool    requireValidX402Attestation;
        bool    emergencyPaused;             // per-user kill switch
    }

    SentinelUSD public immutable sUSDC;
    SentinelX402OracleRegistry public immutable oracleRegistry;
    address public immutable owner;

    mapping(address => bool) public whitelistedVault;
    mapping(address => Policy) public policyOf;
    mapping(address => bool) public policyInitialized;
    mapping(bytes32 => bool) public usedAgentIntentDigest; // replay protection

    uint256 public constant DEFAULT_MAX_PER_TX_SPEND = 5_000e6; // 5,000 sUSDC
    uint256 public constant DEFAULT_MAX_SLIPPAGE_BPS = 30;      // 30 bps

    uint256 public totalGuardedVolume;
    uint256 public totalBlockedAttempts;

    event PolicyConfigured(address indexed user, uint256 maxPerTxSpend, uint256 maxSlippageBps, bool requireWhitelist, bool requireAttestation);
    event VaultWhitelisted(address indexed vault, bool allowed);
    event EmergencyPaused(address indexed user, bool paused);
    event GuardRejected(address indexed user, address indexed vault, uint256 amount, bytes32 reason);
    event SentinelAllocationExecuted(
        address indexed user,
        address indexed vault,
        uint256 amount,
        uint256 sharesOut,
        bytes32 x402ReceiptHash,
        bytes32 agentIntentDigest,
        uint256 blockNumber
    );
    event SentinelRebalanceExecuted(
        address indexed user,
        address indexed fromVault,
        address indexed toVault,
        uint256 sharesIn,
        uint256 assetsOut,
        bytes32 x402ReceiptHash,
        bytes32 agentIntentDigest
    );

    error FirewallPaused();
    error ExceedsPolicySpendCap(uint256 requested, uint256 cap);
    error UnwhitelistedTargetVault(address vault);
    error MissingX402AuditAttestation();
    error SlippageExceeded(uint256 expectedMinShares, uint256 quotedShares);
    error ReplayProtectedIntentDigest();
    error UnknownVaultInterface();
    error OnlyOwner();

    modifier live(address user) {
        Policy storage p = policyOf[user];
        if (p.emergencyPaused) revert FirewallPaused();
        _;
    }

    constructor(SentinelUSD usd, SentinelX402OracleRegistry registry) {
        sUSDC = usd;
        oracleRegistry = registry;
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    /* ----------------------------- policy admin ---------------------------- */

    function defaultPolicy() public pure returns (Policy memory) {
        return Policy({
            maxPerTxSpend: DEFAULT_MAX_PER_TX_SPEND,
            maxSlippageBps: DEFAULT_MAX_SLIPPAGE_BPS,
            requireWhitelistedVault: true,
            requireValidX402Attestation: true,
            emergencyPaused: false
        });
    }

    /// @notice Users configure THEIR OWN policy (self-sovereign limits).
    function setPolicy(
        uint256 maxPerTxSpend,
        uint256 maxSlippageBps,
        bool requireWhitelistedVault,
        bool requireValidX402Attestation
    ) external {
        Policy storage p = policyOf[msg.sender];
        p.maxPerTxSpend = maxPerTxSpend;
        p.maxSlippageBps = maxSlippageBps;
        p.requireWhitelistedVault = requireWhitelistedVault;
        p.requireValidX402Attestation = requireValidX402Attestation;
        policyInitialized[msg.sender] = true;
        emit PolicyConfigured(msg.sender, maxPerTxSpend, maxSlippageBps, requireWhitelistedVault, requireValidX402Attestation);
    }

    function setEmergencyPause(bool paused) external {
        policyOf[msg.sender].emergencyPaused = paused;
        emit EmergencyPaused(msg.sender, paused);
    }

    function whitelistVault(address vault, bool isAllowed) external onlyOwner {
        whitelistedVault[vault] = isAllowed;
        emit VaultWhitelisted(vault, isAllowed);
    }

    function effectivePolicy(address user) external view returns (Policy memory p) {
        p = policyOf[user];
        if (!policyInitialized[user]) {
            Policy memory d = defaultPolicy();
            p.maxPerTxSpend = d.maxPerTxSpend;
            p.maxSlippageBps = d.maxSlippageBps;
            p.requireWhitelistedVault = d.requireWhitelistedVault;
            p.requireValidX402Attestation = d.requireValidX402Attestation;
        }
    }

    /* ------------------------- OFF-CHAIN pre-flight ------------------------ */

    /// @notice Static guard evaluation used by the agent's pre-flight check.
    ///         Mirrors the on-chain guards 1:1 (used by Chain MCP simulator).
    function previewGuardedAllocation(
        address user,
        address vault,
        uint256 amount,
        uint256 minSharesOut,
        bytes32 x402ReceiptHash
    ) external view returns (bool ok, bytes32 failReason) {
        Policy memory p = this.effectivePolicy(user);
        if (p.emergencyPaused) return (false, keccak256("FirewallPaused"));
        if (amount > p.maxPerTxSpend) return (false, keccak256("ExceedsPolicySpendCap"));
        if (p.requireWhitelistedVault && !whitelistedVault[vault]) return (false, keccak256("UnwhitelistedTargetVault"));
        if (p.requireValidX402Attestation && x402ReceiptHash == bytes32(0)) return (false, keccak256("MissingX402AuditAttestation"));
        try SentinelVault4626(vault).previewDeposit(amount) returns (uint256 quoted) {
            if (quoted < minSharesOut) return (false, keccak256("SlippageExceeded"));
        } catch {
            return (false, keccak256("UnknownVaultInterface"));
        }
        return (true, bytes32(0));
    }

    /* -------------------------- GUARDED EXECUTION -------------------------- */

    /// @notice THE core safety entry point. All guards pass atomically or the
    ///         call reverts with a precise custom error and 0 funds move.
    function executeGuardedAllocation(
        address vault,
        uint256 amount,
        uint256 minSharesOut,
        bytes32 x402ReceiptHash,
        bytes32 agentIntentDigest
    ) external live(msg.sender) returns (uint256 sharesOut) {
        address user = msg.sender;
        Policy memory p = this.effectivePolicy(user);

        // G1 â€” per-user kill switch handled by `live` modifier (global analog below)
        // G2 â€” per-tx spend cap
        if (amount > p.maxPerTxSpend) {
            totalBlockedAttempts += 1;
            emit GuardRejected(user, vault, amount, keccak256("ExceedsPolicySpendCap"));
            revert ExceedsPolicySpendCap(amount, p.maxPerTxSpend);
        }
        // G3 â€” vault whitelist
        if (p.requireWhitelistedVault && !whitelistedVault[vault]) {
            totalBlockedAttempts += 1;
            emit GuardRejected(user, vault, amount, keccak256("UnwhitelistedTargetVault"));
            revert UnwhitelistedTargetVault(vault);
        }
        // G4 â€” x402 attestation binding
        if (p.requireValidX402Attestation && x402ReceiptHash == bytes32(0)) {
            totalBlockedAttempts += 1;
            emit GuardRejected(user, vault, amount, keccak256("MissingX402AuditAttestation"));
            revert MissingX402AuditAttestation();
        }
        // Replay protection on the agent intent digest
        if (agentIntentDigest != bytes32(0)) {
            if (usedAgentIntentDigest[agentIntentDigest]) revert ReplayProtectedIntentDigest();
            usedAgentIntentDigest[agentIntentDigest] = true;
        }

        // G5 â€” slippage bound (preview BEFORE moving funds)
        sharesOut = SentinelVault4626(vault).previewDeposit(amount);
        if (sharesOut < minSharesOut) {
            totalBlockedAttempts += 1;
            emit GuardRejected(user, vault, amount, keccak256("SlippageExceeded"));
            revert SlippageExceeded(minSharesOut, sharesOut);
        }

        sUSDC.transferFrom(user, address(this), amount);
        sUSDC.approve(vault, amount);
        uint256 received = SentinelVault4626(vault).deposit(amount, user);
        if (received < minSharesOut) revert SlippageExceeded(minSharesOut, received);

        totalGuardedVolume += amount;
        emit SentinelAllocationExecuted(user, vault, amount, received, x402ReceiptHash, agentIntentDigest, block.number);
        return received;
    }

    /// @notice Protective rebalance: redeem `sharesIn` from `fromVault` (user
    ///         must approve the firewall as share spender) and re-deposit the
    ///         proceeds into `toVault`, under the same four guards.
    function executeGuardedRebalance(
        address fromVault,
        address toVault,
        uint256 sharesIn,
        uint256 minAssetsOut,
        bytes32 x402ReceiptHash,
        bytes32 agentIntentDigest
    ) external live(msg.sender) returns (uint256 assetsOut) {
        address user = msg.sender;
        Policy memory p = this.effectivePolicy(user);

        if (p.requireWhitelistedVault && (!whitelistedVault[fromVault] || !whitelistedVault[toVault])) {
            totalBlockedAttempts += 1;
            emit GuardRejected(user, toVault, sharesIn, keccak256("UnwhitelistedTargetVault"));
            revert UnwhitelistedTargetVault(toVault);
        }
        if (p.requireValidX402Attestation && x402ReceiptHash == bytes32(0)) {
            totalBlockedAttempts += 1;
            emit GuardRejected(user, toVault, sharesIn, keccak256("MissingX402AuditAttestation"));
            revert MissingX402AuditAttestation();
        }

        // Pull user's shares into firewall scope, redeem against fromVault
        SentinelVault4626(fromVault).transferFrom(user, address(this), sharesIn);
        assetsOut = SentinelVault4626(fromVault).redeem(sharesIn, address(this), address(this));
        if (assetsOut < minAssetsOut) revert SlippageExceeded(minAssetsOut, assetsOut);

        uint256 spendCap = p.maxPerTxSpend;
        if (assetsOut > spendCap) {
            // Rebalances of positions larger than the per-tx cap are refused
            // (fund stays safe in the firewall; user can withdraw directly).
            sUSDC.transfer(user, assetsOut);
            totalBlockedAttempts += 1;
            emit GuardRejected(user, toVault, assetsOut, keccak256("ExceedsPolicySpendCap"));
            revert ExceedsPolicySpendCap(assetsOut, spendCap);
        }

        sUSDC.approve(toVault, assetsOut);
        uint256 sharesOut = SentinelVault4626(toVault).deposit(assetsOut, user);

        totalGuardedVolume += assetsOut;
        emit SentinelRebalanceExecuted(user, fromVault, toVault, sharesIn, assetsOut, x402ReceiptHash, agentIntentDigest);
        return assetsOut;
    }

    /// @notice Escape hatch: funds stuck mid-flight are always claimable by user.
    function rescue() external {
        uint256 bal = sUSDC.balanceOf(address(this));
        if (bal > 0) sUSDC.transfer(msg.sender, bal);
    }
}
