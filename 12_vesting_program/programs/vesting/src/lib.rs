use anchor_lang::prelude::*;
use anchor_spl::token_interface::{ Mint, TokenInterface, TokenAccount, TransferChecked, transfer_checked };
use anchor_spl::associated_token::AssociatedToken;

declare_id!("E59xEv3EjfHdkDBrrgwWNdXtCJoG7yxXyQAYVCj8wjx3");

#[program]
pub mod vesting {
    use super::*;

    pub fn initialize_vesting_account(ctx: Context<InitializeVestingAccount>, vesting_id: u64) -> Result<()> {
        ctx.accounts.vesting_account.set_inner(VestingAccount {
            vesting_id,
            owner: ctx.accounts.owner.key(),
            treasury_mint: ctx.accounts.treasury_mint.key(),
            treasury_token_account: ctx.accounts.treasury_token_account.key(),
            treasury_bump: ctx.bumps.treasury_token_account,
            vesting_bump: ctx.bumps.vesting_account,
        });
        Ok(())
    }

    pub fn initialize_member_account(ctx: Context<InitializeMemberAccount>, _vesting_id: u64, start_time: i64, end_time: i64, cliff_time: i64, total_amount: u64) -> Result<()> {
        require!(total_amount > 0, ErrorCode::InvalidAmount);
        require!(start_time < cliff_time, ErrorCode::InvalidSchedule);
        require!(cliff_time <= end_time, ErrorCode::InvalidSchedule);

        ctx.accounts.member_account.set_inner(MemberAccount {
            beneficiary: ctx.accounts.beneficiary.key(),
            start_time,
            end_time,
            cliff_time,
            total_amount,
            total_withdrawn: 0,
            vesting_account: ctx.accounts.vesting_account.key(),
            member_bump: ctx.bumps.member_account,
        });
        Ok(())
    }

    pub fn claim_tokens(ctx: Context<ClaimTokens>, _vesting_id: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let member_account = &mut ctx.accounts.member_account;

        if now < member_account.cliff_time {
            return Err(ErrorCode::NotCliffTime.into());
        }

        let time_since_start = now.saturating_sub(member_account.start_time) as u64;
        let vesting_duration = member_account.end_time.saturating_sub(member_account.start_time) as u64;

        let vested_amount = if now > member_account.end_time {
            member_account.total_amount
        } else {
            member_account.total_amount.saturating_mul(time_since_start).saturating_div(vesting_duration)
        };

        let claimable_amount = vested_amount.saturating_sub(member_account.total_withdrawn);

        require!(claimable_amount > 0, ErrorCode::NothingToClaim);

        let binding = ctx.accounts.vesting_account.vesting_id.to_le_bytes();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"vesting_treasury", binding.as_ref(),
             &[ctx.accounts.vesting_account.treasury_bump],
        ]];

        let cpi_program = ctx.accounts.token_program.to_account_info();

        let cpi_ix = TransferChecked {
            from: ctx.accounts.treasury_token_account.to_account_info(),
            to: ctx.accounts.member_token_account.to_account_info(),
            mint: ctx.accounts.treasury_mint.to_account_info(),
            authority: ctx.accounts.treasury_token_account.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(cpi_program, cpi_ix).with_signer(signer_seeds);

        let decimals = ctx.accounts.treasury_mint.decimals;

        transfer_checked(cpi_ctx, claimable_amount, decimals)?;

        member_account.total_withdrawn += claimable_amount;
        Ok(())
    }
}


#[derive(Accounts)]
#[instruction(vesting_id: u64)]
pub struct InitializeVestingAccount<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = 8 + VestingAccount::INIT_SPACE,
        seeds = [b"vesting", vesting_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub vesting_account: Account<'info, VestingAccount>,
    #[account(
        init,
        payer = owner,
        seeds = [b"vesting_treasury", vesting_id.to_le_bytes().as_ref()],
        bump,
        token::mint = treasury_mint,
        token::authority = treasury_token_account,
    )]
    pub treasury_token_account: InterfaceAccount<'info, TokenAccount>,
    pub treasury_mint: InterfaceAccount<'info, Mint>,
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
}


#[derive(Accounts)]
#[instruction(vesting_id: u64)]
pub struct InitializeMemberAccount<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    pub beneficiary: SystemAccount<'info>,
    #[account(
        seeds = [b"vesting", vesting_account.vesting_id.to_le_bytes().as_ref()],
        bump,
        has_one = owner,
    )]
    pub vesting_account: Account<'info, VestingAccount>,
    #[account(
        init,
        payer = owner,
        space = 8 + MemberAccount::INIT_SPACE,
        seeds = [b"member", beneficiary.key().as_ref(), vesting_account.key().as_ref()],
        bump,
    )]
    pub member_account: Account<'info, MemberAccount>,
    pub system_program: Program<'info, System>,
}


#[derive(Accounts)]
#[instruction(vesting_id: u64)]
pub struct ClaimTokens<'info> {
    #[account(mut)]
    pub beneficiary: Signer<'info>,
    #[account(
        seeds = [b"vesting", vesting_account.vesting_id.to_le_bytes().as_ref()],
        bump,
        has_one = treasury_mint,
        has_one = treasury_token_account,
    )]
    pub vesting_account: Account<'info, VestingAccount>,
    #[account(
        mut,
        seeds = [b"member", beneficiary.key().as_ref(), vesting_account.key().as_ref()],
        bump,
        has_one = beneficiary,
        has_one = vesting_account,
    )]
    pub member_account: Account<'info, MemberAccount>,
    #[account(
        init_if_needed,
        payer = beneficiary,
        associated_token::mint = treasury_mint,
        associated_token::authority = beneficiary,
        associated_token::token_program = token_program,
    )]
    pub member_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"vesting_treasury", vesting_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub treasury_token_account: InterfaceAccount<'info, TokenAccount>,
    pub treasury_mint: InterfaceAccount<'info, Mint>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[account]
#[derive(InitSpace)]
pub struct VestingAccount {
    pub vesting_id: u64,
    owner: Pubkey,
    treasury_mint: Pubkey,
    treasury_token_account: Pubkey,
    treasury_bump: u8,
    vesting_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct MemberAccount {
    pub beneficiary: Pubkey,
    pub start_time: i64,
    pub end_time: i64,
    pub cliff_time: i64,
    pub total_amount: u64,
    pub total_withdrawn: u64,
    pub vesting_account: Pubkey,
    pub member_bump: u8,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Not cliff time")]
    NotCliffTime,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid schedule: must satisfy start_time < cliff_time <= end_time")]
    InvalidSchedule,
}
