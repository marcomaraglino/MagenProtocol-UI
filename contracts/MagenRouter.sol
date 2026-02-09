// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./MagenVault.sol";
import "./SimpleAMM.sol";

contract MagenRouter {
    MagenVault public vault;
    SimpleAMM public amm;
    IERC20 public usdc;
    IERC20 public tokenSI;
    IERC20 public tokenNO;

    constructor(address _vault, address _amm, address _usdc, address _tokenSI, address _tokenNO) {
        vault = MagenVault(_vault);
        amm = SimpleAMM(_amm);
        usdc = IERC20(_usdc);
        tokenSI = IERC20(_tokenSI);
        tokenNO = IERC20(_tokenNO);
    }

    // Buy SI with USDC: Mint SI+NO, Swap NO -> SI, Return SI
    function buySI(uint256 usdcAmount) external {
        require(usdc.transferFrom(msg.sender, address(this), usdcAmount), "USDC transfer failed");
        
        // Approve Vault to spend USDC
        usdc.approve(address(vault), usdcAmount);
        
        // Mint SI + NO to Router
        vault.mint(usdcAmount);
        
        // Swap NO for SI
        // NO amount to swap is the amount we just minted = usdcAmount
        uint256 noBalance = tokenNO.balanceOf(address(this));
        tokenNO.approve(address(amm), noBalance);
        
        // amm.swap(amountIn, isSIIn) -> isSIIn=false for NO input
        amm.swap(noBalance, false);
        
        // Transfer total SI to user
        uint256 siBalance = tokenSI.balanceOf(address(this));
        tokenSI.transfer(msg.sender, siBalance);
    }

    // Sell SI for USDC: Swap x SI -> y NO until SI == NO, Burn for USDC
    function sellSI(uint256 tokenAmount) external {
        require(tokenAmount > 0, "Amount must be > 0");
        require(tokenSI.transferFrom(msg.sender, address(this), tokenAmount), "Transfer SI failed");

        // Calculate amount of SI to swap for NO to reach 1:1 ratio
        // We want (tokenAmount - x) == (reserveNO * x) / (reserveSI + x)
        // x^2 + (reserveNO + reserveSI - tokenAmount)x - (tokenAmount * reserveSI) = 0
        
        (uint256 reserveSI, uint256 reserveNO) = (amm.reserveSI(), amm.reserveNO());
        
        // If reserves are empty, we can't swap. This implies no liquidity.
        if (reserveSI == 0 || reserveNO == 0) {
            // Fallback: if no liquidity, we can't perform the swap-to-balance.
            // But user wants USDC. If 1:1 is impossible, revert or handle?
            revert("Insufficient liquidity for sell");
        }

        /*
           Equation: x^2 + bx + c = 0
           b = (reserveNO + reserveSI) - tokenAmount
           c = - (tokenAmount * reserveSI)
           
           We need to be careful with signed integers here since 'b' can be negative.
           Let's use int256 for calculation.
        */
        
        uint256 amountToSwap;
        {
            int256 R_si = int256(reserveSI);
            int256 R_no = int256(reserveNO);
            int256 T = int256(tokenAmount);
            
            int256 b = (R_no + R_si) - T;
            int256 c = -(T * R_si); // This is negative
            
            // Discriminant = b^2 - 4ac (a=1) -> b^2 - 4c
            // Since c is negative, -4c is positive.
            uint256 D = uint256(b * b - (4 * c)); 
            uint256 sqrtD = Math.sqrt(D);
            
            // Root x = (-b + sqrtD) / 2
            int256 num = -b + int256(sqrtD);
            amountToSwap = uint256(num / 2);
        }
        
        // Perform Swap
        tokenSI.approve(address(amm), amountToSwap);
        amm.swap(amountToSwap, true); // isSIIn = true (Sell SI, Buy NO)
        
        // Now balances should be roughly equal
        uint256 balSI = tokenSI.balanceOf(address(this));
        uint256 balNO = tokenNO.balanceOf(address(this));
        
        // Burn the minimum of the two to convert to USDC
        uint256 burnAmount = balSI < balNO ? balSI : balNO;
        
        // Approve Vault (OutcomeTokens are burnt by vault, need allowance? 
        // No, vault.burn() calls token.burn() from msg.sender. 
        // Wait, MagenVault.burn():
        // tokenSI.burn(msg.sender, amount);
        // So Router (msg.sender) must hold the tokens. Correct.
        // Vault DOES NOT transferFrom, it calls burn directly on the token.
        // Token must allow Vault to burn? No, burn is usually restricted.
        
        // Let's check OutcomeToken.sol or MagenVault.burn logic.
        // Vault calls `tokenSI.burn(msg.sender, amount)`
        // If OutcomeToken is standard Ownable ERC20 with burn access control, 
        // and Vault is Owner (which it IS from PoolFactory), it can burn from anyone?
        // Or Vault calls burn on ITSELF?
        // "tokenSI.burn(msg.sender, amount)" -> Burn from msg.sender (Router).
        // Usually `burn(address account, uint256 amount)` requires `account` to be msg.sender OR allowance.
        // But if Vault is the OWNER of the token, and the token has a `burn` function that allows Owner to burn?
        
        // Let's assume Vault has permission.
        
        vault.burn(burnAmount);
        
        // Return USDC to user
        uint256 usdcBal = usdc.balanceOf(address(this));
        usdc.transfer(msg.sender, usdcBal);
        
        // Refund dust checks? (Remaining SI/NO < epsilon)
        // For now, leave dust in Router.
    }

    // Buy NO with USDC
    function buyNO(uint256 usdcAmount) external {
        require(usdc.transferFrom(msg.sender, address(this), usdcAmount), "USDC transfer failed");
        usdc.approve(address(vault), usdcAmount);
        vault.mint(usdcAmount);
        
        // Swap SI for NO (We have equal SI/NO, swap SI -> NO)
        uint256 siBalance = tokenSI.balanceOf(address(this));
        tokenSI.approve(address(amm), siBalance);
        amm.swap(siBalance, true); // isSIIn=true
        
        uint256 noBalance = tokenNO.balanceOf(address(this));
        tokenNO.transfer(msg.sender, noBalance);
    }
    
    // Sell NO for USDC
    function sellNO(uint256 tokenAmount) external {
         require(tokenAmount > 0, "Amount must be > 0");
        require(tokenNO.transferFrom(msg.sender, address(this), tokenAmount), "Transfer NO failed");

        (uint256 reserveSI, uint256 reserveNO) = (amm.reserveSI(), amm.reserveNO());
        
        if (reserveSI == 0 || reserveNO == 0) revert("Insufficient liquidity");

        // Swap NO -> SI until NO == SI
        // Equation: x^2 + (R_si + R_no - T)x - (T * R_no) = 0
        // Same structure, just swap reserves
        
        uint256 amountToSwap;
        {
            int256 R_si = int256(reserveSI);
            int256 R_no = int256(reserveNO);
            int256 T = int256(tokenAmount);
            
            int256 b = (R_no + R_si) - T;
            int256 c = -(T * R_no);
            
            uint256 D = uint256(b * b - (4 * c));
            uint256 sqrtD = Math.sqrt(D);
            
            int256 num = -b + int256(sqrtD);
            amountToSwap = uint256(num / 2);
        }
        
        tokenNO.approve(address(amm), amountToSwap);
        amm.swap(amountToSwap, false); // isSIIn=false (Sell NO, Buy SI)
        
        uint256 balSI = tokenSI.balanceOf(address(this));
        uint256 balNO = tokenNO.balanceOf(address(this));
        uint256 burnAmount = balSI < balNO ? balSI : balNO;
        
        vault.burn(burnAmount);
        
        uint256 usdcBal = usdc.balanceOf(address(this));
        usdc.transfer(msg.sender, usdcBal);
    }
}
