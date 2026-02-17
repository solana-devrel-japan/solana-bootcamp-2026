use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    close_account, transfer_checked, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("5BJtxkcW1aK8R9j2taLAxkhn835SnWnk7ZwT5wy9PvGf");

#[program]
pub mod escrow {
    use super::*;

    /// maker が mint_a を escrow(offer PDA が authority のATA) に預け、
    /// 「mint_b をこの量くれたらmint_aを渡す」という Offer を作る
    pub fn make_offer(
        ctx: Context<MakeOffer>,
        offer_id: u64,
        token_a_offered_amount: u64,
        token_b_wanted_amount: u64,
    ) -> Result<()> {
        require_keys_neq!(ctx.accounts.mint_a.key(), ctx.accounts.mint_b.key(), EscrowError::SameMint);

        // 1) maker -> offer_token_account に mint_a を預ける
        let transfer_cpi_accounts = TransferChecked {
            from: ctx.accounts.maker_token_account_a.to_account_info(),
            to: ctx.accounts.offer_token_account.to_account_info(),
            mint: ctx.accounts.mint_a.to_account_info(),
            authority: ctx.accounts.maker.to_account_info(),
        };

        let cpi_context = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            transfer_cpi_accounts,
        );

        let decimals = ctx.accounts.mint_a.decimals;
        transfer_checked(cpi_context, token_a_offered_amount, decimals)?;

        // 2) Offer を保存
        ctx.accounts.offer.set_inner(Offer {
            maker: ctx.accounts.maker.key(),
            mint_a: ctx.accounts.mint_a.key(),
            mint_b: ctx.accounts.mint_b.key(),
            offer_id,
            token_a_offered_amount,
            token_b_wanted_amount,
            bump: ctx.bumps.offer,
        });

