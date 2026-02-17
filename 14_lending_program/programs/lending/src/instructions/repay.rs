use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{ self, Mint, TokenAccount, TokenInterface, TransferChecked };
use crate::state::*;
use crate::error::ErrorCode;

#[derive(Accounts)]
pub struct Repay<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut, 
        seeds = [mint.key().as_ref()],
        bump,
    )]  
    pub bank: Account<'info, Bank>,
    #[account(
        mut, 
        seeds = [b"treasury", mint.key().as_ref()],
        bump, 
    )]  
    pub bank_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut, 
        seeds = [signer.key().as_ref()],
        bump,
    )]  
    pub user_account: Account<'info, User>,
    #[account( 
        init_if_needed, 
        payer = signer,
        associated_token::mint = mint, 
        associated_token::authority = signer,
        associated_token::token_program = token_program,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>, 
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// 返済機能: ユーザーのトークンアカウントからBankのトークンアカウントへCPI転送を行う
pub fn process_repay(ctx: Context<Repay>, amount: u64) -> Result<()> {
    // ゼロ額のチェック
    require!(amount > 0, ErrorCode::InvalidAmount);

    let bank = &mut ctx.accounts.bank;
    let user = &mut ctx.accounts.user_account;

    // 注意: 簡略化のため、利息は計算に含まれていない

    // ユーザーの借入額とシェアを取得
    let (borrowed_amount, borrowed_shares) = match ctx.accounts.mint.to_account_info().key() {
        key if key == user.usdc_address => (user.borrowed_usdc, user.borrowed_usdc_shares),
        _ => (user.borrowed_sol, user.borrowed_sol_shares),
    };

    // 返済額が借入額を超えていないかチェック
    if amount > borrowed_amount {
        return Err(ErrorCode::OverRepay.into());
    }

    // ゼロ除算を防ぐ
    require!(bank.total_borrowed > 0, ErrorCode::MathOverflow);

    // 削除するシェアを計算: (amount * total_shares) / total_borrowed
    // 整数除算による精度損失を避けるため、先に乗算を行う
    let shares_to_remove = (amount as u128)
        .checked_mul(bank.total_borrowed_shares as u128)
        .ok_or(ErrorCode::MathOverflow)?
        .checked_div(bank.total_borrowed as u128)
        .ok_or(ErrorCode::MathOverflow)? as u64;

    // シェアが足りるかチェック
    require!(shares_to_remove <= borrowed_shares, ErrorCode::MathOverflow);

    // CPI転送を実行
    let transfer_cpi_accounts = TransferChecked {
        from: ctx.accounts.user_token_account.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.bank_token_account.to_account_info(),
        authority: ctx.accounts.signer.to_account_info(),
    };

    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, transfer_cpi_accounts);
    let decimals = ctx.accounts.mint.decimals;

    token_interface::transfer_checked(cpi_ctx, amount, decimals)?;

    // ユーザーの借入額とシェアを更新
    match ctx.accounts.mint.to_account_info().key() {
        key if key == user.usdc_address => {
            user.borrowed_usdc -= amount;
            user.borrowed_usdc_shares -= shares_to_remove;
        },
        _ => {
            user.borrowed_sol -= amount;
            user.borrowed_sol_shares -= shares_to_remove;
        }
    }

    // Bankの総借入額と総シェアを更新
    bank.total_borrowed -= amount;
    bank.total_borrowed_shares -= shares_to_remove;

    Ok(())
}