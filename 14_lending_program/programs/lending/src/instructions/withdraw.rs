use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{ self, Mint, TokenAccount, TokenInterface, TransferChecked };
use crate::error::ErrorCode;
use crate::state::*;

#[derive(Accounts)]
pub struct Withdraw<'info> {
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

// 1. BankのトークンアカウントからユーザーのトークンアカウントへCPI転送
// 2. Bankから削除するシェアを計算
// 3. ユーザーの預金額と預金シェアを更新
// 4. Bankの総預金額と総預金シェアを更新

pub fn process_withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    // ゼロ額のチェック
    require!(amount > 0, ErrorCode::InvalidAmount);

    let bank = &mut ctx.accounts.bank;
    let user = &mut ctx.accounts.user_account;

    // ユーザーの預金額を取得
    let (deposited_value, deposited_shares) = match ctx.accounts.mint.to_account_info().key() {
        key if key == user.usdc_address => (user.deposited_usdc, user.deposited_usdc_shares),
        _ => (user.deposited_sol, user.deposited_sol_shares),
    };

    // 引き出し額が預金額を超えていないかチェック
    if amount > deposited_value {
        return Err(ErrorCode::InsufficientFunds.into());
    }

    // ゼロ除算を防ぐ
    require!(bank.total_deposits > 0, ErrorCode::InsufficientFunds);

    // 削除するシェアを計算: (amount * total_shares) / total_deposits
    // 整数除算による精度損失を避けるため、先に乗算を行う
    let shares_to_remove = (amount as u128)
        .checked_mul(bank.total_deposit_shares as u128)
        .ok_or(ErrorCode::MathOverflow)?
        .checked_div(bank.total_deposits as u128)
        .ok_or(ErrorCode::MathOverflow)? as u64;

    // シェアが足りるかチェック
    require!(shares_to_remove <= deposited_shares, ErrorCode::InsufficientFunds);

    // CPI転送を実行
    let transfer_cpi_accounts = TransferChecked {
        from: ctx.accounts.bank_token_account.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.bank_token_account.to_account_info(),
    };

    let cpi_program = ctx.accounts.token_program.to_account_info();
    let mint_key = ctx.accounts.mint.key();
    let signer_seeds: &[&[&[u8]]] = &[
        &[
            b"treasury",
            mint_key.as_ref(),
            &[ctx.bumps.bank_token_account],
        ],
    ];
    let cpi_ctx = CpiContext::new(cpi_program, transfer_cpi_accounts).with_signer(signer_seeds);

    let decimals = ctx.accounts.mint.decimals;

    token_interface::transfer_checked(cpi_ctx, amount, decimals)?;

    // ユーザーの預金額とシェアを更新
    match ctx.accounts.mint.to_account_info().key() {
        key if key == user.usdc_address => {
            user.deposited_usdc -= amount;
            user.deposited_usdc_shares -= shares_to_remove;
        },
        _ => {
            user.deposited_sol -= amount;
            user.deposited_sol_shares -= shares_to_remove;
        }
    }

    // Bankの総預金額と総シェアを更新
    bank.total_deposits -= amount;
    bank.total_deposit_shares -= shares_to_remove;

    Ok(())
}