        Ok(())
    }

    /// taker が mint_b を maker に払い、escrow から mint_a を受け取る
    pub fn take_offer(ctx: Context<TakeOffer>) -> Result<()> {
        // 1) taker -> maker に mint_b (wanted amount) を送る
        {
            let transfer_cpi_accounts = TransferChecked {
                from: ctx.accounts.taker_token_account_b.to_account_info(),
                to: ctx.accounts.maker_token_account_b.to_account_info(),
                mint: ctx.accounts.mint_b.to_account_info(),
                authority: ctx.accounts.taker.to_account_info(),
            };

            let cpi_context = CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                transfer_cpi_accounts,
            );

            let decimals = ctx.accounts.mint_b.decimals;
            transfer_checked(cpi_context, ctx.accounts.offer.token_b_wanted_amount, decimals)?;
        }

        // 2) escrow(offer_token_account) -> taker に mint_a (offered amount) を送る
        // offer PDA が offer_token_account の authority なので、offer PDA 署名で動かす
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"offer",
            ctx.accounts.offer.maker.as_ref(),
            &ctx.accounts.offer.offer_id.to_le_bytes(),
            &[ctx.accounts.offer.bump],
        ]];

        {
            let transfer_cpi_accounts = TransferChecked {
                from: ctx.accounts.offer_token_account.to_account_info(),
                to: ctx.accounts.taker_token_account_a.to_account_info(),
                mint: ctx.accounts.mint_a.to_account_info(),
                authority: ctx.accounts.offer.to_account_info(),
            };

            let cpi_context = CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                transfer_cpi_accounts,
            )
            .with_signer(signer_seeds);

            let decimals = ctx.accounts.mint_a.decimals;
            transfer_checked(cpi_context, ctx.accounts.offer.token_a_offered_amount, decimals)?;
        }

        // 3) escrow の token account を close（rent を maker に返す）
        {
            let close_cpi_accounts = CloseAccount {
                account: ctx.accounts.offer_token_account.to_account_info(),
                destination: ctx.accounts.maker.to_account_info(),
                authority: ctx.accounts.offer.to_account_info(),
            };

            let cpi_context = CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                close_cpi_accounts,
            )
            .with_signer(signer_seeds);

            close_account(cpi_context)?;
        }

        // 4) offer アカウントは Accounts 側で close = maker により自動 close
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(offer_id: u64)]
pub struct MakeOffer<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,

    #[account(mint::token_program = token_program)]
    pub mint_a: InterfaceAccount<'info, Mint>,

    #[account(mint::token_program = token_program)]
    pub mint_b: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint_a,
        associated_token::authority = maker,
        associated_token::token_program = token_program
    )]
    pub maker_token_account_a: InterfaceAccount<'info, TokenAccount>,

    // Offer PDA（複数作れるように seeds に maker + offer_id）
    #[account(
        init,
        payer = maker,
        space = 8 + Offer::INIT_SPACE,
        seeds = [b"offer", maker.key().as_ref(), &offer_id.to_le_bytes()],
        bump
    )]
    pub offer: Account<'info, Offer>,

    // Offer PDA が authority の mint_a ATA（escrow保管庫）
    #[account(
        init,
        payer = maker,
        associated_token::mint = mint_a,
        associated_token::authority = offer,
        associated_token::token_program = token_program
    )]
    pub offer_token_account: InterfaceAccount<'info, TokenAccount>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TakeOffer<'info> {
    #[account(mut)]
    pub taker: Signer<'info>,

    /// maker は署名者不要（本人がいなくても take できるべき）
    #[account(mut)]
    pub maker: SystemAccount<'info>,

    #[account(mint::token_program = token_program)]
    pub mint_a: InterfaceAccount<'info, Mint>,

    #[account(mint::token_program = token_program)]
    pub mint_b: InterfaceAccount<'info, Mint>,

    // Offer（ここで close = maker を指定して、take 成功時に自動で offer を閉じる）
    #[account(
        mut,
        close = maker,
        has_one = maker @ EscrowError::MakerMismatch,
        has_one = mint_a @ EscrowError::MintMismatch,
        has_one = mint_b @ EscrowError::MintMismatch,
        seeds = [b"offer", offer.maker.as_ref(), &offer.offer_id.to_le_bytes()],
        bump = offer.bump
    )]
    pub offer: Account<'info, Offer>,

    // taker が受け取る mint_a ATA（なければ taker が payer で作る）
    #[account(
        init_if_needed,
        payer = taker,
        associated_token::mint = mint_a,
        associated_token::authority = taker,
        associated_token::token_program = token_program
    )]
    pub taker_token_account_a: InterfaceAccount<'info, TokenAccount>,

    // taker が支払う mint_b ATA
    #[account(
        mut,
        associated_token::mint = mint_b,
        associated_token::authority = taker,
        associated_token::token_program = token_program
    )]
    pub taker_token_account_b: InterfaceAccount<'info, TokenAccount>,

    // maker が受け取る mint_b ATA（なければ taker が payer で作る）
    #[account(
        init_if_needed,
        payer = taker,
        associated_token::mint = mint_b,
        associated_token::authority = maker,
        associated_token::token_program = token_program
    )]
    pub maker_token_account_b: InterfaceAccount<'info, TokenAccount>,

    // escrow 保管庫（Offer PDA が authority の mint_a ATA）
    #[account(
        mut,
        associated_token::mint = mint_a,
        associated_token::authority = offer,
        associated_token::token_program = token_program
    )]
    pub offer_token_account: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[account]
#[derive(InitSpace)]
pub struct Offer {
    pub maker: Pubkey,
    pub mint_a: Pubkey,
    pub mint_b: Pubkey,
    pub offer_id: u64,
    pub token_a_offered_amount: u64,
    pub token_b_wanted_amount: u64,
    pub bump: u8,
}

#[error_code]
pub enum EscrowError {
    #[msg("Maker account does not match Offer.maker")]
    MakerMismatch,
    #[msg("Mint account does not match Offer mints")]
    MintMismatch,
    #[msg("mint_a and mint_b must be different")]
    SameMint,
}
